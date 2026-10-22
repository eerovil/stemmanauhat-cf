// Publish song bundles built by song-app (manifest.json, score.musicxml,
// score.mid, timing.json, and parts/<n>-<Name>.mp3 when the parts are sung) to the site's R2 and D1, in the layout of
// song-app's docs/stemmanauhat-site.md. A stand-in until song-app's own publish
// (eerovil/musescore-choir-plugins#382) uploads score.mid. Run it through
// scripts/publish-songs.sh, which puts the bundles where the container sees them.
//
//   node scripts/publish-songs.mjs --remote public .wrangler/publish/<slug> ...
//   node scripts/publish-songs.mjs --remote jm,public .wrangler/publish/<slug> ...
//
// Several lists (#104) share one copy of the files, under the first list's folder.
//
// One process does the whole run: the live site through the Cloudflare API, as
// song-app's publish does (eerovil/musescore-choir-plugins src/song_app/publish.py),
// and --local through wrangler's local R2 and D1. A song's files go up first, a
// few at a time, then one D1 query points the song at the new version, so the
// site sees the old version or the whole new one. An older version's files stay
// in R2. The token comes only from scripts/run.sh --cloudflare.
//
// A part name the voice tree (#107) doesn't know stops the publish before anything goes up; the
// person publishing says where it goes, and it goes in with the song:
//
//   node scripts/publish-songs.mjs --remote joy --place "Bassi=B" .wrangler/publish/<slug>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The choirs in D1 (scripts/add-choir.sh); joy is JOY-kuoro, a mixed choir (#102),
// and joy-alumnit its former singers, sharing JOY's songs (eerovil/eeron-omat-taskit#94).
// laurille is Laurille, a small group singing one song (eerovil/eeron-omat-taskit#97).
// yl is YL, a mixed choir (eerovil/eeron-omat-taskit#104).
export const CHOIRS = ["jm", "naiskuoro", "joy", "joy-alumnit", "laurille", "yl", "public", "testi"];
/**
 * A list whose songs are always on another list too: every JOY-alumnit song is
 * also JOY-kuoro's, but a new JOY-kuoro song is not the alumni's
 * (eerovil/eeron-omat-taskit#101). The worker's move from the test list does the same (ALSO_ON).
 */
export const ALSO_ON = { "joy-alumnit": "joy" };

/** The lists named, each followed by the list it always brings along when that is not named too. */
export function withAlsoOn(choirs) {
  const named = typeof choirs === "string" ? [choirs] : [...choirs];
  return [...named, ...named.map((choir) => ALSO_ON[choir]).filter((also) => also && !named.includes(also))];
}

/** Lists that keep their copy when the song is published elsewhere, and take it off nowhere (#73). */
const KEEPS_COPIES = ["public", "testi"];
const FILES = ["score.musicxml", "score.mid", "timing.json", "manifest.json"];

/** `2026-10-10T12:00:00.123Z` → `20261010T120000Z`, song-app's version format. */
export function versionFor(date) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** Who wrote the song, from the score's metaTags; each may be missing. */
export const CREDITS = ["composer", "lyricist", "arranger"];

/** The manifest's credits that are set, trimmed: `{ composer: "X" }`. A bundle from before them has none. */
export function creditsOf(manifest) {
  const out = {};
  for (const name of CREDITS) {
    const value = manifest[name];
    if (value != null && typeof value !== "string") throw new Error(`bad manifest for ${manifest.slug ?? "?"}: ${name}`);
    if (value?.trim()) out[name] = value.trim();
  }
  return out;
}

/**
 * The sung MP3 of each part in `dir`, in the manifest's part order: parts/1-<Name>.mp3,
 * read only for a bundle whose manifest says `"sung": true` (see publishAll): older
 * song-app bundles carry piano renders under the same names, which are not singing.
 * parts/2-<Name>.mp3 ... (song-app numbers them). [] when the bundle has none;
 * a bundle with some parts' files but not all is refused, not half published.
 */
export function partFilesIn(dir, parts) {
  const partsDir = join(dir, "parts");
  const names = existsSync(partsDir) ? readdirSync(partsDir) : [];
  const files = parts.map((_, i) => names.filter((n) => n.startsWith(`${i + 1}-`) && n.endsWith(".mp3")));
  if (files.every((f) => f.length === 0)) return [];
  if (!files.every((f) => f.length === 1)) throw new Error(`${dir}: parts/ needs exactly one <n>-<Name>.mp3 per part`);
  return files.map((f) => `parts/${f[0]}`);
}

/**
 * What to upload for one bundle and the D1 statement that publishes it. `choirs`
 * is one list or several (#104): the files go up once, under the first one's
 * folder, and every list's row points at them. `shared` are lists D1 already has
 * the song on with the same files (sharingLists): they come from D1, so they need
 * not be in CHOIRS. A named list brings its ALSO_ON list along.
 */
export function publishPlan(manifest, choirs, date, partFiles = [], shared = [], extras = []) {
  const named = withAlsoOn(choirs);
  for (const choir of named) if (!CHOIRS.includes(choir)) throw new Error(`unknown choir: ${choir}`);
  const lists = [...named, ...shared];
  if (lists.length === 0 || new Set(lists).size !== lists.length) throw new Error(`bad choirs: ${lists.join(",")}`);
  // The test list is where a song is tried out alone before a choir gets it (#73).
  if (lists.length > 1 && lists.includes("testi")) throw new Error("the test list cannot be published with others");
  const choir = lists[0];
  const { slug, title, parts, duration } = manifest;
  if (!slug || slug.includes("/") || !title || !Array.isArray(parts) || parts.length === 0 || !(duration > 0)
    || !parts.every((p) => typeof p?.name === "string" && p.name.trim())) {
    throw new Error(`bad manifest for ${slug ?? "?"}`);
  }
  const credits = creditsOf(manifest);
  const version = versionFor(date);
  const prefix = `songs/${choir}/${slug}/${version}/`;
  if (partFiles.length > 0 && partFiles.length !== parts.length) throw new Error(`bad part files for ${slug}`);
  const files = [...FILES, ...partFiles, ...extras];
  // The part names, and each part's sung MP3 only when the bundle has them
  // (partFilesIn), marked `sung` so the player offers them as "Laulu". A name in an
  // older manifest alone is not listed (#36): it points at nothing uploaded.
  // The voice that sings each (the player credits it): the part's own, as a mixed
  // choir's parts name theirs (#102), else the manifest's; REMY when neither names one.
  const voiceOf = (p) => {
    const voice = p.voice ?? manifest.voice;
    if (voice != null && !(typeof voice === "string" && /^[A-Za-z][A-Za-z0-9 ]{0,30}$/.test(voice))) throw new Error(`bad voice for ${slug}`);
    return voice;
  };
  const sungAs = (p, file) => {
    const voice = voiceOf(p);
    return { file, sung: true, ...(voice ? { voice } : {}) };
  };
  // Where a part is drawn when it shares a staff (musescore-choir-plugins#420), kept as song-app wrote it.
  const placed = (p) => {
    const ok = Number.isInteger(p.staff) && p.staff >= 0 && Array.isArray(p.voices) && p.voices.length > 0
      && p.voices.every((v) => Number.isInteger(v) && v >= 1 && v <= 4);
    if (p.staff === undefined && p.voices === undefined) return {};
    if (!ok) throw new Error(`bad staff or voices for ${p.name} in ${slug}`);
    return { staff: p.staff, voices: p.voices };
  };
  const partsJson = JSON.stringify(parts.map((p, i) => ({
    name: p.name, ...placed(p), ...(partFiles[i] ? sungAs(p, partFiles[i]) : {}) })));
  const publishedAt = date.toISOString().replace(/\.\d+Z$/, "Z");
  // The manifest in R2 carries the same facts as the row, as song-app writes it.
  const r2Manifest = { slug, title, choir, version, score: "score.musicxml", timing: "timing.json",
    midi: "score.mid", parts: JSON.parse(partsJson), duration, ...credits };
  // A song keeps the date it first came out, in any choir, so a fixed score or
  // a move does not make it new again. The songs from the old YouTube site
  // carry their upload dates (#18).
  const firstPublished = `COALESCE((SELECT MIN(published_at) FROM songs WHERE slug = ${quote(slug)}), ${quote(publishedAt)})`;
  // Every publish sets all three, so a name taken off the score goes from the site too.
  const upsert = (list) => `INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at, ${CREDITS.join(", ")}) VALUES (`
    + [quote(list), quote(slug), quote(title), quote(prefix), quote(partsJson), Number(duration), firstPublished,
      ...CREDITS.map((name) => (credits[name] ? quote(credits[name]) : "NULL"))].join(", ")
    + ") ON CONFLICT (choir, slug) DO UPDATE SET title = excluded.title, prefix = excluded.prefix,"
    + " parts = excluded.parts, duration = excluded.duration,"
    + CREDITS.map((name) => ` ${name} = excluded.${name}`).join(",") + ";";
  // Publishing a song for other choirs moves it, as song-app does, except
  // that the public list keeps its copy: a public-domain song may be in a
  // choir's own list too. Publishing to public or to the test list (#73)
  // moves nothing; publishing to a choir takes it off the test list.
  const moves = lists.some((list) => !KEEPS_COPIES.includes(list));
  const sql = lists.map(upsert).join("\n")
    + (moves ? `\nDELETE FROM songs WHERE slug = ${quote(slug)} AND choir NOT IN (${[...new Set([...lists, "public"])].map(quote).join(", ")});` : "");
  return { choirs: lists, prefix, files, sql, r2Manifest };
}

/** Names are the same when they differ only in letter case and spaces, as in the player (src/client/player/part.ts). */
const normName = (name) => name.toLowerCase().replace(/\s+/g, "");
const MAX_DEPTH = 4;

/** The voice tree (#107) and the names in no place on purpose, from D1. */
export async function readTree(store) {
  const voices = (await store.query("SELECT id, parent, names FROM voices"))
    .map((r) => ({ id: r.id, parent: r.parent, names: JSON.parse(r.names) }));
  const unplaced = (await store.query("SELECT name FROM unplaced_parts")).map((r) => r.name);
  return { voices, unplaced };
}

/** How many levels down `id` is (1 at the top), or Infinity when its parents are missing or loop. */
function depthOf(voices, id) {
  const seen = new Set();
  for (let v = voices.find((u) => u.id === id); v; v = voices.find((u) => u.id === v.parent)) {
    if (seen.has(v.id)) return Infinity;
    seen.add(v.id);
    if (v.parent === null) return seen.size;
  }
  return Infinity;
}

/**
 * Whether the player can place `name`, the way its placeOf does: one of the names of a place at
 * most four levels down whose parents are all there, a name in no place on purpose, or a split part
 * ("S1b") of a name above the fourth level. A row the player leaves out does not count.
 */
export function knowsName(tree, name) {
  const key = normName(name);
  const depth = (k) => Math.min(Infinity, ...tree.voices
    .filter((v) => v.names.some((n) => normName(n) === k)).map((v) => depthOf(tree.voices, v.id)));
  if (depth(key) <= MAX_DEPTH || tree.unplaced.some((n) => normName(n) === key)) return true;
  return key.length > 1 && key.endsWith("b") && depth(key.slice(0, -1)) < MAX_DEPTH;
}

/** `--place` values: `Name=B2` (an existing place), `Name=B4@B` (a new one under B), `Name=-` (in no place). */
export function parsePlace(text) {
  const eq = text.lastIndexOf("=");
  const name = text.slice(0, eq).trim();
  const target = text.slice(eq + 1).trim();
  const [id, parent] = target.split("@").map((t) => t.trim());
  if (eq < 0 || !name || !id || (parent !== undefined && !parent) || (id === "-" && parent !== undefined)) {
    throw new Error(`bad --place "${text}": use "Name=<id>", "Name=<new id>@<parent id>" or "Name=-"`);
  }
  return { name, id, parent };
}

/**
 * The D1 statement that puts every part name of `songs` the tree doesn't know where the person
 * publishing said (`places`), or "" when there is none. A name with no place given stops the whole
 * publish before anything goes up: where a part belongs is the publisher's call, never a guess.
 */
export function treePlan(tree, songs, places = []) {
  const unknown = new Map();
  for (const { manifest } of songs) {
    for (const { name } of manifest.parts) {
      if (!knowsName(tree, name)) unknown.set(normName(name), [...(unknown.get(normName(name)) ?? []), manifest.slug]);
    }
  }
  const voices = tree.voices.map((v) => ({ ...v, names: [...v.names] }));
  const changed = new Set();
  const created = new Set();
  const unplaced = [];
  for (const { name, id, parent } of places) {
    if (!unknown.has(normName(name))) throw new Error(`--place "${name}": no song here has that part, or it is already in the tree`);
    unknown.delete(normName(name));
    if (id === "-") { unplaced.push(name); continue; }
    let voice = voices.find((v) => v.id === id);
    if (parent !== undefined && !voice) {
      if (depthOf(voices, parent) >= MAX_DEPTH) throw new Error(`--place "${name}": no place ${parent}, or it is at the fourth level`);
      voice = { id, parent, names: [] };
      voices.push(voice);
      created.add(id);
    } else if (!voice || depthOf(voices, id) > MAX_DEPTH || (parent !== undefined && voice.parent !== parent)) {
      throw new Error(`--place "${name}": ${voice && depthOf(voices, id) <= MAX_DEPTH ? `${id} is already under ${voice.parent ?? "nothing"}` : `no place ${id}, or it is below the fourth level or its parents are missing`}`);
    }
    voice.names.push(name);
    if (!created.has(id)) changed.add(id);
  }
  if (unknown.size > 0) {
    const list = [...unknown].map(([key, slugs]) => {
      const name = songs.flatMap((s) => s.manifest.parts).find((p) => normName(p.name) === key).name;
      return `  "${name}" (${[...new Set(slugs)].join(", ")})`;
    });
    throw new Error(["part names not in the voice tree (#107):", ...list,
      "Ask the person publishing where each one goes, then publish again with one of these per name:",
      '  --place "<name>=<id>"            a name of an existing place',
      '  --place "<name>=<new id>@<id>"   a new place under an existing one (four levels at most)',
      '  --place "<name>=-"               in no place: it matches only itself (a solo, a trio)',
      `The places: ${voices.map((v) => `${v.id} (${v.names[0] ?? ""})`).join(", ")}`].join("\n"));
  }
  const json = (v) => quote(JSON.stringify(v.names));
  return [
    ...voices.filter((v) => created.has(v.id)).map((v) =>
      // A new place shows as the name it was made for until someone renames it (README, "Part names").
      `INSERT INTO voices (id, parent, name_fi, name_en, names) VALUES (${quote(v.id)}, ${quote(v.parent)}, ${quote(v.names[0])}, ${quote(v.names[0])}, ${json(v)});`),
    ...voices.filter((v) => changed.has(v.id)).map((v) => `UPDATE voices SET names = ${json(v)} WHERE id = ${quote(v.id)};`),
    ...unplaced.map((name) => `INSERT OR IGNORE INTO unplaced_parts (name) VALUES (${quote(name)});`),
  ].join("\n");
}

const BUCKET = "stemmanauhat";
const DATABASE_ID = "b3d80c7d-0fb7-45a2-b6f6-f7311556b953"; // wrangler.jsonc
const TYPES = { ".musicxml": "application/vnd.recordare.musicxml+xml", ".mid": "audio/midi",
  ".json": "application/json", ".mp3": "audio/mpeg" };
const UPLOADS_AT_ONCE = 6;
const TRIES = 4;

/** The live site's R2 and D1 through the Cloudflare API. */
export function cloudflareStore(env, fetchFn = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = env;
  if (!token || !account) throw new Error("no Cloudflare token: run through scripts/run.sh --cloudflare");
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const objectPath = (key) => `/r2/buckets/${BUCKET}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
  async function call(method, path, body, type) {
    let last;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      if (attempt > 0) await wait(1000 * 2 ** (attempt - 1));
      try {
        const res = await fetchFn(api + path, { method, body, headers: { Authorization: `Bearer ${token}`, "Content-Type": type } });
        const text = await res.text();
        if (res.ok) return text;
        last = `${method} ${path}: Cloudflare said ${res.status} ${text.slice(0, 300)}`;
        if (res.status !== 429 && res.status < 500) break;
      } catch (error) {
        last = `${method} ${path}: ${error.message}`;
      }
    }
    throw new Error(last);
  }
  /** The rows of the last statement in `sql`. */
  async function query(sql, params) {
    const reply = JSON.parse(await call("POST", `/d1/database/${DATABASE_ID}/query`,
      JSON.stringify(params ? { sql, params } : { sql }), "application/json"));
    if (!reply.success) throw new Error(`D1 refused the query: ${JSON.stringify(reply.errors)}`);
    return reply.result?.at(-1)?.results ?? [];
  }
  return {
    put: (key, data, type) => call("PUT", objectPath(key), data, type),
    sql: async (sql) => { await query(sql); },
    query,
    /** Every object under `prefix`: `[{ key, etag, size }]`. */
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const search = new URLSearchParams({ prefix, per_page: "1000", ...(cursor ? { cursor } : {}) });
        const reply = JSON.parse(await call("GET", `/r2/buckets/${BUCKET}/objects?${search}`));
        out.push(...reply.result.map(({ key, etag, size }) => ({ key, etag, size })));
        cursor = reply.result_info?.is_truncated ? reply.result_info.cursor : undefined;
      } while (cursor);
      return out;
    },
    delete: (key) => call("DELETE", objectPath(key)),
    close: async () => {},
  };
}

/** The local site's R2 and D1 in .wrangler/state, the ones `wrangler dev` and `--local` use. */
async function localStore() {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy();
  return {
    put: (key, data, type) => proxy.env.SONGS.put(key, data, { httpMetadata: { contentType: type } }),
    sql: (sql) => proxy.env.DB.exec(sql),
    query: async (sql) => (await proxy.env.DB.prepare(sql).all()).results,
    close: () => proxy.dispose(),
  };
}

/** Run `jobs` (functions returning promises) at most `limit` at a time. */
function limiter(limit) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= limit || queue.length === 0) return;
    running++;
    const { job, resolve, reject } = queue.shift();
    job().then(resolve, reject).finally(() => { running--; next(); });
  };
  return (job) => new Promise((resolve, reject) => { queue.push({ job, resolve, reject }); next(); });
}

/**
 * The other private lists whose row for `slug` points at the same files as a
 * named list's row: the same song on several lists (#104), such as a choir and
 * its alumni (eerovil/eeron-omat-taskit#94). A publish keeps it on them, with
 * the new version, instead of moving it off. public and the test list keep
 * their copy anyway and are left as they are.
 */
export async function sharingLists(store, slug, lists) {
  if (lists.every((list) => KEEPS_COPIES.includes(list))) return [];
  const rows = await store.query(`SELECT DISTINCT b.choir AS choir FROM songs a JOIN songs b ON b.slug = a.slug AND b.prefix = a.prefix
    WHERE a.slug = ${quote(slug)} AND a.choir IN (${lists.map(quote).join(", ")})
      AND b.choir NOT IN (${[...new Set([...lists, ...KEEPS_COPIES])].map(quote).join(", ")}) ORDER BY b.choir`);
  return rows.map((row) => row.choir);
}

/**
 * Publish every bundle in `dirs` to `store`. All uploads share one pool; each
 * song's D1 query runs once its own files are up. A song that fails leaves no
 * row and does not stop the others. Returns the number of songs that failed.
 */
export async function publishAll(store, choirs, dirs, { log = console.log, now = () => new Date(), places = [] } = {}) {
  const named = withAlsoOn(choirs);
  // Check every bundle before anything goes up.
  const songs = [];
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const sung = manifest.sung === true ? partFilesIn(dir, manifest.parts ?? []) : [];
    // What each sung part sings, note by note: the player sings a note parts share
    // once only where their syllables match (eeron-omat-taskit#110).
    const extras = sung.length > 0 && existsSync(join(dir, "words.json")) ? ["words.json"] : [];
    publishPlan(manifest, named, now(), sung);
    const shared = await sharingLists(store, manifest.slug, named);
    if (shared.length > 0) log(`${manifest.title}: also on ${shared.join(", ")} (same files)`);
    const plan = publishPlan(manifest, named, now(), sung, shared, extras);
    const missing = plan.files.filter((f) => f !== "manifest.json" && !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`${dir}: missing ${missing.join(", ")}`);
    songs.push({ dir, manifest, plan });
  }
  // Every part name in the voice tree first (#107), so the player carries a singer's part to it.
  const tree = treePlan(await readTree(store), songs, places);
  if (tree) {
    await store.sql(tree);
    log(`voice tree: ${places.map((p) => `${p.name} → ${p.id === "-" ? "no place" : p.id}`).join(", ")}`);
  }
  const upload = limiter(UPLOADS_AT_ONCE);
  const results = await Promise.allSettled(songs.map(async ({ dir, manifest, plan }) => {
    const started = Date.now();
    await Promise.all(plan.files.map((f) => upload(() => store.put(plan.prefix + f,
      f === "manifest.json" ? JSON.stringify(plan.r2Manifest) : readFileSync(join(dir, f)),
      TYPES[extname(f)] ?? "application/octet-stream"))));
    await store.sql(plan.sql);
    log(`published ${manifest.title} → ${plan.choirs.join(", ")} (${plan.prefix}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }));
  const failed = results.filter((r) => r.status === "rejected");
  results.forEach((r, i) => r.status === "rejected" && console.error(`not published: ${songs[i].dir}: ${r.reason?.message ?? r.reason}`));
  return failed.length;
}

async function main(args) {
  const places = [];
  for (let i = args.indexOf("--place"); i >= 0; i = args.indexOf("--place")) places.push(parsePlace(args.splice(i, 2)[1] ?? ""));
  const where = args.shift();
  const choir = args.shift();
  if (!["--local", "--remote"].includes(where ?? "") || !choir || args.length === 0) {
    console.error('usage: publish-songs.mjs --local|--remote <choir>[,<choir>...] [--place "<name>=<id>"]... <bundle-dir> ...');
    process.exit(2);
  }
  const store = where === "--local" ? await localStore() : cloudflareStore(process.env);
  const started = Date.now();
  try {
    const failed = await publishAll(store, choir.split(","), args, { places });
    console.log(`${args.length - failed} of ${args.length} songs published in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    // A bundle refused before anything went up (a bad manifest, a part name with no place): say why, plainly.
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
