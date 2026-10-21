import { AGENT_SESSION_SECONDS, agentKeyMark, agentSessionValid, readAgentLink } from "./agent";
import { decideAccess, isAdmin, loadFacts, type Access } from "./access";
import type { Env } from "./env";
import { EVENT_MAX_BYTES, parseEvent, POPULAR_DAYS, POPULAR_MIN_SECONDS, SETTING_DEFAULTS, SETTING_NAMES } from "./events";
import { serveObject, safeSongPath } from "./files";
import { AUTHORIZE_URL, TOKEN_URL, authorizeUrl, exchangeCode, normalizeEmail, readEmail } from "./google";
import { joinUrl, linkKey } from "./links";
import { publicOrigin } from "./origin";
import { isPdf, parseFlag, parseRequest, PDF_MAX_BYTES, pdfTitle, requestPdfKey } from "./requests";
import { requestLang, serverMessage, type ServerLang } from "./messages";
import { newPassphraseRecord, passphraseMatches } from "./passphrase";
import { clearSessionCookie, readSession, sessionCookie, type Session } from "./session";
import { base64UrlEncode, cookieValue, readValue, signValue } from "./signing";

const OAUTH_COOKIE = "stemmanauhat_oauth";
const OAUTH_SECONDS = 10 * 60;
const LINK_TRIES_PER_HOUR = 10;

interface Ctx {
  env: Env;
  request: Request;
  url: URL;
  now: number;
  secret: string;
  session: Session | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (!env.SESSION_SECRET) return new Response("Not configured: SESSION_SECRET is missing", { status: 503 });
    const now = Math.floor(Date.now() / 1000);
    let session = await readSession(request, env.SESSION_SECRET, now);
    // An agent's session ends with the key that started it (#79).
    if (session && !(await agentSessionValid(session, env.AGENT_LOGIN_SECRET))) session = null;
    const ctx: Ctx = { env, request, url, now, secret: env.SESSION_SECRET, session };
    try {
      return await route(ctx);
    } catch (error) {
      // decodeURIComponent on a bad escape such as /c/% is the caller's mistake.
      if (error instanceof URIError) return new Response("Bad address", { status: 400 });
      throw error;
    }
  },
};

async function route(ctx: Ctx): Promise<Response> {
  const { url, request } = ctx;
  const path = url.pathname;
  const method = request.method;
  let m: RegExpExecArray | null;

  // An agent's session (#79) only reads: no requests, flags or admin changes.
  if (ctx.session?.agent && method !== "GET" && method !== "HEAD" && path !== "/auth/logout") {
    return json({ error: "read-only" }, 403);
  }
  if (path === "/" && method === "GET") return home(ctx);
  if (path === "/auth/login" && method === "GET") return login(ctx);
  if (path === "/auth/agent" && method === "GET") return agentLogin(ctx);
  if (path === "/auth/callback" && method === "GET") return callback(ctx);
  if (path === "/auth/logout" && method === "POST") {
    return redirect("/", { "Set-Cookie": clearSessionCookie() });
  }
  if (path === "/api/me" && method === "GET") return me(ctx);
  if (path === "/api/songs" && method === "GET") return songList(ctx, url.searchParams.get("choir") ?? "");
  if ((m = /^\/api\/songs\/([^/]+)\/([^/]+)$/.exec(path)) && method === "GET") {
    return song(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
  }
  if ((m = /^\/api\/songs\/([^/]+)\/([^/]+)\/flags$/.exec(path)) && method === "POST") {
    return sendFlag(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
  }
  if ((m = /^\/files\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(path)) && method === "GET") {
    return file(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!), decodeURIComponent(m[3]!),
      decodeURIComponent(m[4]!));
  }
  if ((m = /^\/sound\/([a-z0-9-]+\.sf3)$/.exec(path)) && method === "GET") {
    // The piano the player plays every song with: MuseScore's own, MIT licensed,
    // not a song file, so it needs no sign-in. See scripts/make-piano-soundfont.mjs.
    return serveObject(ctx.env.SONGS, `sound/${m[1]!}`, ctx.request, "public, max-age=31536000, immutable");
  }
  if ((m = /^\/c\/([^/]+)(?:\/[^/]+)?\/?$/.exec(path)) && method === "GET") {
    return choirPage(ctx, decodeURIComponent(m[1]!));
  }
  if (path === "/api/requests" && method === "POST") return sendRequest(ctx);
  if (path === "/api/events" && method === "POST") return recordEvent(ctx);
  if (path === "/admin" && method === "GET") return adminPage(ctx);
  if (path === "/api/admin" && method === "GET") return adminState(ctx);
  if (path === "/api/admin/members" && method === "POST") return adminMembers(ctx);
  if (path === "/api/admin/link" && method === "POST") return adminLink(ctx);
  if (path === "/api/admin/setlists" && method === "POST") return adminSetlists(ctx);
  if (path === "/api/admin/requests" && method === "POST") return adminRequests(ctx);
  if (path === "/api/admin/move" && method === "POST") return adminMove(ctx);
  if ((m = /^\/api\/admin\/requests\/(\d+)\/pdf$/.exec(path)) && method === "GET") return requestPdf(ctx, Number(m[1]));
  if (path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/files/") || path.startsWith("/sound/")) {
    return json({ error: "not found" }, 404);
  }
  return ctx.env.ASSETS.fetch(request);
}

// ---------------------------------------------------------------- pages

async function home(ctx: Ctx): Promise<Response> {
  const user = ctx.url.searchParams.get("user");
  if (user) return oldLink(ctx, user, ctx.url.searchParams.get("passphrase"));
  const choirs = (await visibleChoirs(ctx)).filter((c) => !c.public);
  if (choirs.length === 1) return redirect(`/c/${encodeURIComponent(choirs[0]!.id)}`);
  return spa(ctx, 200);
}

/**
 * The old site's links, forwarded by the redirect in eerovil/stemmanauhat:
 * `?user=jm&passphrase=...`. A right passphrase signs this browser in to that
 * choir; either way the passphrase leaves the address bar.
 */
async function oldLink(ctx: Ctx, choir: string, passphrase: string | null): Promise<Response> {
  const target = `/c/${encodeURIComponent(choir)}`;
  if (!passphrase) return redirect(target);
  const link = await ctx.env.DB.prepare(
    "SELECT salt, hash, iterations, generation FROM choir_links WHERE choir = ? AND hash IS NOT NULL",
  ).bind(choir).first<{ salt: string; hash: string; iterations: number; generation: number }>();
  const ip = ctx.request.headers.get("CF-Connecting-IP") ?? "local";
  const since = ctx.now - 3600;
  const tries = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM link_attempts WHERE ip = ? AND at > ?")
    .bind(ip, since).first<{ n: number }>();
  const blocked = (tries?.n ?? 0) >= LINK_TRIES_PER_HOUR;
  if (link && !blocked && (await passphraseMatches(passphrase, link))) {
    const links = { ...(ctx.session?.links ?? {}), [choir]: link.generation };
    const cookie = await sessionCookie(ctx.secret, { email: ctx.session?.email, links }, ctx.now);
    return redirect(target, { "Set-Cookie": cookie });
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM link_attempts WHERE at <= ?").bind(since),
    ctx.env.DB.prepare("INSERT INTO link_attempts (ip, at) VALUES (?, ?)").bind(ip, ctx.now),
  ]);
  return redirect(target);
}

async function choirPage(ctx: Ctx, choir: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access === "signin") return redirect(signinUrl(ctx.url.pathname));
  return spa(ctx, statusOf(access));
}

async function adminPage(ctx: Ctx): Promise<Response> {
  if (!ctx.session?.email) return redirect(signinUrl("/admin"));
  return spa(ctx, (await isAdmin(ctx.env.DB, ctx.session)) ? 200 : 403);
}

/** The Vue app's index.html, with the status the Worker decided. */
async function spa(ctx: Ctx, status: number): Promise<Response> {
  const page = await ctx.env.ASSETS.fetch(new Request(new URL("/", ctx.url)));
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(page.body, { status, headers });
}

// ---------------------------------------------------------------- sign-in

async function login(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response("Not configured: Google sign-in is missing", { status: 503 });
  }
  const state = randomToken();
  const nonce = randomToken();
  const next = safeNext(ctx.url.searchParams.get("next"));
  const cookie = await signValue(ctx.secret, { state, nonce, next, exp: ctx.now + OAUTH_SECONDS });
  const location = authorizeUrl(env.GOOGLE_AUTH_URL ?? AUTHORIZE_URL, env.GOOGLE_CLIENT_ID,
    `${publicOrigin(ctx.url, ctx.request.headers, ctx.env)}/auth/callback`, state, nonce);
  return redirect(location, {
    "Set-Cookie": `${OAUTH_COOKIE}=${cookie}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_SECONDS}`,
  });
}

async function callback(ctx: Ctx): Promise<Response> {
  const { env, url } = ctx;
  const pending = (await readValue(ctx.secret,
    cookieValue(ctx.request.headers.get("Cookie"), OAUTH_COOKIE))) as
    { state?: string; nonce?: string; next?: string; exp?: number } | null;
  const code = url.searchParams.get("code");
  if (!pending || !pending.state || !pending.nonce || (pending.exp ?? 0) <= ctx.now
    || url.searchParams.get("state") !== pending.state || !code
    || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return redirect(signinUrl("/", "failed"));
  }
  const idToken = await exchangeCode(env.GOOGLE_TOKEN_URL ?? TOKEN_URL, env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET, `${publicOrigin(url, ctx.request.headers, ctx.env)}/auth/callback`, code);
  const email = idToken && readEmail(idToken, env.GOOGLE_CLIENT_ID, pending.nonce, ctx.now);
  if (!email) return redirect(signinUrl(safeNext(pending.next ?? "/"), "failed"));

  await joinLinkedChoirs(ctx, email);
  const headers = new Headers({ Location: safeNext(pending.next ?? "/") });
  headers.append("Set-Cookie", await sessionCookie(ctx.secret, { email, links: ctx.session?.links }, ctx.now));
  headers.append("Set-Cookie", `${OAUTH_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

/**
 * An agent's login link (#79). It starts a fresh one-hour session for the
 * choirs it names, with no email and no links, so never an admin's.
 */
async function agentLogin(ctx: Ctx): Promise<Response> {
  const secret = ctx.env.AGENT_LOGIN_SECRET;
  if (!secret) return json({ error: "not found" }, 404);
  const choirs = await readAgentLink(secret, ctx.url.searchParams.get("t"), ctx.now);
  if (!choirs) return redirect(signinUrl("/", "failed"));
  console.log("agent sign-in", JSON.stringify({ choirs, until: ctx.now + AGENT_SESSION_SECONDS }));
  const next = ctx.url.searchParams.get("next");
  const target = next ? safeNext(next) : `/c/${encodeURIComponent(choirs[0]!)}`;
  return redirect(target, {
    "Set-Cookie": await sessionCookie(ctx.secret, { agent: choirs, agentKey: await agentKeyMark(secret) }, ctx.now,
      AGENT_SESSION_SECONDS),
  });
}

/**
 * Signing in with Google while holding a choir's current link makes that
 * Google account a member, so the person stays in on every device and after
 * the link changes. Holding the link is the proof, as it is for the link itself.
 */
async function joinLinkedChoirs(ctx: Ctx, email: string): Promise<void> {
  const db = ctx.env.DB;
  const at = new Date(ctx.now * 1000).toISOString();
  const joins = [];
  for (const [choir, generation] of Object.entries(ctx.session?.links ?? {})) {
    const facts = await loadFacts(db, ctx.session, choir);
    if (facts.choirPublic || facts.linkGeneration === null || facts.linkGeneration !== generation) continue;
    joins.push(db.prepare("INSERT INTO members (choir, email, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(choir, email, at));
  }
  if (joins.length) await db.batch(joins);
}

function signinUrl(next: string, error?: string): string {
  const query = new URLSearchParams({ next });
  if (error) query.set("error", error);
  return `/signin?${query}`;
}

/**
 * Only a path on this site. `//evil.example` is another site, and browsers
 * drop tabs and newlines from a Location, so `/\t/evil.example` is one too:
 * refuse control characters outright, then check the resolved origin.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "https://stemmanauhat.invalid";
  try {
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

// ---------------------------------------------------------------- API

async function me(ctx: Ctx): Promise<Response> {
  return json({
    email: ctx.session?.email ?? null,
    linked: Object.keys(ctx.session?.links ?? {}),
    agent: ctx.session?.agent !== undefined,
    admin: await isAdmin(ctx.env.DB, ctx.session),
    choirs: await visibleChoirs(ctx),
    joinable: await joinableChoirs(ctx),
  });
}

/** Choirs this browser is in only by link, which its Google account could join. */
async function joinableChoirs(ctx: Ctx): Promise<string[]> {
  const out = [];
  for (const [choir, generation] of Object.entries(ctx.session?.links ?? {})) {
    const facts = await loadFacts(ctx.env.DB, ctx.session, choir);
    if (!facts.choirPublic && facts.linkGeneration === generation && !facts.isMember) out.push(choir);
  }
  return out;
}

/** Every choir this visitor may open, public ones included. */
async function visibleChoirs(ctx: Ctx): Promise<{ id: string; name: string; public: boolean; staging: boolean }[]> {
  const { results } = await ctx.env.DB.prepare("SELECT id, name, public, staging FROM choirs ORDER BY name").all<
    { id: string; name: string; public: number; staging: number }>();
  const out = [];
  for (const row of results) {
    if ((await accessTo(ctx, row.id)) === "ok") {
      out.push({ id: row.id, name: row.name, public: row.public === 1, staging: row.staging === 1 });
    }
  }
  return out;
}

/** Who wrote the song (migrations/0004); NULL when the score does not say. */
const CREDITS = "composer, lyricist, arranger";
interface SongRow {
  slug: string; title: string; parts: string; duration: number; published_at: string;
  composer: string | null; lyricist: string | null; arranger: string | null;
}

/** Songs in popularity order, those tied on people and listening time in one group. */
export function popularGroups(rows: { song: string; people: number; seconds: number }[]): string[][] {
  const groups: string[][] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (prev && prev.people === r.people && prev.seconds === r.seconds) groups.at(-1)!.push(r.song);
    else groups.push([r.song]);
  });
  return groups;
}

async function songList(ctx: Ctx, choir: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  const choirRow = await ctx.env.DB.prepare("SELECT name FROM choirs WHERE id = ?").bind(choir)
    .first<{ name: string }>();
  const { results } = await ctx.env.DB.prepare(
    `SELECT slug, title, parts, duration, published_at, ${CREDITS} FROM songs WHERE choir = ?`,
  ).bind(choir).all<SongRow>();
  const lists = await ctx.env.DB.prepare(
    "SELECT id, name, songs FROM setlists WHERE choir = ? ORDER BY updated_at DESC, id DESC",
  ).bind(choir).all<{ id: number; name: string; songs: string }>();
  // The choir's open requests, for every singer to see (Eero, #38); who sent
  // them and their PDFs are for admins only. A song's flags (#41) show in its
  // player, not here; the list only counts them for the admin's link.
  const requests = await ctx.env.DB.prepare(
    `SELECT id, title, credits, note, pdf, created_at FROM song_requests
      WHERE choir = ? AND done_at IS NULL AND song IS NULL ORDER BY created_at DESC, id DESC`,
  ).bind(choir).all<{ id: number; title: string | null; credits: string | null; note: string | null; pdf: number;
    created_at: string }>();
  const flags = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM song_requests WHERE choir = ? AND done_at IS NULL AND song IS NOT NULL",
  ).bind(choir).first<{ n: number }>();
  // Songs popular lately (#89), most listened first: by people, then listening time. Only
  // the order leaves here, never counts or names, so singers can't see who practised what.
  // Songs tied on both share a group, which the list sorts by name in the singer's language.
  const since = new Date((ctx.now - POPULAR_DAYS * 24 * 60 * 60) * 1000).toISOString();
  const popular = await ctx.env.DB.prepare(
    `SELECT song, COUNT(DISTINCT ${PERSON}) AS people, SUM(seconds) AS seconds FROM events
      WHERE choir = ? AND name = 'listen' AND admin = 0 AND song IS NOT NULL AND seconds >= ? AND at >= ?
      GROUP BY song ORDER BY people DESC, seconds DESC`,
  ).bind(choir, POPULAR_MIN_SECONDS, since).all<{ song: string; people: number; seconds: number }>();
  // A song that has left the choir is skipped; the next save drops it for good.
  const slugs = new Set(results.map((r) => r.slug));
  return json({
    choir: { id: choir, name: choirRow?.name ?? choir },
    songs: results.map((r) => ({ ...r, parts: JSON.parse(r.parts) })),
    setlists: lists.results.map((l) => ({
      id: l.id, name: l.name, songs: (JSON.parse(l.songs) as string[]).filter((slug) => slugs.has(slug)),
    })),
    requests: requests.results.map((r) => ({ ...r, pdf: r.pdf === 1 })),
    openFlags: flags?.n ?? 0,
    popular: popularGroups(popular.results.filter((r) => slugs.has(r.song))),
  });
}

async function song(ctx: Ctx, choir: string, slug: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  const row = await ctx.env.DB.prepare(
    `SELECT slug, title, parts, duration, published_at, ${CREDITS}, prefix FROM songs WHERE choir = ? AND slug = ?`,
  ).bind(choir, slug).first<SongRow & { prefix: string }>();
  if (row === null) return json({ error: "unknown" }, 404);
  const { prefix, ...song } = row;
  // The version is in the address, so a republished song is a new URL and the
  // year-long cache on /files never serves the old one.
  const base = `/files/${encodeURIComponent(choir)}/${encodeURIComponent(slug)}/${encodeURIComponent(versionOf(prefix))}/`;
  // Open flags (#41), for every singer to see; who sent them is for admins only.
  const flags = await ctx.env.DB.prepare(
    `SELECT id, bar, problems, note, created_at FROM song_requests
      WHERE choir = ? AND song = ? AND done_at IS NULL ORDER BY created_at DESC, id DESC`,
  ).bind(choir, slug).all<{ id: number; bar: number | null; problems: string | null; note: string | null;
    created_at: string }>();
  // The voice tree (#107): which part names mean the same voice. A song still loads without it.
  const voices = await ctx.env.DB.prepare("SELECT id, parent, name_fi, name_en, names FROM voices")
    .all<VoiceRow>().then((r) => parseVoices(r.results), () => []);
  return json({
    ...song, parts: JSON.parse(row.parts), choir, base,
    flags: flags.results.map((f) => ({ ...f, problems: problemList(f.problems) })),
    voices,
  });
}

interface VoiceRow {
  id: string;
  parent: string | null;
  name_fi: string;
  name_en: string;
  names: string;
}

/** The `voices` rows as the player reads them; a row whose names are not a JSON list of strings is left out. */
export function parseVoices(rows: VoiceRow[]): { id: string; parent: string | null; fi: string; en: string; names: string[] }[] {
  return rows.flatMap((r) => {
    try {
      const names: unknown = JSON.parse(r.names);
      if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) return [];
      return [{ id: r.id, parent: r.parent, fi: r.name_fi, en: r.name_en, names }];
    } catch {
      return [];
    }
  });
}

/** The last folder of a song's R2 prefix: `songs/jm/x/20261009T120000Z/` → `20261009T120000Z`. */
export function versionOf(prefix: string): string {
  return prefix.split("/").filter(Boolean).pop() ?? "";
}

async function file(ctx: Ctx, choir: string, slug: string, version: string, path: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return new Response(access, { status: statusOf(access) });
  if (!safeSongPath(path)) return new Response("Bad path", { status: 400 });
  const row = await ctx.env.DB.prepare("SELECT prefix FROM songs WHERE choir = ? AND slug = ?")
    .bind(choir, slug).first<{ prefix: string }>();
  // An old version's address: its files are gone from R2, and serving the new
  // ones under it would put them in a cache entry meant for the old version.
  if (row === null || versionOf(row.prefix) !== version) return new Response("Not found", { status: 404 });
  try {
    return await serveObject(ctx.env.SONGS, row.prefix + path, ctx.request);
  } catch {
    // R2 refuses a range past the end of the object.
    return new Response("Range not satisfiable", { status: 416 });
  }
}

// ---------------------------------------------------------------- admin

async function adminState(ctx: Ctx): Promise<Response> {
  if (!(await isAdmin(ctx.env.DB, ctx.session))) return json({ error: "refused" }, 403);
  const db = ctx.env.DB;
  const [choirs, members, links, admins, requests] = await db.batch([
    db.prepare("SELECT id, name, public, staging FROM choirs ORDER BY name"),
    db.prepare("SELECT choir, email, added_at FROM members ORDER BY email"),
    db.prepare("SELECT choir, salt, hash, iterations, generation FROM choir_links WHERE hash IS NOT NULL"),
    db.prepare("SELECT email FROM admins ORDER BY email"),
    db.prepare(`SELECT id, choir, title, credits, note, requester, pdf, done_at, created_at, song, bar, problems, part
                FROM song_requests ORDER BY created_at DESC, id DESC`),
  ]);
  type Member = { choir: string; email: string; added_at: string };
  type Link = { choir: string; salt: string; hash: string; iterations: number; generation: number };
  type Request = { id: number; choir: string; title: string | null; credits: string | null; note: string | null;
    requester: string | null; pdf: number; done_at: string | null; created_at: string; song: string | null;
    bar: number | null; problems: string | null; part: string | null };
  const origin = publicOrigin(ctx.url, ctx.request.headers, ctx.env);
  const out = [];
  // The test list has no members, link or requests to manage (#73).
  for (const c of (choirs!.results as { id: string; name: string; public: number; staging: number }[])
    .filter((c) => c.public !== 1 && c.staging !== 1)) {
    const link = (links!.results as Link[]).find((l) => l.choir === c.id);
    // A link set by passphrase (set-passphrase.sh, or the old site's) works but
    // cannot be shown: only its hash is stored. "New link" replaces it.
    const key = link ? await linkKey(ctx.secret, c.id, link.generation) : null;
    const url = link && key && (await passphraseMatches(key, link)) ? joinUrl(origin, c.id, key) : null;
    out.push({
      id: c.id,
      name: c.name,
      members: (members!.results as Member[]).filter((m) => m.choir === c.id)
        .map((m) => ({ email: m.email, added_at: m.added_at })),
      link: link !== undefined,
      url,
      requests: (requests!.results as Request[]).filter((r) => r.choir === c.id)
        .map(({ choir: _, ...r }) => ({ ...r, pdf: r.pdf === 1, problems: problemList(r.problems) })),
    });
  }
  return json({
    choirs: out,
    admins: (admins!.results as { email: string }[]).map((a) => a.email),
    ...(await usage(ctx)),
  });
}

/** How a usage event's person is counted: the Google email, else the device. */
const PERSON = "COALESCE(email, visitor)";
const USAGE_DAYS = 30;
const EVENT_KEEP_DAYS = 365;
const LATEST_LISTENS = 50;

/**
 * The admin page's usage numbers (eerovil/eeron-omat-taskit#72): per choir, the
 * last 30 days' people at each step towards the singing and who saw the install
 * notice and who use the installed app (#91); site-wide, how each
 * setting is used; and the latest listens. Events over a year old go first.
 */
async function usage(ctx: Ctx) {
  const db = ctx.env.DB;
  const since = (days: number) => new Date((ctx.now - days * 24 * 60 * 60) * 1000).toISOString();
  const from = since(USAGE_DAYS);
  const person = "COALESCE(e.email, e.visitor)";
  const sung = (where: string) => `COUNT(DISTINCT CASE WHEN e.sung = 1 AND ${where} THEN ${person} END)`;
  const [, choirs, changed, listened, latest] = await db.batch([
    db.prepare("DELETE FROM events WHERE at < ?").bind(since(EVENT_KEEP_DAYS)),
    db.prepare(`SELECT e.choir AS id, COALESCE(c.name, e.choir) AS name,
                       COUNT(DISTINCT ${person}) AS people,
                       ${sung("e.name = 'song_open'")} AS songOpens,
                       ${sung("e.name = 'settings_open'")} AS settingsOpens,
                       ${sung("e.name = 'sound_choice' AND e.value = 'sung'")} AS choseSung,
                       ${sung("e.name = 'listen' AND e.value = 'sung'")} AS playedSung,
                       ${sung("e.name = 'listen' AND e.value = 'sung' AND e.seconds >= 60")} AS playedSungMinute,
                       COUNT(DISTINCT CASE WHEN e.name = 'install_shown' THEN ${person} END) AS sawInstall,
                       COUNT(DISTINCT CASE WHEN e.name IN ('install_accept', 'app_open') THEN ${person} END) AS installed
                  FROM events e LEFT JOIN choirs c ON c.id = e.choir
                 WHERE e.admin = 0 AND e.at >= ? GROUP BY e.choir ORDER BY name`).bind(from),
    db.prepare(`SELECT setting, COUNT(DISTINCT ${PERSON}) AS people FROM events
                 WHERE admin = 0 AND name = 'setting' AND at >= ? GROUP BY setting`).bind(from),
    db.prepare(`SELECT json_each.key AS setting, json_each.value AS value, SUM(events.seconds) AS seconds
                  FROM events, json_each(events.settings)
                 WHERE events.admin = 0 AND events.name = 'listen' AND events.at >= ?
                 GROUP BY json_each.key, json_each.value`).bind(from),
    db.prepare(`SELECT e.at, e.choir, e.email, e.admin, e.song, s.title, e.part, e.value, e.seconds
                  FROM events e LEFT JOIN songs s ON s.choir = e.choir AND s.slug = e.song
                 WHERE e.name = 'listen' ORDER BY e.at DESC, e.id DESC LIMIT ?`).bind(LATEST_LISTENS),
  ]);
  const people = new Map((changed!.results as { setting: string; people: number }[]).map((r) => [r.setting, r.people]));
  const time = listened!.results as { setting: string; value: string; seconds: number }[];
  const settings = SETTING_NAMES.map((setting) => {
    const rows = time.filter((r) => r.setting === setting);
    const total = rows.reduce((sum, r) => sum + r.seconds, 0);
    const others = rows.filter((r) => r.value !== SETTING_DEFAULTS[setting]).sort((a, b) => b.seconds - a.seconds);
    const atDefault = total - others.reduce((sum, r) => sum + r.seconds, 0);
    return {
      setting,
      default: SETTING_DEFAULTS[setting],
      changedBy: people.get(setting) ?? 0,
      /** The share of listening time at the default, 0–1; null with no listens yet. */
      defaultShare: total ? atDefault / total : null,
      topOther: others[0]?.value ?? null,
    };
  });
  type Listen = { at: string; choir: string; email: string | null; admin: number; song: string | null;
    title: string | null; part: string | null; value: string; seconds: number };
  return {
    usage: choirs!.results,
    settings,
    listens: (latest!.results as Listen[]).map((l) => ({ ...l, admin: l.admin === 1 })),
  };
}

async function adminBody(ctx: Ctx): Promise<Record<string, unknown> | Response> {
  if (!(await isAdmin(ctx.env.DB, ctx.session))) return json({ error: "refused" }, 403);
  // A cross-site form cannot send JSON without a preflight, so this plus the
  // SameSite cookie is the CSRF guard.
  if (!(ctx.request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return json({ error: "send JSON" }, 415);
  }
  try {
    const body = await ctx.request.json();
    if (typeof body === "object" && body !== null) return body as Record<string, unknown>;
  } catch { /* fall through */ }
  return json({ error: "bad JSON" }, 400);
}

/** A choir with members of its own: not the open list, and not the test list (#73). */
async function privateChoir(ctx: Ctx, choir: unknown): Promise<string | null> {
  if (typeof choir !== "string") return null;
  const row = await ctx.env.DB.prepare("SELECT public, staging FROM choirs WHERE id = ?").bind(choir)
    .first<{ public: number; staging: number }>();
  return row && row.public !== 1 && row.staging !== 1 ? choir : null;
}

/** Splits pasted text (one per line, commas, spaces) into emails. */
export function parseEmails(value: unknown): string[] {
  const items = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  return [...new Set(items.flatMap((item) => item.split(/[\s,;]+/))
    .map(normalizeEmail)
    .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)))];
}

async function adminMembers(ctx: Ctx): Promise<Response> {
  const body = await adminBody(ctx);
  if (body instanceof Response) return body;
  const choir = await privateChoir(ctx, body.choir);
  if (!choir) return json({ error: "unknown choir" }, 400);
  const add = parseEmails(body.add);
  const remove = parseEmails(body.remove);
  const db = ctx.env.DB;
  const at = new Date(ctx.now * 1000).toISOString();
  const statements = [
    ...add.map((email) => db.prepare(
      "INSERT INTO members (choir, email, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(choir, email, at)),
    ...remove.map((email) => db.prepare("DELETE FROM members WHERE choir = ? AND email = ?").bind(choir, email)),
  ];
  if (statements.length) await db.batch(statements);
  return json({ added: add, removed: remove });
}

async function adminLink(ctx: Ctx): Promise<Response> {
  const body = await adminBody(ctx);
  if (body instanceof Response) return body;
  const choir = await privateChoir(ctx, body.choir);
  if (!choir) return json({ error: "unknown choir" }, 400);
  const db = ctx.env.DB;
  if (body.off === true) {
    await db.prepare(
      `INSERT INTO choir_links (choir, salt, hash, generation) VALUES (?1, NULL, NULL, 1)
       ON CONFLICT (choir) DO UPDATE SET salt = NULL, hash = NULL, generation = generation + 1`,
    ).bind(choir).run();
    return json({ link: false });
  }
  if (body.renew === true) {
    const current = await db.prepare("SELECT generation FROM choir_links WHERE choir = ?").bind(choir)
      .first<{ generation: number }>();
    const generation = (current?.generation ?? 0) + 1;
    const key = await linkKey(ctx.secret, choir, generation);
    const record = await newPassphraseRecord(key);
    await db.prepare(
      `INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (choir) DO UPDATE SET salt = ?2, hash = ?3, iterations = ?4, generation = ?5`,
    ).bind(choir, record.salt, record.hash, record.iterations, generation).run();
    return json({ link: true, url: joinUrl(publicOrigin(ctx.url, ctx.request.headers, ctx.env), choir, key) });
  }
  const passphrase = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
  if (passphrase.length < 6) return json({ error: serverMessage(requestLang(ctx.request)).passphraseShort }, 400);
  const record = await newPassphraseRecord(passphrase);
  await db.prepare(
    `INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT (choir) DO UPDATE SET salt = ?2, hash = ?3, iterations = ?4, generation = generation + 1`,
  ).bind(choir, record.salt, record.hash, record.iterations).run();
  return json({ link: true });
}

const SETLIST_NAME_MAX = 80;
const SETLIST_SONGS_MAX = 200;

/**
 * A setlist as an admin sent it: a name and the choir's songs in order.
 * Returns the error to show instead when it is not one.
 */
export function parseSetlist(body: Record<string, unknown>, choirSlugs: Set<string>, lang: ServerLang = "fi"):
  { name: string; songs: string[] } | { error: string } {
  const say = serverMessage(lang);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > SETLIST_NAME_MAX) return { error: say.setlistNameLength(SETLIST_NAME_MAX) };
  const songs = body.songs;
  if (!Array.isArray(songs) || songs.length > SETLIST_SONGS_MAX
    || !songs.every((slug) => typeof slug === "string" && choirSlugs.has(slug))
    || new Set(songs).size !== songs.length) {
    return { error: say.badSongList };
  }
  return { name, songs };
}

async function adminSetlists(ctx: Ctx): Promise<Response> {
  const body = await adminBody(ctx);
  if (body instanceof Response) return body;
  const db = ctx.env.DB;
  const choir = typeof body.choir === "string" ? body.choir : "";
  const exists = await db.prepare("SELECT 1 AS yes FROM choirs WHERE id = ?").bind(choir).first();
  if (!exists) return json({ error: "unknown choir" }, 400);
  let id: number | null = null;
  if (body.id !== undefined) {
    if (typeof body.id !== "number") return json({ error: "unknown setlist" }, 400);
    const row = await db.prepare("SELECT id FROM setlists WHERE id = ? AND choir = ?").bind(body.id, choir)
      .first<{ id: number }>();
    if (!row) return json({ error: "unknown setlist" }, 400);
    id = row.id;
  }
  if (body.delete === true) {
    if (id === null) return json({ error: "unknown setlist" }, 400);
    await db.prepare("DELETE FROM setlists WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }
  const { results } = await db.prepare("SELECT slug FROM songs WHERE choir = ?").bind(choir).all<{ slug: string }>();
  const setlist = parseSetlist(body, new Set(results.map((r) => r.slug)), requestLang(ctx.request));
  if ("error" in setlist) return json(setlist, 400);
  const at = new Date(ctx.now * 1000).toISOString();
  if (id === null) {
    const row = await db.prepare(
      "INSERT INTO setlists (choir, name, songs, updated_at) VALUES (?, ?, ?, ?) RETURNING id",
    ).bind(choir, setlist.name, JSON.stringify(setlist.songs), at).first<{ id: number }>();
    return json({ id: row!.id });
  }
  await db.prepare("UPDATE setlists SET name = ?, songs = ?, updated_at = ? WHERE id = ?")
    .bind(setlist.name, JSON.stringify(setlist.songs), at, id).run();
  return json({ id });
}

// ---------------------------------------------------------------- the test list

/**
 * A list whose songs are always on another list too: every JOY-alumnit song is
 * also JOY-kuoro's, but not the other way (eerovil/eeron-omat-taskit#101).
 * scripts/publish-songs.mjs has the same ALSO_ON.
 */
export const ALSO_ON: Record<string, string> = { "joy-alumnit": "joy" };

/**
 * Moves a tried-out song from the test list to a choir's list (#73). Its files
 * are copied to the choir's own folder first, since song-app deletes a
 * version's files when it publishes to the test list again; then one D1 batch
 * points the choir at the copy and takes the song off the test list. A song the
 * choir already has is replaced, as a new publish would, and keeps its date.
 */
async function adminMove(ctx: Ctx): Promise<Response> {
  const body = await adminBody(ctx);
  if (body instanceof Response) return body;
  const db = ctx.env.DB;
  const from = typeof body.choir === "string" ? body.choir : "";
  const to = typeof body.to === "string" ? body.to : "";
  const slug = typeof body.slug === "string" ? body.slug : "";
  const [source, target] = await db.batch<{ staging: number }>([
    db.prepare("SELECT staging FROM choirs WHERE id = ?").bind(from),
    db.prepare("SELECT staging FROM choirs WHERE id = ?").bind(to),
  ]);
  if (source!.results[0]?.staging !== 1 || target!.results[0]?.staging !== 0) {
    return json({ error: "unknown choir" }, 400);
  }
  // A JOY-alumnit song goes on JOY-kuoro's list too, with the same files.
  const lists = ALSO_ON[to] ? [to, ALSO_ON[to]] : [to];
  const [song, ...replaced] = await db.batch<{ prefix: string }>([
    db.prepare("SELECT prefix FROM songs WHERE choir = ? AND slug = ?").bind(from, slug),
    ...lists.map((list) => db.prepare("SELECT prefix FROM songs WHERE choir = ? AND slug = ?").bind(list, slug)),
  ]);
  const prefix = song!.results[0]?.prefix;
  if (!prefix) return json({ error: "unknown song" }, 400);
  const oldPrefixes = [...new Set(replaced.map((r) => r.results[0]?.prefix).filter((p): p is string => !!p))];
  const newPrefix = `songs/${to}/${slug}/${versionOf(prefix)}/`;

  const keys = await listKeys(ctx.env.SONGS, prefix);
  if (keys.length === 0) return json({ error: "no files" }, 409);
  for (const key of keys) {
    const object = await ctx.env.SONGS.get(key);
    if (object === null) return json({ error: "no files" }, 409);
    await ctx.env.SONGS.put(newPrefix + key.slice(prefix.length), await object.arrayBuffer(),
      { httpMetadata: object.httpMetadata });
  }
  const now = new Date(ctx.now * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  await db.batch([
    ...lists.map((list) => db.prepare(
      `INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at, ${CREDITS})
       SELECT ?1, slug, title, ?2, parts, duration,
              COALESCE((SELECT published_at FROM songs WHERE choir = ?1 AND slug = ?4), ?5), ${CREDITS}
         FROM songs WHERE choir = ?3 AND slug = ?4
       ON CONFLICT (choir, slug) DO UPDATE SET title = excluded.title, prefix = excluded.prefix,
         parts = excluded.parts, duration = excluded.duration, composer = excluded.composer,
         lyricist = excluded.lyricist, arranger = excluded.arranger`,
    ).bind(list, newPrefix, from, slug, now)),
    db.prepare("DELETE FROM songs WHERE choir = ? AND slug = ?").bind(from, slug),
  ]);
  // Nothing points at these any more. A replaced version's folder may still
  // be another list's (one copy for several lists, #104); then it stays.
  const stale = [...keys];
  for (const old of oldPrefixes) {
    if (old === newPrefix || await db.prepare("SELECT 1 FROM songs WHERE prefix = ? LIMIT 1").bind(old).first()) continue;
    stale.push(...await listKeys(ctx.env.SONGS, old));
  }
  for (let i = 0; i < stale.length; i += 1000) await ctx.env.SONGS.delete(stale.slice(i, i + 1000));
  return json({ moved: slug, to });
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

// ---------------------------------------------------------------- requests

/**
 * A singer asks for a new practice track (#38): a multipart form with an
 * optional PDF. A cross-site HTML form can send multipart without a preflight,
 * so the custom header (which it cannot set) plus the SameSite cookie is the
 * CSRF guard here.
 */
async function sendRequest(ctx: Ctx): Promise<Response> {
  if (ctx.request.headers.get("X-Stemmanauhat") !== "1") return json({ error: "refused" }, 403);
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return json({ error: "bad form" }, 400);
  }
  const choir = String(form.get("choir") ?? "");
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  // The open list is for everyone, so it takes no requests.
  if (!(await privateChoir(ctx, choir))) return json({ error: "refused" }, 403);

  const file = form.get("pdf");
  let pdf: Uint8Array | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > PDF_MAX_BYTES) return json({ error: serverMessage(requestLang(ctx.request)).pdfTooBig }, 400);
    pdf = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(pdf)) return json({ error: serverMessage(requestLang(ctx.request)).notPdf }, 400);
  }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const request = parseRequest(fields, pdf !== null, requestLang(ctx.request));
  if ("error" in request) return json(request, 400);
  // Sent with only a PDF: its file name is the song's name (#77).
  if (!request.title && file instanceof File && pdf) request.title = pdfTitle(file.name);

  const db = ctx.env.DB;
  const at = new Date(ctx.now * 1000).toISOString();
  const row = await db.prepare(
    `INSERT INTO song_requests (choir, title, credits, note, requester, pdf, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(choir, request.title, request.credits, request.note, ctx.session?.email ?? request.name,
    pdf ? 1 : 0, at).first<{ id: number }>();
  const id = row!.id;
  if (pdf) {
    try {
      await ctx.env.SONGS.put(requestPdfKey(choir, id), pdf, { httpMetadata: { contentType: "application/pdf" } });
    } catch (error) {
      await db.prepare("DELETE FROM song_requests WHERE id = ?").bind(id).run();
      throw error;
    }
  }
  return json({ id });
}

/**
 * A singer flags a published song's score as having issues (#41). JSON only:
 * a cross-site form cannot send it without a preflight, so this plus the
 * SameSite cookie is the CSRF guard, as for the admin calls.
 */
async function sendFlag(ctx: Ctx, choir: string, slug: string): Promise<Response> {
  if (!(ctx.request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return json({ error: "send JSON" }, 415);
  }
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  // The open list is for everyone, so it takes no flags (spec D3).
  if (!(await privateChoir(ctx, choir))) return json({ error: "refused" }, 403);
  const db = ctx.env.DB;
  const song = await db.prepare("SELECT title FROM songs WHERE choir = ? AND slug = ?").bind(choir, slug)
    .first<{ title: string }>();
  if (!song) return json({ error: "unknown" }, 404);
  let body: unknown;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: "bad JSON" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ error: "bad JSON" }, 400);
  const flag = parseFlag(body as Record<string, unknown>, requestLang(ctx.request));
  if ("error" in flag) return json(flag, 400);
  const row = await db.prepare(
    `INSERT INTO song_requests (choir, title, note, requester, created_at, song, bar, problems, part)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(choir, song.title, flag.note, ctx.session?.email ?? flag.name, new Date(ctx.now * 1000).toISOString(),
    slug, flag.bar, flag.problems.join(",") || null, flag.part).first<{ id: number }>();
  return json({ id: row!.id });
}

/**
 * One usage event from the player (eerovil/eeron-omat-taskit#72), sent with
 * sendBeacon. Always 204: a bad event is dropped, and the player shows nothing.
 * Kept only for a choir this visitor can open; the email comes from the session.
 */
async function recordEvent(ctx: Ctx): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (Number(ctx.request.headers.get("Content-Length") ?? 0) > EVENT_MAX_BYTES) return done;
  const event = parseEvent(await ctx.request.text());
  if (!event || (await accessTo(ctx, event.choir)) !== "ok") return done;
  const session = ctx.session;
  // Admins' visits are kept for checking that tracking works, but not counted. (An
  // agent's session sends nothing: it only reads, #79.)
  const admin = await isAdmin(ctx.env.DB, session);
  // A listen is sent again at each full minute (D9): the same row grows.
  await ctx.env.DB.prepare(
    `INSERT INTO events (at, visitor, email, admin, choir, song, part, name, sung, setting, value, settings, seconds, listen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (listen) DO UPDATE SET seconds = MAX(events.seconds, excluded.seconds), settings = excluded.settings
       WHERE events.visitor = excluded.visitor`,
  ).bind(new Date(ctx.now * 1000).toISOString(), event.visitor, session?.email ?? null, admin ? 1 : 0, event.choir,
    event.song, event.part, event.name, event.sung ? 1 : 0, event.setting, event.value, event.settings, event.seconds,
    event.listen).run();
  return done;
}

function problemList(problems: string | null): string[] {
  return problems ? problems.split(",") : [];
}

async function requestPdf(ctx: Ctx, id: number): Promise<Response> {
  if (!(await isAdmin(ctx.env.DB, ctx.session))) return json({ error: "refused" }, 403);
  const row = await ctx.env.DB.prepare("SELECT choir, title FROM song_requests WHERE id = ? AND pdf = 1").bind(id)
    .first<{ choir: string; title: string | null }>();
  if (!row) return json({ error: "not found" }, 404);
  const response = await serveObject(ctx.env.SONGS, requestPdfKey(row.choir, id), ctx.request, "private, no-store");
  const name = `${(row.title ?? `pyynto-${id}`).replace(/[\u0000-\u001f"\\/]/g, "")}.pdf`;
  response.headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  return response;
}

async function adminRequests(ctx: Ctx): Promise<Response> {
  const body = await adminBody(ctx);
  if (body instanceof Response) return body;
  const db = ctx.env.DB;
  const row = typeof body.id === "number"
    ? await db.prepare("SELECT id, choir, pdf FROM song_requests WHERE id = ?").bind(body.id)
      .first<{ id: number; choir: string; pdf: number }>()
    : null;
  if (!row) return json({ error: "unknown request" }, 400);
  if (body.delete === true) {
    if (row.pdf === 1) await ctx.env.SONGS.delete(requestPdfKey(row.choir, row.id));
    await db.prepare("DELETE FROM song_requests WHERE id = ?").bind(row.id).run();
    return json({ deleted: row.id });
  }
  if (body.done === true) {
    await db.prepare("UPDATE song_requests SET done_at = ? WHERE id = ?")
      .bind(new Date(ctx.now * 1000).toISOString(), row.id).run();
    return json({ done: row.id });
  }
  return json({ error: "nothing to do" }, 400);
}

// ---------------------------------------------------------------- helpers

async function accessTo(ctx: Ctx, choir: string): Promise<Access> {
  return decideAccess(ctx.session, choir, await loadFacts(ctx.env.DB, ctx.session, choir));
}

function statusOf(access: Access): number {
  return access === "ok" ? 200 : access === "signin" ? 401 : access === "refused" ? 403 : 404;
}

function randomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(18)));
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
