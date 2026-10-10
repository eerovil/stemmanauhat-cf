import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script without types
import { cloudflareStore, publishAll, publishPlan, versionFor } from "../../scripts/publish-songs.mjs";

const manifest = {
  slug: "kokeilu", title: "Kokeilijan 'laulu'", duration: 8,
  parts: [{ name: "Tenori", file: "parts/1-Tenori.mp3" }, { name: "Basso", file: "parts/2-Basso.mp3" }],
};
const date = new Date("2026-10-10T12:34:56.789Z");

describe("publishPlan", () => {
  it("puts a version in song-app's format under the choir and slug", () => {
    expect(versionFor(date)).toBe("20261010T123456Z");
    const plan = publishPlan(manifest, "public", date);
    expect(plan.prefix).toBe("songs/public/kokeilu/20261010T123456Z/");
    expect(plan.files).toEqual(["score.musicxml", "score.mid", "timing.json", "manifest.json",
      "parts/1-Tenori.mp3", "parts/2-Basso.mp3"]);
    expect(plan.r2Manifest).toMatchObject({ choir: "public", version: "20261010T123456Z", midi: "score.mid" });
  });
  it("upserts the row with quotes escaped and moves the song from another choir", () => {
    const { sql } = publishPlan(manifest, "public", date);
    expect(sql).toContain("'Kokeilijan ''laulu'''");
    expect(sql).toContain("ON CONFLICT (choir, slug) DO UPDATE");
    expect(sql).toContain("'2026-10-10T12:34:56Z'");
    expect(sql).toContain("DELETE FROM songs WHERE slug = 'kokeilu' AND choir <> 'public';");
  });
  it("refuses an unknown choir and a broken manifest", () => {
    expect(() => publishPlan(manifest, "kaikki", date)).toThrow(/unknown choir/);
    expect(() => publishPlan({ ...manifest, parts: [] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, slug: "a/b" }, "public", date)).toThrow(/bad manifest/);
  });
});

function bundle(root: string, slug: string, withParts = true) {
  const dir = join(root, slug);
  mkdirSync(join(dir, "parts"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, slug }));
  for (const f of ["score.musicxml", "score.mid", "timing.json"]) writeFileSync(join(dir, f), f);
  if (withParts) for (const p of manifest.parts) writeFileSync(join(dir, p.file), p.file);
  return dir;
}

describe("publishAll", () => {
  it("puts each song's row in only after all of its files are up", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const events: string[] = [];
      const store = {
        put: async (key: string, _data: unknown, type: string) => {
          await new Promise((r) => setTimeout(r, 5));
          events.push(`put ${key} ${type}`);
        },
        sql: async (sql: string) => { events.push(`sql ${/slug = '(\w+)'/.exec(sql)?.[1]}`); },
      };
      const failed = await publishAll(store, "jm", [bundle(root, "yksi"), bundle(root, "kaksi")], { log: () => {}, now: () => date });
      expect(failed).toBe(0);
      expect(events.filter((e) => e.startsWith("put"))).toHaveLength(12);
      for (const slug of ["yksi", "kaksi"]) {
        const row = events.indexOf(`sql ${slug}`);
        const puts = events.flatMap((e, i) => (e.includes(`/${slug}/`) ? [i] : []));
        expect(puts).toHaveLength(6);
        expect(Math.max(...puts)).toBeLessThan(row);
      }
      expect(events).toContain("put songs/jm/yksi/20261010T123456Z/parts/1-Tenori.mp3 audio/mpeg");
      expect(events).toContain("put songs/jm/yksi/20261010T123456Z/score.musicxml application/vnd.recordare.musicxml+xml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("leaves a song whose upload fails without a row and still publishes the others", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const rows: string[] = [];
      const store = {
        put: async (key: string) => { if (key.includes("/rikki/") && key.endsWith(".mid")) throw new Error("boom"); },
        sql: async (sql: string) => { rows.push(/slug = '(\w+)'/.exec(sql)?.[1] ?? "?"); },
      };
      const failed = await publishAll(store, "jm", [bundle(root, "rikki"), bundle(root, "ehja")], { log: () => {}, now: () => date });
      expect(failed).toBe(1);
      expect(rows).toEqual(["ehja"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uploads nothing when a bundle is missing a file", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      let puts = 0;
      const store = { put: async () => { puts++; }, sql: async () => {} };
      await expect(publishAll(store, "jm", [bundle(root, "hyva"), bundle(root, "vajaa", false)], { log: () => {} }))
        .rejects.toThrow(/missing parts\/1-Tenori.mp3/);
      expect(puts).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cloudflareStore", () => {
  it("calls the R2 and D1 APIs with the token and retries a 500", async () => {
    const calls: [string, RequestInit][] = [];
    let first = true;
    const fetchFn = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (first) { first = false; return new Response("busy", { status: 500 }); }
      return new Response(JSON.stringify({ success: true, result: [] }));
    };
    const store = cloudflareStore({ CLOUDFLARE_API_TOKEN: "t0k", CLOUDFLARE_ACCOUNT_ID: "acc" }, fetchFn, async () => {});
    await store.put("songs/jm/a b/v/parts/1-Ä.mp3", "x", "audio/mpeg");
    await store.sql("SELECT 1;");
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "PUT https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/stemmanauhat/objects/songs/jm/a%20b/v/parts/1-%C3%84.mp3",
      "PUT https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/stemmanauhat/objects/songs/jm/a%20b/v/parts/1-%C3%84.mp3",
      "POST https://api.cloudflare.com/client/v4/accounts/acc/d1/database/b3d80c7d-0fb7-45a2-b6f6-f7311556b953/query",
    ]);
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe("Bearer t0k");
    expect(JSON.parse(calls[2]![1].body as string)).toEqual({ sql: "SELECT 1;" });
  });
  it("stops at once on a 403 and needs the token", async () => {
    let n = 0;
    const store = cloudflareStore({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" },
      async () => { n++; return new Response("no", { status: 403 }); }, async () => {});
    await expect(store.put("k", "x", "text/plain")).rejects.toThrow(/403/);
    expect(n).toBe(1);
    expect(() => cloudflareStore({})).toThrow(/run.sh --cloudflare/);
  });
});
