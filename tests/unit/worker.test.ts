import { describe, expect, it } from "vitest";
import { decideAccess, type AccessFacts } from "../../src/worker/access";
import { parseRange, safeSongPath } from "../../src/worker/files";
import { readEmail } from "../../src/worker/google";
import { parseEmails, safeNext, versionOf } from "../../src/worker/index";
import { publicOrigin } from "../../src/worker/origin";
import { newPassphraseRecord, passphraseMatches } from "../../src/worker/passphrase";
import { readSession, sessionCookie } from "../../src/worker/session";
import { base64UrlEncode } from "../../src/worker/signing";

const facts = (over: Partial<AccessFacts> = {}): AccessFacts => ({
  choirExists: true, choirPublic: false, linkGeneration: 3, isMember: false, isAdmin: false, ...over,
});

describe("decideAccess", () => {
  it("lets anyone into a public choir and nobody into an unknown one", () => {
    expect(decideAccess(null, "public", facts({ choirPublic: true }))).toBe("ok");
    expect(decideAccess(null, "x", facts({ choirExists: false }))).toBe("unknown");
  });
  it("sends a signed-out visitor to sign in", () => {
    expect(decideAccess(null, "jm", facts())).toBe("signin");
  });
  it("lets in members and admins by Google email", () => {
    const s = { email: "a@example.com", exp: 0 };
    expect(decideAccess(s, "jm", facts({ isMember: true }))).toBe("ok");
    expect(decideAccess(s, "jm", facts({ isAdmin: true }))).toBe("ok");
    expect(decideAccess(s, "jm", facts())).toBe("refused");
  });
  it("lets in a link session only for its choir and its current generation", () => {
    const s = { links: { jm: 3 }, exp: 0 };
    expect(decideAccess(s, "jm", facts())).toBe("ok");
    expect(decideAccess(s, "jm", facts({ linkGeneration: 4 }))).toBe("refused");
    expect(decideAccess(s, "jm", facts({ linkGeneration: null }))).toBe("refused");
    expect(decideAccess(s, "naiskuoro", facts())).toBe("refused");
  });
});

describe("passphrases", () => {
  it("match only the passphrase they were made from", async () => {
    const record = await newPassphraseRecord("kevätkonsertti");
    expect(record.hash).not.toContain("kevät");
    expect(await passphraseMatches("kevätkonsertti", record)).toBe(true);
    expect(await passphraseMatches("Kevätkonsertti", record)).toBe(false);
  });
});

describe("session cookie", () => {
  const request = (cookie: string) => new Request("https://x.example/", { headers: { Cookie: cookie.split(";")[0]! } });
  it("round-trips and expires", async () => {
    const cookie = await sessionCookie("secret", { email: "a@example.com", links: { jm: 1 } }, 1000);
    expect(cookie).toContain("HttpOnly");
    const session = await readSession(request(cookie), "secret", 1001);
    expect(session?.email).toBe("a@example.com");
    expect(session?.links).toEqual({ jm: 1 });
    expect(await readSession(request(cookie), "secret", 1000 + 181 * 86400)).toBeNull();
  });
  it("refuses a tampered or foreign cookie", async () => {
    const cookie = await sessionCookie("secret", { email: "a@example.com" }, 1000);
    expect(await readSession(request(cookie), "other-secret", 1001)).toBeNull();
    const [name, value] = cookie.split(";")[0]!.split("=") as [string, string];
    const forged = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ email: "admin@example.com", exp: 9e9 })));
    expect(await readSession(request(`${name}=${forged}.${value.split(".")[1]}`), "secret", 1001)).toBeNull();
  });
});

describe("Google id token", () => {
  const token = (claims: Record<string, unknown>) =>
    ["e30", base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims))), "sig"].join(".");
  const good = { iss: "https://accounts.google.com", aud: "client", exp: 2000, nonce: "n", email: "A@Example.com", email_verified: true };
  it("gives the lower-case email of a good token", () => {
    expect(readEmail(token(good), "client", "n", 1000)).toBe("a@example.com");
  });
  it("refuses another app, an old token, a replayed nonce and an unverified email", () => {
    expect(readEmail(token({ ...good, aud: "other" }), "client", "n", 1000)).toBeNull();
    expect(readEmail(token(good), "client", "n", 3000)).toBeNull();
    expect(readEmail(token(good), "client", "m", 1000)).toBeNull();
    expect(readEmail(token({ ...good, email_verified: false }), "client", "n", 1000)).toBeNull();
    expect(readEmail(token({ ...good, iss: "https://evil.example" }), "client", "n", 1000)).toBeNull();
  });
});

describe("files", () => {
  it("parses byte ranges", () => {
    expect(parseRange(null)).toBeNull();
    expect(parseRange("bytes=0-99")).toEqual({ offset: 0, length: 100 });
    expect(parseRange("bytes=100-")).toEqual({ offset: 100 });
    expect(parseRange("bytes=-500")).toEqual({ suffix: 500 });
    expect(parseRange("bytes=5-1")).toBe("invalid");
    expect(parseRange("bytes=0-1,5-9")).toBe("invalid");
  });
  it("keeps paths inside the song's folder", () => {
    expect(safeSongPath("parts/1-T1.mp3")).toBe(true);
    expect(safeSongPath("../other/score.musicxml")).toBe(false);
    expect(safeSongPath("/etc/passwd")).toBe(false);
    expect(safeSongPath("parts//x")).toBe(false);
  });
});

describe("parseEmails", () => {
  it("splits pasted text, lower-cases and drops junk", () => {
    expect(parseEmails("A@Example.com, b@example.com\nnot-an-email\nA@example.com")).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/c/jm/kokeilu?x=1")).toBe("/c/jm/kokeilu?x=1");
    expect(safeNext(null)).toBe("/");
  });
  it("refuses anything a browser could read as another site", () => {
    for (const bad of ["//evil.example", "/\t/evil.example", "/\n/evil.example", "/\\evil.example",
      "https://evil.example", "evil.example", "/\u0000x"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("versionOf", () => {
  it("takes the last folder of the prefix", () => {
    expect(versionOf("songs/jm/kokeilu/20261009T120000Z/")).toBe("20261009T120000Z");
  });
});

describe("publicOrigin", () => {
  const worker = new URL("https://stemmanauhat.eerovil.workers.dev/auth/login");
  const proxied = { "X-Forwarded-Host": "stemmanauhat.vilpponen.fi", "X-Forwarded-Proto": "https" };
  it("uses the public name behind the VPS proxy", () => {
    expect(publicOrigin(worker, new Headers(proxied))).toBe("https://stemmanauhat.vilpponen.fi");
  });
  it("keeps the request origin otherwise", () => {
    expect(publicOrigin(worker, new Headers())).toBe("https://stemmanauhat.eerovil.workers.dev");
    expect(publicOrigin(worker, new Headers({ ...proxied, "X-Forwarded-Host": "evil.example" })))
      .toBe("https://stemmanauhat.eerovil.workers.dev");
    expect(publicOrigin(worker, new Headers({ ...proxied, "X-Forwarded-Proto": "http" })))
      .toBe("https://stemmanauhat.eerovil.workers.dev");
    expect(publicOrigin(new URL("http://127.0.0.1:8787/"), new Headers(proxied))).toBe("http://127.0.0.1:8787");
  });
});
