// One copy of the files for a song on several lists (#104). Songs published to
// jm and public before publish-songs.sh took several lists have a copy each;
// this points every list's row at one copy and deletes the other's files.
//
//   ./scripts/run.sh --cloudflare node scripts/merge-duplicate-songs.mjs           # print what it would do
//   ./scripts/run.sh --cloudflare node scripts/merge-duplicate-songs.mjs --apply   # do it
//
// Only a song on exactly the jm and public lists, its rows matching in title,
// parts and length, is merged: the test list's versions and any other list's
// copies are never touched. The newer
// version is kept, since a later publish is the likelier fix; when the files are
// the same (same checksums, manifest.json aside: it names its choir) jm's is
// kept. The rows change first and the files go after, so a failed delete leaves
// files behind, never a broken song.
import { fileURLToPath } from "node:url";
import { cloudflareStore } from "./publish-songs.mjs";

const PREFERRED = "jm";
/** The only lists whose copies are merged: the songs published to both before #104. */
const PAIR = ["jm", "public"];

/** The last folder of a prefix: `songs/jm/x/20261009T120000Z/` → `20261009T120000Z`. */
const versionOf = (prefix) => prefix.split("/").filter(Boolean).pop() ?? "";

/** Each object under `prefix` by its name inside it, with its checksum; manifest.json left out. */
async function contents(store, prefix) {
  const objects = await store.list(prefix);
  return new Map(objects.map((o) => [o.key.slice(prefix.length), o.etag]).filter(([name]) => name !== "manifest.json"));
}

const same = (a, b) => a.size === b.size && [...a].every(([name, etag]) => b.get(name) === etag);

/**
 * What to merge: `[{ slug, keep, drop: [prefix], same }]`, and what is skipped
 * with why. `rows` are the D1 songs rows.
 */
export async function mergePlan(store, rows) {
  const bySlug = new Map();
  for (const row of rows) bySlug.set(row.slug, [...(bySlug.get(row.slug) ?? []), row]);
  const merges = [];
  const skipped = [];
  for (const [slug, list] of [...bySlug].sort(([a], [b]) => a.localeCompare(b))) {
    const prefixes = [...new Set(list.map((r) => r.prefix))];
    if (prefixes.length < 2) continue;
    const choirs = list.map((r) => r.choir).sort();
    if (choirs.length !== PAIR.length || !PAIR.every((c) => choirs.includes(c))) {
      skipped.push({ slug, why: `on ${choirs.join(", ")}, not just ${PAIR.join(" and ")}` });
      continue;
    }
    const first = list[0];
    if (!list.every((r) => r.title === first.title && r.parts === first.parts && r.duration === first.duration)) {
      skipped.push({ slug, why: "the lists' rows differ in title, parts or length" });
      continue;
    }
    const files = new Map();
    for (const prefix of prefixes) files.set(prefix, await contents(store, prefix));
    if ([...files.values()].some((f) => !f.has("score.mid"))) {
      skipped.push({ slug, why: "a copy has no score.mid" });
      continue;
    }
    const identical = prefixes.every((p) => same(files.get(p), files.get(prefixes[0])));
    const preferred = list.find((r) => r.choir === PREFERRED)?.prefix;
    const newest = [...prefixes].sort((a, b) => versionOf(b).localeCompare(versionOf(a)))[0];
    const keep = identical && preferred ? preferred : newest;
    merges.push({ slug, keep, drop: prefixes.filter((p) => p !== keep), same: identical });
  }
  return { merges, skipped };
}

/** Prints the plan, and with `apply` carries it out. Returns the number of rows left without a score.mid. */
export async function mergeDuplicates(store, { apply = false, log = console.log } = {}) {
  const rows = await store.query("SELECT choir, slug, title, prefix, parts, duration FROM songs ORDER BY slug, choir");
  const { merges, skipped } = await mergePlan(store, rows);
  for (const s of skipped) log(`${s.slug}: skipped, ${s.why}`);
  for (const m of merges) log(`${m.slug}: keep ${m.keep}, drop ${m.drop.join(", ")} (${m.same ? "same files" : "newer"})`);
  if (!apply) {
    log(`${merges.length} songs to merge; nothing changed (run with --apply)`);
    return 0;
  }
  for (const m of merges) {
    for (const prefix of m.drop) {
      await store.query("UPDATE songs SET prefix = ? WHERE slug = ? AND prefix = ?", [m.keep, m.slug, prefix]);
    }
  }
  for (const m of merges) {
    for (const prefix of m.drop) {
      const objects = await store.list(prefix);
      for (const o of objects) {
        try {
          await store.delete(o.key);
        } catch (error) {
          log(`could not delete ${o.key}: ${error.message}`);
        }
      }
      log(`${m.slug}: deleted ${objects.length} files under ${prefix}`);
    }
  }
  // Every row must still have its music.
  const after = await store.query("SELECT choir, slug, prefix FROM songs ORDER BY slug, choir");
  let broken = 0;
  for (const prefix of new Set(after.map((r) => r.prefix))) {
    const names = new Set((await store.list(prefix)).map((o) => o.key.slice(prefix.length)));
    if (!names.has("score.mid")) {
      broken += after.filter((r) => r.prefix === prefix).length;
      log(`no score.mid under ${prefix}`);
    }
  }
  log(`${merges.length} songs merged${broken ? `; ${broken} rows have no score.mid` : ""}`);
  return broken;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply")) {
    console.error("usage: merge-duplicate-songs.mjs [--apply]");
    process.exit(2);
  }
  const broken = await mergeDuplicates(cloudflareStore(process.env), { apply: args.includes("--apply") });
  if (broken > 0) process.exitCode = 1;
}
