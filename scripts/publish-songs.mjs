// Publish song bundles built by song-app (manifest.json, score.musicxml,
// score.mid, timing.json, parts/) to the site's R2 and D1, in the layout of
// song-app's docs/stemmanauhat-site.md. A stand-in until song-app's own publish
// (eerovil/musescore-choir-plugins#382) uploads score.mid. Run it through
// scripts/publish-songs.sh, which puts the bundles where the container sees them.
//
//   node scripts/publish-songs.mjs --remote public .wrangler/publish/<slug> ...
//
// Every file goes up first, then one D1 upsert points the song at the new
// version, so the site sees the old version or the whole new one. An older
// version's files stay in R2.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHOIRS = ["jm", "naiskuoro", "public"];
const BASE_FILES = ["score.musicxml", "score.mid", "timing.json", "manifest.json"];

/** `2026-10-10T12:00:00.123Z` → `20261010T120000Z`, song-app's version format. */
export function versionFor(date) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** What to upload for one bundle and the D1 statement that publishes it. */
export function publishPlan(manifest, choir, date) {
  if (!CHOIRS.includes(choir)) throw new Error(`unknown choir: ${choir}`);
  const { slug, title, parts, duration } = manifest;
  if (!slug || slug.includes("/") || !title || !Array.isArray(parts) || parts.length === 0 || !(duration > 0)) {
    throw new Error(`bad manifest for ${slug ?? "?"}`);
  }
  const version = versionFor(date);
  const prefix = `songs/${choir}/${slug}/${version}/`;
  const files = [...BASE_FILES, ...parts.map((p) => p.file)];
  const partsJson = JSON.stringify(parts.map(({ name, file }) => ({ name, file })));
  const publishedAt = date.toISOString().replace(/\.\d+Z$/, "Z");
  // The manifest in R2 carries the same facts as the row, as song-app writes it.
  const r2Manifest = { slug, title, choir, version, score: "score.musicxml", timing: "timing.json",
    midi: "score.mid", parts: JSON.parse(partsJson), duration };
  const sql = "INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at) VALUES ("
    + [quote(choir), quote(slug), quote(title), quote(prefix), quote(partsJson), Number(duration), quote(publishedAt)].join(", ")
    + ") ON CONFLICT (choir, slug) DO UPDATE SET title = excluded.title, prefix = excluded.prefix,"
    + " parts = excluded.parts, duration = excluded.duration, published_at = excluded.published_at;"
    // Publishing a song for another choir moves it, as song-app does, except
    // that the public list keeps its copy: a public-domain song may be in a
    // choir's own list too. Publishing to public moves nothing.
    + (choir === "public" ? ""
      : `\nDELETE FROM songs WHERE slug = ${quote(slug)} AND choir NOT IN (${quote(choir)}, 'public');`);
  return { prefix, files, sql, r2Manifest };
}

function main(args) {
  const where = args.shift();
  const choir = args.shift();
  if (!["--local", "--remote"].includes(where ?? "") || !choir || args.length === 0) {
    console.error("usage: publish-songs.mjs --local|--remote <choir> <bundle-dir> ...");
    process.exit(2);
  }
  const wrangler = (...a) => execFileSync("node_modules/.bin/wrangler", a, { stdio: ["ignore", "ignore", "inherit"] });
  const work = ".wrangler/publish-sql";
  mkdirSync(work, { recursive: true });
  for (const dir of args) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const plan = publishPlan(manifest, choir, new Date());
    const missing = plan.files.filter((f) => f !== "manifest.json" && !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`${dir}: missing ${missing.join(", ")}`);
    const manifestFile = join(work, `${basename(dir)}.manifest.json`);
    writeFileSync(manifestFile, JSON.stringify(plan.r2Manifest));
    for (const f of plan.files) {
      wrangler("r2", "object", "put", `stemmanauhat/${plan.prefix}${f}`, where,
        "--file", f === "manifest.json" ? manifestFile : join(dir, f));
    }
    const sqlFile = join(work, `${basename(dir)}.sql`);
    writeFileSync(sqlFile, plan.sql + "\n");
    wrangler("d1", "execute", "stemmanauhat", where, "--file", sqlFile);
    console.log(`published ${manifest.title} → ${plan.prefix}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
