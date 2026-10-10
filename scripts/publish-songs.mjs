// Publish song bundles built by song-app (manifest.json, score.musicxml,
// score.mid, timing.json, parts/) to the site's R2 and D1, in the layout of
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
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
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
  // A song keeps the date it first came out, in any choir, so a fixed score or
  // a move does not make it new again. The songs from the old YouTube site
  // carry their upload dates (#18).
  const firstPublished = `COALESCE((SELECT MIN(published_at) FROM songs WHERE slug = ${quote(slug)}), ${quote(publishedAt)})`;
  const sql = "INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at) VALUES ("
    + [quote(choir), quote(slug), quote(title), quote(prefix), quote(partsJson), Number(duration), firstPublished].join(", ")
    + ") ON CONFLICT (choir, slug) DO UPDATE SET title = excluded.title, prefix = excluded.prefix,"
    + " parts = excluded.parts, duration = excluded.duration;"
    // Publishing a song for another choir moves it, as song-app does, except
    // that the public list keeps its copy: a public-domain song may be in a
    // choir's own list too. Publishing to public moves nothing.
    + (choir === "public" ? ""
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
    const plan = publishPlan(manifest, choir, now());
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
