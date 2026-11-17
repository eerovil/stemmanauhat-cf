import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentLink } from "../../src/worker/agent";
import type { Env } from "../../src/worker/env";
import worker from "../../src/worker/index";
import { readSession } from "../../src/worker/session";
import { signValue } from "../../src/worker/signing";

const KEY = "test-agent-key-not-real";
const SESSION = "test-session-secret-not-real";
const now = () => Math.floor(Date.now() / 1000);

/** The Worker with no D1 or R2: the routes tried here never reach them. */
function call(path: string, init: RequestInit = {}, env: Partial<Env> = {}) {
  const full = { SESSION_SECRET: SESSION, AGENT_LOGIN_SECRET: KEY, ...env } as Env;
  return worker.fetch(new Request(`https://stemmanauhat.example${path}`, { redirect: "manual", ...init }), full);
}

/** Runs scripts/agent-login.sh with a key file of its own. */
function mint(...args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-login-"));
  writeFileSync(join(dir, "key"), KEY);
  return execFileSync("bash", ["scripts/agent-login.sh", ...args],
    { env: { ...process.env, STEMMANAUHAT_AGENT_KEY: join(dir, "key") } }).toString().trim();
}

/** The live site's host as wrangler.jsonc names it: PUBLIC_HOST, else WORKER_HOST, as the script reads it. */
function liveHost(): string | undefined {
  const config = readFileSync("wrangler.jsonc", "utf8");
  return config.match(/^\s*"PUBLIC_HOST"\s*:\s*"([^"]*)"/m)?.[1]
    || config.match(/^\s*"WORKER_HOST"\s*:\s*"([^"]*)"/m)?.[1];
}

describe("readAgentLink", () => {
  it("reads a current link and refuses an old, far-off, foreign or broken one", async () => {
    const t = now();
    expect(await readAgentLink(KEY, await signValue(KEY, { choirs: ["jm"], exp: t + 300 }), t)).toEqual(["jm"]);
    expect(await readAgentLink(KEY, await signValue(KEY, { choirs: ["jm"], exp: t }), t)).toBeNull();
    expect(await readAgentLink(KEY, await signValue(KEY, { choirs: ["jm"], exp: t + 301 }), t)).toBeNull();
    expect(await readAgentLink("other", await signValue(KEY, { choirs: ["jm"], exp: t + 60 }), t)).toBeNull();
    expect(await readAgentLink(KEY, await signValue(KEY, { choirs: [], exp: t + 60 }), t)).toBeNull();
    expect(await readAgentLink(KEY, await signValue(KEY, { choirs: [1], exp: t + 60 }), t)).toBeNull();
    expect(await readAgentLink(KEY, "nonsense", t)).toBeNull();
    expect(await readAgentLink(KEY, null, t)).toBeNull();
  });
});

describe("scripts/agent-login.sh", () => {
  it("makes a link the Worker reads, for the live site by default", async () => {
    const link = new URL(mint("jm", "naiskuoro"));
    const host = liveHost();
    expect(host).toBeTruthy();
    expect(link.origin).toBe(`https://${host}`);
    expect(link.pathname).toBe("/auth/agent");
    expect(await readAgentLink(KEY, link.searchParams.get("t"), now())).toEqual(["jm", "naiskuoro"]);
  });
  it("makes a local link with a page to open", () => {
    const link = new URL(mint("--local", "http://127.0.0.1:8787", "--next", "/c/jm/kokeilu?x=1", "jm"));
    expect(link.origin).toBe("http://127.0.0.1:8787");
    expect(link.searchParams.get("next")).toBe("/c/jm/kokeilu?x=1");
  });
  it("refuses an id that is not a choir's", () => {
    expect(() => mint('jm"]')).toThrow();
  });
});

describe("/auth/agent", () => {
  it("starts a one-hour session for the link's choirs, with no email, and opens the first", async () => {
    const response = await call(`/auth/agent?t=${await signValue(KEY, { choirs: ["jm"], exp: now() + 60 })}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/c/jm");
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("Max-Age=3600");
    const session = await readSession(new Request("https://x.example/", { headers: { Cookie: cookie.split(";")[0]! } }),
      SESSION, now());
    expect(session).toMatchObject({ agent: ["jm"] });
    expect(session?.email).toBeUndefined();
    expect(session!.exp).toBeLessThanOrEqual(now() + 3600);
  });
  it("goes to the page asked for, on this site only", async () => {
    const t = await signValue(KEY, { choirs: ["jm"], exp: now() + 60 });
    expect((await call(`/auth/agent?t=${t}&next=/c/jm/kokeilu`)).headers.get("Location")).toBe("/c/jm/kokeilu");
    expect((await call(`/auth/agent?t=${t}&next=//evil.example`)).headers.get("Location")).toBe("/");
  });
  it("sends a bad link to the sign-in page, without a session", async () => {
    const old = await signValue(KEY, { choirs: ["jm"], exp: now() - 1 });
    const response = await call(`/auth/agent?t=${old}`);
    expect(response.headers.get("Location")).toBe("/signin?next=%2F&error=failed");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
  it("is not there when the Worker has no key", async () => {
    const t = await signValue(KEY, { choirs: ["jm"], exp: now() + 60 });
    expect((await call(`/auth/agent?t=${t}`, {}, { AGENT_LOGIN_SECRET: undefined })).status).toBe(404);
  });
  it("only reads: an agent's session can send nothing but sign out", async () => {
    const login = await call(`/auth/agent?t=${await signValue(KEY, { choirs: ["jm"], exp: now() + 60 })}`);
    const Cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
    for (const path of ["/api/requests", "/api/songs/jm/kokeilu/flags", "/api/admin/members", "/api/admin/link"]) {
      const response = await call(path, { method: "POST", headers: { Cookie }, body: "{}" });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toEqual({ error: "read-only" });
    }
    expect((await call("/auth/logout", { method: "POST", headers: { Cookie } })).status).toBe(302);
  });
  it("ends every agent session when the key changes or is removed", async () => {
    const login = await call(`/auth/agent?t=${await signValue(KEY, { choirs: ["jm"], exp: now() + 60 })}`);
    const Cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
    // Only an agent session gets "read-only"; once it has ended, the POST is anyone's.
    const post = (env: Partial<Env>) => call("/api/requests", { method: "POST", headers: { Cookie }, body: "{}" }, env);
    expect(await (await post({})).json()).toEqual({ error: "read-only" });
    expect(await (await post({ AGENT_LOGIN_SECRET: "a-new-key" })).json()).toEqual({ error: "refused" });
    expect(await (await post({ AGENT_LOGIN_SECRET: undefined })).json()).toEqual({ error: "refused" });
  });
});
