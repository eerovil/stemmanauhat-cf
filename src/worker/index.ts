import { decideAccess, isAdmin, loadFacts, type Access } from "./access";
import type { Env } from "./env";
import { serveObject, safeSongPath } from "./files";
import { AUTHORIZE_URL, TOKEN_URL, authorizeUrl, exchangeCode, normalizeEmail, readEmail } from "./google";
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
    const ctx: Ctx = {
      env, request, url, now, secret: env.SESSION_SECRET,
      session: await readSession(request, env.SESSION_SECRET, now),
    };
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

  if (path === "/" && method === "GET") return home(ctx);
  if (path === "/auth/login" && method === "GET") return login(ctx);
  if (path === "/auth/callback" && method === "GET") return callback(ctx);
  if (path === "/auth/logout" && method === "POST") {
    return redirect("/", { "Set-Cookie": clearSessionCookie() });
  }
  if (path === "/api/me" && method === "GET") return me(ctx);
  if (path === "/api/songs" && method === "GET") return songList(ctx, url.searchParams.get("choir") ?? "");
  if ((m = /^\/api\/songs\/([^/]+)\/([^/]+)$/.exec(path)) && method === "GET") {
    return song(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
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
  if (path === "/admin" && method === "GET") return adminPage(ctx);
  if (path === "/api/admin" && method === "GET") return adminState(ctx);
  if (path === "/api/admin/members" && method === "POST") return adminMembers(ctx);
  if (path === "/api/admin/link" && method === "POST") return adminLink(ctx);
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
    `${ctx.url.origin}/auth/callback`, state, nonce);
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
    env.GOOGLE_CLIENT_SECRET, `${url.origin}/auth/callback`, code);
  const email = idToken && readEmail(idToken, env.GOOGLE_CLIENT_ID, pending.nonce, ctx.now);
  if (!email) return redirect(signinUrl(safeNext(pending.next ?? "/"), "failed"));

  const headers = new Headers({ Location: safeNext(pending.next ?? "/") });
  headers.append("Set-Cookie", await sessionCookie(ctx.secret, { email, links: ctx.session?.links }, ctx.now));
  headers.append("Set-Cookie", `${OAUTH_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
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
    admin: await isAdmin(ctx.env.DB, ctx.session),
    choirs: await visibleChoirs(ctx),
  });
}

/** Every choir this visitor may open, public ones included. */
async function visibleChoirs(ctx: Ctx): Promise<{ id: string; name: string; public: boolean }[]> {
  const { results } = await ctx.env.DB.prepare("SELECT id, name, public FROM choirs ORDER BY name").all<
    { id: string; name: string; public: number }>();
  const out = [];
  for (const row of results) {
    if ((await accessTo(ctx, row.id)) === "ok") out.push({ id: row.id, name: row.name, public: row.public === 1 });
  }
  return out;
}

async function songList(ctx: Ctx, choir: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  const choirRow = await ctx.env.DB.prepare("SELECT name FROM choirs WHERE id = ?").bind(choir)
    .first<{ name: string }>();
  const { results } = await ctx.env.DB.prepare(
    "SELECT slug, title, parts, duration, published_at FROM songs WHERE choir = ?",
  ).bind(choir).all<{ slug: string; title: string; parts: string; duration: number; published_at: string }>();
  return json({
    choir: { id: choir, name: choirRow?.name ?? choir },
    songs: results.map((r) => ({ ...r, parts: JSON.parse(r.parts) })),
  });
}

async function song(ctx: Ctx, choir: string, slug: string): Promise<Response> {
  const access = await accessTo(ctx, choir);
  if (access !== "ok") return json({ error: access }, statusOf(access));
  const row = await ctx.env.DB.prepare(
    "SELECT slug, title, parts, duration, published_at, prefix FROM songs WHERE choir = ? AND slug = ?",
  ).bind(choir, slug).first<{ slug: string; title: string; parts: string; duration: number; published_at: string;
    prefix: string }>();
  if (row === null) return json({ error: "unknown" }, 404);
  const { prefix, ...song } = row;
  // The version is in the address, so a republished song is a new URL and the
  // year-long cache on /files never serves the old one.
  const base = `/files/${encodeURIComponent(choir)}/${encodeURIComponent(slug)}/${encodeURIComponent(versionOf(prefix))}/`;
  return json({ ...song, parts: JSON.parse(row.parts), choir, base });
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
  const [choirs, members, links, admins] = await db.batch([
    db.prepare("SELECT id, name, public FROM choirs ORDER BY name"),
    db.prepare("SELECT choir, email, added_at FROM members ORDER BY email"),
    db.prepare("SELECT choir, hash IS NOT NULL AS enabled, generation FROM choir_links"),
    db.prepare("SELECT email FROM admins ORDER BY email"),
  ]);
  type Member = { choir: string; email: string; added_at: string };
  type Link = { choir: string; enabled: number };
  return json({
    choirs: (choirs!.results as { id: string; name: string; public: number }[])
      .filter((c) => c.public !== 1)
      .map((c) => ({
        id: c.id,
        name: c.name,
        members: (members!.results as Member[]).filter((m) => m.choir === c.id)
          .map((m) => ({ email: m.email, added_at: m.added_at })),
        link: (links!.results as Link[]).some((l) => l.choir === c.id && l.enabled === 1),
      })),
    admins: (admins!.results as { email: string }[]).map((a) => a.email),
  });
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

async function privateChoir(ctx: Ctx, choir: unknown): Promise<string | null> {
  if (typeof choir !== "string") return null;
  const row = await ctx.env.DB.prepare("SELECT public FROM choirs WHERE id = ?").bind(choir)
    .first<{ public: number }>();
  return row && row.public !== 1 ? choir : null;
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
  const passphrase = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
  if (passphrase.length < 6) return json({ error: "Salasanan pitää olla vähintään 6 merkkiä." }, 400);
  const record = await newPassphraseRecord(passphrase);
  await db.prepare(
    `INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT (choir) DO UPDATE SET salt = ?2, hash = ?3, iterations = ?4, generation = generation + 1`,
  ).bind(choir, record.salt, record.hash, record.iterations).run();
  return json({ link: true });
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
