import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script without types
import { cloudflareStore, knowsName, parsePlace, partFilesIn, publishAll, publishPlan, readTree, sharingLists, treePlan, versionFor } from "../../scripts/publish-songs.mjs";

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
    expect(plan.r2Manifest.parts).toEqual([{ name: "Tenori", file: files[0], sung: true }, { name: "Basso", file: files[1], sung: true }]);
    expect(plan.sql).toContain(`'[{"name":"Tenori","file":"parts/1-Tenori.mp3","sung":true},{"name":"Basso","file":"parts/2-Basso.mp3","sung":true}]'`);
    expect(() => publishPlan(manifest, "public", date, [files[0]])).toThrow("bad part files");
  });
  it("keeps where each part is drawn when parts share a staff (musescore-choir-plugins#420)", () => {
    const shared = { ...manifest, parts: [{ name: "Tenori", staff: 0, voices: [1, 3] }, { name: "Basso", staff: 0, voices: [2] }] };
    const plan = publishPlan(shared, "jm", date);
    expect(plan.r2Manifest.parts).toEqual(shared.parts);
    expect(plan.sql).toContain(`'[{"name":"Tenori","staff":0,"voices":[1,3]},{"name":"Basso","staff":0,"voices":[2]}]'`);
    for (const bad of [{ staff: 0 }, { staff: -1, voices: [1] }, { staff: 0, voices: [5] }, { staff: 0, voices: [] }]) {
      expect(() => publishPlan({ ...manifest, parts: [{ name: "Tenori", ...bad }] }, "jm", date)).toThrow("bad staff or voices");
    }
  });
  it("names the singing voice on every sung part when the manifest says it, and refuses a malformed one", () => {
    const files = ["parts/1-Tenori.mp3", "parts/2-Basso.mp3"];
    const plan = publishPlan({ ...manifest, voice: "LYSE" }, "public", date, files);
    expect(plan.r2Manifest.parts).toEqual([
      { name: "Tenori", file: files[0], sung: true, voice: "LYSE" }, { name: "Basso", file: files[1], sung: true, voice: "LYSE" }]);
    expect(publishPlan({ ...manifest, voice: "LYSE" }, "public", date).r2Manifest.parts).toEqual([{ name: "Tenori" }, { name: "Basso" }]);
    expect(() => publishPlan({ ...manifest, voice: "'; DROP" }, "public", date, files)).toThrow("bad voice");
  });
  it("keeps a part's own voice, with the manifest's as the fallback, and refuses a malformed one", () => {
    const files = ["parts/1-Tenori.mp3", "parts/2-Basso.mp3"];
    const mixed = { ...manifest, voice: "LYSE", parts: [{ name: "Tenori", voice: "REMY" }, { name: "Basso" }] };
    const plan = publishPlan(mixed, "joy", date, files);
    expect(plan.prefix).toBe("songs/joy/kokeilu/20261010T123456Z/");
    expect(plan.r2Manifest.parts).toEqual([
      { name: "Tenori", file: files[0], sung: true, voice: "REMY" }, { name: "Basso", file: files[1], sung: true, voice: "LYSE" }]);
    expect(plan.sql).toContain(`"voice":"REMY"`);
    const bad = { ...manifest, parts: [{ name: "Tenori", voice: "'; DROP" }, { name: "Basso" }] };
    expect(() => publishPlan(bad, "public", date, files)).toThrow("bad voice");
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
  it("puts a JOY-alumnit song on JOY-kuoro's list too, but not a JOY-kuoro song on the alumni's (eeron-omat-taskit#101)", () => {
    const alumni = publishPlan(manifest, "joy-alumnit", date);
    expect(alumni.choirs).toEqual(["joy-alumnit", "joy"]);
    expect(alumni.prefix).toBe("songs/joy-alumnit/kokeilu/20261010T123456Z/");
    expect(alumni.sql).toContain("DELETE FROM songs WHERE slug = 'kokeilu' AND choir NOT IN ('joy-alumnit', 'joy', 'public');");
    expect(publishPlan(manifest, ["joy", "joy-alumnit"], date).choirs).toEqual(["joy", "joy-alumnit"]);
    expect(publishPlan(manifest, ["joy-alumnit", "public"], date).choirs).toEqual(["joy-alumnit", "public", "joy"]);
    expect(publishPlan(manifest, "joy", date).choirs).toEqual(["joy"]);
  });
  it("leaves the choirs' copies alone when publishing to public or to the test list", () => {
    expect(publishPlan(manifest, "public", date).sql).not.toContain("DELETE");
    expect(publishPlan(manifest, "testi", date).sql).not.toContain("DELETE");
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
  it("puts a song on several lists with one copy of its files (#104)", () => {
    const plan = publishPlan(manifest, ["jm", "naiskuoro"], date);
    expect(plan.choirs).toEqual(["jm", "naiskuoro"]);
    expect(plan.prefix).toBe("songs/jm/kokeilu/20261010T123456Z/");
    expect(plan.r2Manifest.choir).toBe("jm");
    expect(plan.sql).toContain("DELETE FROM songs WHERE slug = 'kokeilu' AND choir NOT IN ('jm', 'naiskuoro', 'public');");
    const db = new DatabaseSync(":memory:");
    for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(join("migrations", f), "utf8"));
    const rows = () => db.prepare("SELECT choir, prefix FROM songs ORDER BY choir").all();
    db.exec(publishPlan(manifest, "joy", new Date("2025-03-01T10:00:00Z")).sql);
    db.exec(publishPlan(manifest, "public", new Date("2025-03-01T10:00:00Z")).sql);
    db.exec(plan.sql);
    // joy is a private list not named, so it loses the song; public keeps its own copy.
    expect(rows()).toEqual([
      { choir: "jm", prefix: plan.prefix },
      { choir: "naiskuoro", prefix: plan.prefix },
      { choir: "public", prefix: "songs/public/kokeilu/20250301T100000Z/" },
    ]);
    // The first date stays on every list.
    expect(db.prepare("SELECT DISTINCT published_at AS at FROM songs").all()).toEqual([{ at: "2025-03-01T10:00:00Z" }]);
    // public with a choir: both rows share the one copy.
    db.exec(publishPlan(manifest, ["public", "jm"], date).sql);
    expect(db.prepare("SELECT prefix FROM songs WHERE choir IN ('jm', 'public')").all())
      .toEqual([{ prefix: "songs/public/kokeilu/20261010T123456Z/" }, { prefix: "songs/public/kokeilu/20261010T123456Z/" }]);
    expect(rows().map((r) => r.choir)).toEqual(["jm", "public"]);
  });
  it("refuses a repeated choir, an unknown one in a list, and the test list with others", () => {
    expect(() => publishPlan(manifest, ["jm", "jm"], date)).toThrow(/bad choirs/);
    expect(() => publishPlan(manifest, [], date)).toThrow(/bad choirs/);
    expect(() => publishPlan(manifest, ["jm", "kaikki"], date)).toThrow(/unknown choir/);
    expect(() => publishPlan(manifest, ["testi", "jm"], date)).toThrow(/test list/);
    expect(publishPlan(manifest, ["public"], date).sql).not.toContain("DELETE");
  });
  it("refuses an unknown choir and a broken manifest", () => {
    expect(() => publishPlan(manifest, "kaikki", date)).toThrow(/unknown choir/);
    expect(() => publishPlan({ ...manifest, parts: [] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, parts: [{ name: " " }] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, slug: "a/b" }, "public", date)).toThrow(/bad manifest/);
  });
});

/** A D1 with every migration, as the live one: the voice tree (#107) is in it. */
function migrated() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(join("migrations", f), "utf8"));
  return db;
}
const treeDb = migrated();
const query = async (sql: string) => treeDb.prepare(sql).all() as Record<string, unknown>[];

function bundle(root: string, slug: string, withMidi = true, sung = false) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, slug, ...(sung ? { sung: true } : {}) }));
  for (const f of ["score.musicxml", "timing.json", ...(withMidi ? ["score.mid"] : [])]) writeFileSync(join(dir, f), f);
  return dir;
}

describe("publishAll", () => {
  it("puts each song's row in only after all of its files are up", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const events: string[] = [];
      const store = { query,
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
  it("uploads the files once for several lists and writes every list's row in one query (#104)", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const puts: string[] = [];
      const rows: string[] = [];
      const store = { query, put: async (key: string) => { puts.push(key); }, sql: async (sql: string) => { rows.push(sql); } };
      expect(await publishAll(store, ["jm", "public"], [bundle(root, "yksi")], { log: () => {}, now: () => date })).toBe(0);
      expect(puts).toHaveLength(4);
      expect(puts.every((k) => k.startsWith("songs/jm/yksi/20261010T123456Z/"))).toBe(true);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.match(/INSERT INTO songs/g)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("keeps a song on a private list that shares its files, and still moves it off one that doesn't (eeron-omat-taskit#94)", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const db = migrated();
      const old = new Date("2025-03-01T10:00:00Z");
      // On joy and joy-alumnit with one copy, on naiskuoro with its own, and in public.
      db.exec(publishPlan({ ...manifest, slug: "yksi" }, ["joy", "joy-alumnit"], old).sql);
      db.exec(publishPlan({ ...manifest, slug: "yksi" }, "public", old).sql);
      db.exec(publishPlan({ ...manifest, slug: "kaksi" }, "naiskuoro", old).sql);
      const store = { query: async (sql: string) => db.prepare(sql).all() as Record<string, unknown>[],
        put: async () => {}, sql: async (sql: string) => { db.exec(sql); } };
      expect(await sharingLists(store, "yksi", ["joy"])).toEqual(["joy-alumnit"]);
      expect(await sharingLists(store, "yksi", ["public"])).toEqual([]);
      // A choir added in D1 but not to CHOIRS that shares the files is kept as well, not refused.
      db.exec("INSERT INTO choirs (id, name) VALUES ('kamari', 'Kamarikuoro')");
      db.exec("INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at) SELECT 'kamari', slug, title, prefix, parts, duration, published_at FROM songs WHERE choir = 'joy' AND slug = 'yksi'");
      const said: string[] = [];
      expect(await publishAll(store, "joy", [bundle(root, "yksi"), bundle(root, "kaksi")],
        { log: (line: string) => said.push(line), now: () => date })).toBe(0);
      expect(said).toContain("Kokeilijan 'laulu': also on joy-alumnit, kamari (same files)");
      expect(db.prepare("SELECT choir, slug, prefix FROM songs ORDER BY slug, choir").all()).toEqual([
        { choir: "joy", slug: "kaksi", prefix: "songs/joy/kaksi/20261010T123456Z/" },
        { choir: "joy", slug: "yksi", prefix: "songs/joy/yksi/20261010T123456Z/" },
        { choir: "joy-alumnit", slug: "yksi", prefix: "songs/joy/yksi/20261010T123456Z/" },
        { choir: "kamari", slug: "yksi", prefix: "songs/joy/yksi/20261010T123456Z/" },
        { choir: "public", slug: "yksi", prefix: "songs/public/yksi/20250301T100000Z/" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("leaves a song whose upload fails without a row and still publishes the others", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const rows: string[] = [];
      const store = { query,
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
  it("leaves out the part MP3s of a bundle not marked sung: older bundles carry piano renders", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const dir = bundle(root, "vanha");
      mkdirSync(join(dir, "parts"));
      for (const f of ["1-Tenori.mp3", "2-Basso.mp3"]) writeFileSync(join(dir, "parts", f), f);
      const puts: string[] = [];
      const rows: string[] = [];
      const store = { query, put: async (key: string) => { puts.push(key); }, sql: async (sql: string) => { rows.push(sql); } };
      expect(await publishAll(store, "jm", [dir], { log: () => {}, now: () => date })).toBe(0);
      expect(puts.some((k) => k.endsWith(".mp3"))).toBe(false);
      expect(rows[0]).toContain(`'[{"name":"Tenori"},{"name":"Basso"}]'`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uploads a sung bundle's part MP3s as audio and lists them in the row", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const dir = bundle(root, "laulettu", true, true);
      mkdirSync(join(dir, "parts"));
      for (const f of ["1-Tenori.mp3", "2-Basso.mp3"]) writeFileSync(join(dir, "parts", f), f);
      const puts: string[] = [];
      const rows: string[] = [];
      const store = { query, put: async (key: string, _data: unknown, type: string) => { puts.push(`${key} ${type}`); },
        sql: async (sql: string) => { rows.push(sql); } };
      expect(await publishAll(store, "public", [dir], { log: () => {}, now: () => date })).toBe(0);
      expect(puts).toContain("songs/public/laulettu/20261010T123456Z/parts/1-Tenori.mp3 audio/mpeg");
      expect(puts).toContain("songs/public/laulettu/20261010T123456Z/parts/2-Basso.mp3 audio/mpeg");
      expect(rows[0]).toContain('"file":"parts/2-Basso.mp3","sung":true');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uploads a sung bundle's words.json, for the player's unisons (eeron-omat-taskit#110), and no other bundle's", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const sung = bundle(root, "laulettu", true, true);
      const piano = bundle(root, "piano");
      mkdirSync(join(sung, "parts"));
      for (const f of ["1-Tenori.mp3", "2-Basso.mp3"]) writeFileSync(join(sung, "parts", f), f);
      for (const dir of [sung, piano]) writeFileSync(join(dir, "words.json"), '{"parts":[[],[]]}');
      const puts: string[] = [];
      const store = { query, put: async (key: string, _data: unknown, type: string) => { puts.push(`${key} ${type}`); },
        sql: async () => {} };
      expect(await publishAll(store, "public", [sung, piano], { log: () => {}, now: () => date })).toBe(0);
      expect(puts).toContain("songs/public/laulettu/20261010T123456Z/words.json application/json");
      expect(puts.filter((k) => k.includes("words.json"))).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uploads nothing when a bundle is missing a file", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      let puts = 0;
      const store = { query, put: async () => { puts++; }, sql: async () => {} };
      await expect(publishAll(store, "jm", [bundle(root, "hyva"), bundle(root, "vajaa", false)], { log: () => {} }))
        .rejects.toThrow(/missing score.mid/);
      expect(puts).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the voice tree when publishing (#107)", () => {
  const songs = (...names: string[][]) => names.map((parts, i) => ({ manifest: { slug: `laulu${i}`, parts: parts.map((name) => ({ name })) } }));
  it("knows the tree's names, a split part and the names in no place", async () => {
    const tree = await readTree({ query });
    for (const name of ["Basso 2", "bass2", "S1b", "Tenorib", "Tenori solo", "Trio Bar", "Upper bass 2"]) expect(knowsName(tree, name)).toBe(true);
    for (const name of ["Bassi", "Basso 4", "Upper bass 2b", "Kertoja"]) expect(knowsName(tree, name)).toBe(false);
  });
  it("doesn't count a name whose only row the player leaves out: too deep, cut off or in a loop", () => {
    const row = (id: string, parent: string | null, ...names: string[]) => ({ id, parent, names });
    const tree = { unplaced: [], voices: [row("a", null, "A"), row("b", "a", "B"), row("c", "b", "C"), row("d", "c", "D"),
      row("e", "d", "Viides"), row("x", "gone", "Orpo"), row("y", "z", "Kehä"), row("z", "y", "Kehä 2"), row("w", "y", "D")] };
    expect(knowsName(tree, "D")).toBe(true);
    for (const name of ["Viides", "Orpo", "Kehä", "Kehä 2", "Db", "Orpob"]) expect(knowsName(tree, name)).toBe(false);
    expect(knowsName(tree, "Cb")).toBe(true);
    expect(() => treePlan(tree, [{ manifest: { slug: "laulu", parts: [{ name: "Uusi" }] } }], [parsePlace("Uusi=e")]))
      .toThrow(/no place e, or it is below the fourth level/);
    expect(() => treePlan(tree, [{ manifest: { slug: "laulu", parts: [{ name: "Uusi" }] } }], [parsePlace("Uusi=x")]))
      .toThrow(/no place x/);
    expect(() => treePlan(tree, [{ manifest: { slug: "laulu", parts: [{ name: "Viides" }] } }]))
      .toThrow(/"Viides"/);
  });
  it("needs nothing when every part is known", async () => {
    expect(treePlan(await readTree({ query }), songs(["Sopraano", "Basso 2"], ["T1", "T1b"]))).toBe("");
  });
  it("stops on a part with no place given, naming it, its songs and the places", async () => {
    const tree = await readTree({ query });
    expect(() => treePlan(tree, songs(["Bassi", "Basso"], ["bassi"]))).toThrow(/"Bassi" \(laulu0, laulu1\)[\s\S]*--place[\s\S]*B \(Basso\)/);
    expect(() => treePlan(tree, songs(["Bassi", "Kertoja"]), [parsePlace("Bassi=B")])).toThrow(/"Kertoja"/);
  });
  it("puts each new name where the publisher said, and the D1 takes it", async () => {
    const db = migrated();
    const tree = await readTree({ query: async (sql: string) => db.prepare(sql).all() as Record<string, unknown>[] });
    const sql = treePlan(tree, songs(["Bassi", "Basso 4", "Bass 4", "Kertoja"]),
      ["Bassi=B", "Basso 4=B4@B", "Bass 4=B4@B", "Kertoja=-"].map(parsePlace));
    db.exec(sql);
    const names = (id: string) => JSON.parse((db.prepare("SELECT names FROM voices WHERE id = ?").get(id) as { names: string }).names);
    expect(names("B")).toEqual(["Basso", "Bass", "B", "Bassi"]);
    expect(names("B4")).toEqual(["Basso 4", "Bass 4"]);
    expect((db.prepare("SELECT parent FROM voices WHERE id = 'B4'").get() as { parent: string }).parent).toBe("B");
    expect(db.prepare("SELECT name FROM unplaced_parts WHERE name = 'Kertoja'").get()).toBeTruthy();
  });
  it("refuses a place that doesn't fit", async () => {
    const tree = await readTree({ query });
    const plan = (place: string) => () => treePlan(tree, songs(["Bassi"]), [parsePlace(place)]);
    expect(plan("Bassi=Q")).toThrow(/no place Q/);
    expect(plan("Bassi=B2@T")).toThrow(/already under B/);
    expect(plan("Bassi=X@B2u")).toThrow(/fourth level/);
    expect(plan("Basso=B")).toThrow(/already in the tree/);
    expect(() => parsePlace("Bassi")).toThrow(/bad --place/);
    expect(() => parsePlace("Bassi=-@B")).toThrow(/bad --place/);
  });
  it("puts the tree in before any file goes up, and nothing goes up when a name has no place", async () => {
    const root = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const dir = join(root, "uusi");
      mkdirSync(dir);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, slug: "uusi", parts: [{ name: "Tenori" }, { name: "Bassi" }] }));
      for (const f of ["score.musicxml", "timing.json", "score.mid"]) writeFileSync(join(dir, f), f);
      const events: string[] = [];
      const store = { query, put: async (key: string) => { events.push(`put ${key}`); }, sql: async (sql: string) => { events.push(sql); } };
      await expect(publishAll(store, "joy", [dir], { log: () => {}, now: () => date })).rejects.toThrow(/"Bassi"/);
      expect(events).toEqual([]);
      expect(await publishAll(store, "joy", [dir], { log: () => {}, now: () => date, places: [parsePlace("Bassi=B")] })).toBe(0);
      expect(events[0]).toMatch(/^UPDATE voices SET names = .*"Bassi".* WHERE id = 'B';$/);
      expect(events.slice(1).some((e) => e.startsWith("put"))).toBe(true);
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
  it("reads D1 rows, lists R2 page by page and deletes an object (#104)", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      urls.push(`${init.method} ${url}`);
      if (url.includes("/query")) {
        expect(JSON.parse(init.body as string)).toEqual({ sql: "SELECT ?", params: [1] });
        return new Response(JSON.stringify({ success: true, result: [{ results: [{ n: 1 }] }] }));
      }
      if (init.method === "GET") {
        const more = !url.includes("cursor=");
        return new Response(JSON.stringify({ success: true,
          result: [{ key: more ? "p/a" : "p/b", etag: "e", size: 1, http_metadata: {} }],
          result_info: { is_truncated: more, cursor: "c1" } }));
      }
      return new Response("{}");
    };
    const store = cloudflareStore({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, fetchFn, async () => {});
    expect(await store.query("SELECT ?", [1])).toEqual([{ n: 1 }]);
    expect(await store.list("p/")).toEqual([{ key: "p/a", etag: "e", size: 1 }, { key: "p/b", etag: "e", size: 1 }]);
    await store.delete("p/a b");
    expect(urls.at(-1)).toBe("DELETE https://api.cloudflare.com/client/v4/accounts/a/r2/buckets/stemmanauhat/objects/p/a%20b");
    expect(urls[2]).toContain("cursor=c1");
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
