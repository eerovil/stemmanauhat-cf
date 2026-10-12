import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script without types
import { cloudflareStore, partFilesIn, publishAll, publishPlan, versionFor } from "../../scripts/publish-songs.mjs";

const manifest = {
  slug: "kokeilu", title: "Kokeilijan 'laulu'", duration: 8,
  parts: [{ name: "Tenori" }, { name: "Basso" }],
};
const date = new Date("2026-10-10T12:34:56.789Z");

describe("publishPlan", () => {
  it("puts a version in song-app's format under the choir and slug", () => {
    expect(versionFor(date)).toBe("20261010T123456Z");
    const plan = publishPlan(manifest, "public", date);
    expect(plan.prefix).toBe("songs/public/kokeilu/20261010T123456Z/");
    expect(plan.files).toEqual(["score.musicxml", "score.mid", "timing.json", "manifest.json"]);
    expect(plan.r2Manifest).toMatchObject({ choir: "public", version: "20261010T123456Z", midi: "score.mid",
      parts: [{ name: "Tenori" }, { name: "Basso" }] });
    expect(plan.sql).toContain(`'[{"name":"Tenori"},{"name":"Basso"}]'`);
  });
  it("lists only the part names from an older bundle that still names an MP3 per part (#36)", () => {
    const old = { ...manifest, parts: [{ name: "Tenori", file: "parts/1-Tenori.mp3" }, { name: "Basso", file: "parts/2-Basso.mp3" }] };
    const plan = publishPlan(old, "jm", date);
    expect(plan.files).not.toContain("parts/1-Tenori.mp3");
    expect(plan.r2Manifest.parts).toEqual([{ name: "Tenori" }, { name: "Basso" }]);
  });
  it("uploads and lists each part's sung MP3 when the bundle has one per part (local test, 2026-10-12)", () => {
    const files = ["parts/1-Tenori.mp3", "parts/2-Basso.mp3"];
    const plan = publishPlan(manifest, "public", date, files);
    expect(plan.files).toEqual(["score.musicxml", "score.mid", "timing.json", "manifest.json", ...files]);
    expect(plan.r2Manifest.parts).toEqual([{ name: "Tenori", file: files[0] }, { name: "Basso", file: files[1] }]);
    expect(plan.sql).toContain(`'[{"name":"Tenori","file":"parts/1-Tenori.mp3"},{"name":"Basso","file":"parts/2-Basso.mp3"}]'`);
    expect(() => publishPlan(manifest, "public", date, [files[0]])).toThrow("bad part files");
  });
  it("finds the parts' MP3s in a bundle by number, in the manifest's order, or none", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    try {
      expect(partFilesIn(dir, manifest.parts)).toEqual([]);
      mkdirSync(join(dir, "parts"));
      writeFileSync(join(dir, "parts", "2-Basso.mp3"), "");
      expect(() => partFilesIn(dir, manifest.parts)).toThrow("exactly one");
      writeFileSync(join(dir, "parts", "1-Tenori.mp3"), "");
      writeFileSync(join(dir, "parts", "notes.txt"), "");
      expect(partFilesIn(dir, manifest.parts)).toEqual(["parts/1-Tenori.mp3", "parts/2-Basso.mp3"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("upserts the row with quotes escaped and moves the song from another choir, but not from public", () => {
    const { sql } = publishPlan(manifest, "jm", date);
    expect(sql).toContain("'Kokeilijan ''laulu'''");
    expect(sql).toContain("ON CONFLICT (choir, slug) DO UPDATE");
    expect(sql).toContain("'2026-10-10T12:34:56Z'");
    expect(sql).toContain("DELETE FROM songs WHERE slug = 'kokeilu' AND choir NOT IN ('jm', 'public');");
  });
  it("leaves the choirs' copies alone when publishing to public", () => {
    expect(publishPlan(manifest, "public", date).sql).not.toContain("DELETE");
  });
  it("keeps the date a song first came out when it is published again or moved", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(join("migrations", f), "utf8"));
    const day = (choir: string) => db.prepare("SELECT published_at FROM songs WHERE choir = ?").get(choir)?.published_at;
    db.exec(publishPlan(manifest, "jm", new Date("2025-03-01T10:00:00Z")).sql);
    expect(day("jm")).toBe("2025-03-01T10:00:00Z");
    db.exec(publishPlan({ ...manifest, title: "Uusi nimi" }, "jm", date).sql);
    expect(day("jm")).toBe("2025-03-01T10:00:00Z");
    expect(db.prepare("SELECT title FROM songs").get()?.title).toBe("Uusi nimi");
    db.exec(publishPlan(manifest, "naiskuoro", date).sql);
    expect(day("jm")).toBeUndefined();
    expect(day("naiskuoro")).toBe("2025-03-01T10:00:00Z");
    db.exec(publishPlan({ ...manifest, slug: "toinen" }, "jm", date).sql);
    expect(db.prepare("SELECT published_at FROM songs WHERE slug = 'toinen'").get()?.published_at)
      .toBe("2026-10-10T12:34:56Z");
  });
  it("carries composer, lyricist and arranger to R2 and D1, and clears them when a score drops them", () => {
    const credited = { ...manifest, composer: " Aino Esimerkki ", lyricist: "O'Runoilija", arranger: "" };
    const plan = publishPlan(credited, "jm", date);
    expect(plan.r2Manifest).toMatchObject({ composer: "Aino Esimerkki", lyricist: "O'Runoilija" });
    expect(plan.r2Manifest).not.toHaveProperty("arranger");
    const db = new DatabaseSync(":memory:");
    for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(join("migrations", f), "utf8"));
    const row = () => db.prepare("SELECT composer, lyricist, arranger FROM songs").get();
    db.exec(plan.sql);
    expect(row()).toEqual({ composer: "Aino Esimerkki", lyricist: "O'Runoilija", arranger: null });
    db.exec(publishPlan(manifest, "jm", date).sql);
    expect(row()).toEqual({ composer: null, lyricist: null, arranger: null });
  });
  it("publishes a bundle from before the credits, with none", () => {
    const plan = publishPlan(manifest, "jm", date);
    expect(Object.keys(plan.r2Manifest)).not.toEqual(expect.arrayContaining(["composer"]));
    expect(plan.sql).toContain("NULL, NULL, NULL)");
    expect(() => publishPlan({ ...manifest, composer: 3 }, "jm", date)).toThrow(/bad manifest for kokeilu: composer/);
  });
  it("refuses an unknown choir and a broken manifest", () => {
    expect(() => publishPlan(manifest, "kaikki", date)).toThrow(/unknown choir/);
    expect(() => publishPlan({ ...manifest, parts: [] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, parts: [{ name: " " }] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, slug: "a/b" }, "public", date)).toThrow(/bad manifest/);
  });
});

function bundle(root: string, slug: string, withMidi = true) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, slug }));
  for (const f of ["score.musicxml", "timing.json", ...(withMidi ? ["score.mid"] : [])]) writeFileSync(join(dir, f), f);
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
      expect(events.filter((e) => e.startsWith("put"))).toHaveLength(8);
      for (const slug of ["yksi", "kaksi"]) {
        const row = events.indexOf(`sql ${slug}`);
        const puts = events.flatMap((e, i) => (e.includes(`/${slug}/`) ? [i] : []));
        expect(puts).toHaveLength(4);
        expect(Math.max(...puts)).toBeLessThan(row);
      }
      expect(events).toContain("put songs/jm/yksi/20261010T123456Z/score.mid audio/midi");
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
  it("uploads a sung bundle's part MP3s as audio and lists them in the row", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const dir = bundle(root, "laulettu");
      mkdirSync(join(dir, "parts"));
      for (const f of ["1-Tenori.mp3", "2-Basso.mp3"]) writeFileSync(join(dir, "parts", f), f);
      const puts: string[] = [];
      const rows: string[] = [];
      const store = { put: async (key: string, _data: unknown, type: string) => { puts.push(`${key} ${type}`); },
        sql: async (sql: string) => { rows.push(sql); } };
      expect(await publishAll(store, "public", [dir], { log: () => {}, now: () => date })).toBe(0);
      expect(puts).toContain("songs/public/laulettu/20261010T123456Z/parts/1-Tenori.mp3 audio/mpeg");
      expect(puts).toContain("songs/public/laulettu/20261010T123456Z/parts/2-Basso.mp3 audio/mpeg");
      expect(rows[0]).toContain('"file":"parts/2-Basso.mp3"');
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
        .rejects.toThrow(/missing score.mid/);
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
