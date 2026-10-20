// Publish song bundles built by song-app (manifest.json, score.musicxml,
// score.mid, timing.json, and parts/<n>-<Name>.mp3 when the parts are sung) to the site's R2 and D1, in the layout of
// song-app's docs/stemmanauhat-site.md. A stand-in until song-app's own publish
// (eerovil/musescore-choir-plugins#382) uploads score.mid. Run it through
// scripts/publish-songs.sh, which puts the bundles where the container sees them.
//
//   node scripts/publish-songs.mjs --remote public .wrangler/publish/<slug> ...
//
// One process does the whole run: the live site through the Cloudflare API, as
// song-app's publish does (eerovil/musescore-choir-plugins src/song_app/publish.py),
// and --local through wrangler's local R2 and D1. A song's files go up first, a
// few at a time, then one D1 query points the song at the new version, so the
// site sees the old version or the whole new one. An older version's files stay
// in R2. The token comes only from scripts/run.sh --cloudflare.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHOIRS = ["jm", "naiskuoro", "public", "testi"];
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

/** What to upload for one bundle and the D1 statement that publishes it. */
export function publishPlan(manifest, choir, date, partFiles = []) {
  if (!CHOIRS.includes(choir)) throw new Error(`unknown choir: ${choir}`);
  const { slug, title, parts, duration } = manifest;
  if (!slug || slug.includes("/") || !title || !Array.isArray(parts) || parts.length === 0 || !(duration > 0)
    || !parts.every((p) => typeof p?.name === "string" && p.name.trim())) {
    throw new Error(`bad manifest for ${slug ?? "?"}`);
  }
  const credits = creditsOf(manifest);
  const version = versionFor(date);
  const prefix = `songs/${choir}/${slug}/${version}/`;
  if (partFiles.length > 0 && partFiles.length !== parts.length) throw new Error(`bad part files for ${slug}`);
  const files = [...FILES, ...partFiles];
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
  const sql = `INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at, ${CREDITS.join(", ")}) VALUES (`
    + [quote(choir), quote(slug), quote(title), quote(prefix), quote(partsJson), Number(duration), firstPublished,
      ...CREDITS.map((name) => (credits[name] ? quote(credits[name]) : "NULL"))].join(", ")
    + ") ON CONFLICT (choir, slug) DO UPDATE SET title = excluded.title, prefix = excluded.prefix,"
    + " parts = excluded.parts, duration = excluded.duration,"
    + CREDITS.map((name) => ` ${name} = excluded.${name}`).join(",") + ";"
    // Publishing a song for another choir moves it, as song-app does, except
    // that the public list keeps its copy: a public-domain song may be in a
    // choir's own list too. Publishing to public or to the test list (#73)
    // moves nothing; publishing to a choir takes it off the test list.
    + (KEEPS_COPIES.includes(choir) ? ""
      : `\nDELETE FROM songs WHERE slug = ${quote(slug)} AND choir NOT IN (${quote(choir)}, 'public');`);
  return { prefix, files, sql, r2Manifest };
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
  return {
    put: (key, data, type) => call("PUT", `/r2/buckets/${BUCKET}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, data, type),
    async sql(sql) {
      const reply = JSON.parse(await call("POST", `/d1/database/${DATABASE_ID}/query`, JSON.stringify({ sql }), "application/json"));
      if (!reply.success) throw new Error(`D1 refused the query: ${JSON.stringify(reply.errors)}`);
    },
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
 * Publish every bundle in `dirs` to `store`. All uploads share one pool; each
 * song's D1 query runs once its own files are up. A song that fails leaves no
 * row and does not stop the others. Returns the number of songs that failed.
 */
export async function publishAll(store, choir, dirs, { log = console.log, now = () => new Date() } = {}) {
  // Check every bundle before anything goes up.
  const songs = dirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const sung = manifest.sung === true ? partFilesIn(dir, manifest.parts ?? []) : [];
    const plan = publishPlan(manifest, choir, now(), sung);
    const missing = plan.files.filter((f) => f !== "manifest.json" && !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`${dir}: missing ${missing.join(", ")}`);
    return { dir, manifest, plan };
  });
  const upload = limiter(UPLOADS_AT_ONCE);
  const results = await Promise.allSettled(songs.map(async ({ dir, manifest, plan }) => {
    const started = Date.now();
    await Promise.all(plan.files.map((f) => upload(() => store.put(plan.prefix + f,
      f === "manifest.json" ? JSON.stringify(plan.r2Manifest) : readFileSync(join(dir, f)),
      TYPES[extname(f)] ?? "application/octet-stream"))));
    await store.sql(plan.sql);
    log(`published ${manifest.title} → ${plan.prefix} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }));
  const failed = results.filter((r) => r.status === "rejected");
  results.forEach((r, i) => r.status === "rejected" && console.error(`not published: ${songs[i].dir}: ${r.reason?.message ?? r.reason}`));
  return failed.length;
}

async function main(args) {
  const where = args.shift();
  const choir = args.shift();
  if (!["--local", "--remote"].includes(where ?? "") || !choir || args.length === 0) {
    console.error("usage: publish-songs.mjs --local|--remote <choir> <bundle-dir> ...");
    process.exit(2);
  }
  const store = where === "--local" ? await localStore() : cloudflareStore(process.env);
  const started = Date.now();
  try {
    const failed = await publishAll(store, choir, args);
    console.log(`${args.length - failed} of ${args.length} songs published in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
