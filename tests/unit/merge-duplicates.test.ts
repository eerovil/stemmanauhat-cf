import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script without types
import { mergeDuplicates } from "../../scripts/merge-duplicate-songs.mjs";

type Row = { choir: string; slug: string; title: string; prefix: string; parts: string; duration: number };
const PARTS = JSON.stringify([{ name: "T1" }, { name: "T2" }]);
const row = (choir: string, slug: string, version: string, extra: Partial<Row> = {}): Row =>
  ({ choir, slug, title: slug, prefix: `songs/${choir}/${slug}/${version}/`, parts: PARTS, duration: 60, ...extra });

/** D1 and R2 in memory: `objects` maps a key to its checksum. */
function store(given: Row[], objects: Record<string, string>) {
  const rows = given.map((r) => ({ ...r }));
  const deleted: string[] = [];
  return {
    rows, objects, deleted,
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("UPDATE")) {
        const [keep, slug, prefix] = params as string[];
        for (const r of rows) if (r.slug === slug && r.prefix === prefix) r.prefix = keep!;
        return [];
      }
      return rows.map((r) => ({ ...r }));
    },
    async list(prefix: string) {
      return Object.entries(objects).filter(([k]) => k.startsWith(prefix)).map(([key, etag]) => ({ key, etag, size: 1 }));
    },
    async delete(key: string) { deleted.push(key); delete objects[key]; },
  };
}

/** A copy's files with their checksums; `manifest.json` names its choir, so it always differs. */
function copy(prefix: string, sums: Record<string, string> = {}) {
  const files: Record<string, string> = {};
  for (const name of ["score.musicxml", "score.mid", "timing.json", "parts/1-T1.mp3"]) files[prefix + name] = sums[name] ?? `sum-${name}`;
  files[`${prefix}manifest.json`] = `sum-${prefix}`;
  return files;
}

describe("mergeDuplicates", () => {
  it("keeps jm's copy when the files are the same, and changes nothing without --apply", async () => {
    const jm = row("jm", "maamme", "20261016T193056Z");
    const pub = row("public", "maamme", "20261016T193122Z");
    const s = store([jm, pub], { ...copy(jm.prefix), ...copy(pub.prefix) });
    const log: string[] = [];
    expect(await mergeDuplicates(s, { log: (l: string) => log.push(l) })).toBe(0);
    expect(log[0]).toBe(`maamme: keep ${jm.prefix}, drop ${pub.prefix} (same files)`);
    expect(s.rows.map((r) => r.prefix)).toEqual([jm.prefix, pub.prefix]);
    expect(s.deleted).toEqual([]);

    expect(await mergeDuplicates(s, { apply: true, log: () => {} })).toBe(0);
    expect(s.rows.map((r) => r.prefix)).toEqual([jm.prefix, jm.prefix]);
    expect(s.deleted.sort()).toEqual(Object.keys(copy(pub.prefix)).sort());
    expect(Object.keys(s.objects).every((k) => k.startsWith(jm.prefix))).toBe(true);
  });
  it("keeps the newer copy when the files differ", async () => {
    const jm = row("jm", "serenadi", "20261016T193418Z");
    const pub = row("public", "serenadi", "20261016T193021Z");
    const s = store([pub, jm], { ...copy(jm.prefix, { "score.mid": "new" }), ...copy(pub.prefix) });
    const log: string[] = [];
    await mergeDuplicates(s, { apply: true, log: (l: string) => log.push(l) });
    expect(log[0]).toBe(`serenadi: keep ${jm.prefix}, drop ${pub.prefix} (newer)`);
    expect(s.rows.map((r) => r.prefix)).toEqual([jm.prefix, jm.prefix]);
    const older = row("public", "x", "20261016T193021Z");
    const newer = row("jm", "x", "20261015T000000Z");
    const t = store([older, newer], { ...copy(older.prefix, { "timing.json": "b" }), ...copy(newer.prefix) });
    await mergeDuplicates(t, { apply: true, log: () => {} });
    expect(t.rows.map((r) => r.prefix)).toEqual([older.prefix, older.prefix]);
  });
  it("skips songs whose rows differ and leaves other songs and folders alone", async () => {
    const a = row("jm", "eri", "20261016T000000Z");
    const b = row("public", "eri", "20261016T000001Z", { parts: JSON.stringify([{ name: "T1" }]) });
    const alone = row("naiskuoro", "yksin", "20261016T000000Z");
    const old = "songs/jm/eri/20261001T000000Z/";
    const s = store([a, b, alone], { ...copy(a.prefix), ...copy(b.prefix), ...copy(alone.prefix), ...copy(old) });
    const log: string[] = [];
    await mergeDuplicates(s, { apply: true, log: (l: string) => log.push(l) });
    expect(log[0]).toBe("eri: skipped, the lists' rows differ in title, parts or length");
    expect(s.deleted).toEqual([]);
    expect(s.rows.map((r) => r.prefix)).toEqual([a.prefix, b.prefix, alone.prefix]);
  });
  it("merges only jm and public pairs, never a test list version or another list's copy", async () => {
    const live = row("jm", "uusi", "20261016T000000Z");
    const staged = row("testi", "uusi", "20261017T000000Z");
    const nais = row("naiskuoro", "toinen", "20261016T000000Z");
    const joy = row("joy", "toinen", "20261016T000001Z");
    const three = [row("jm", "kolme", "20261016T000000Z"), row("public", "kolme", "20261016T000001Z"),
      row("testi", "kolme", "20261017T000000Z")];
    const rows = [live, staged, nais, joy, ...three];
    const s = store(rows, Object.assign({}, ...rows.map((r) => copy(r.prefix))));
    const log: string[] = [];
    expect(await mergeDuplicates(s, { apply: true, log: (l: string) => log.push(l) })).toBe(0);
    expect(log).toContain("uusi: skipped, on jm, testi, not just jm and public");
    expect(log).toContain("toinen: skipped, on joy, naiskuoro, not just jm and public");
    expect(log).toContain("kolme: skipped, on jm, public, testi, not just jm and public");
    expect(s.deleted).toEqual([]);
    expect(s.rows.map((r) => r.prefix)).toEqual(rows.map((r) => r.prefix));
  });
  it("checks every row afterwards and fails when any has no score.mid, merged or not", async () => {
    const jm = row("jm", "maamme", "20261016T193056Z");
    const pub = row("public", "maamme", "20261016T193122Z");
    const other = row("naiskuoro", "rikki", "20261016T000000Z");
    const files = { ...copy(jm.prefix), ...copy(pub.prefix), ...copy(other.prefix) };
    delete files[`${other.prefix}score.mid`];
    const s = store([jm, pub, other], files);
    const log: string[] = [];
    expect(await mergeDuplicates(s, { apply: true, log: (l: string) => log.push(l) })).toBe(1);
    expect(log).toContain(`no score.mid under ${other.prefix}`);
    expect(s.rows.map((r) => r.prefix)).toEqual([jm.prefix, jm.prefix, other.prefix]);
  });
  it("leaves a song whose copy has no score.mid", async () => {
    const jm = row("jm", "vanha", "20261016T000000Z");
    const pub = row("public", "vanha", "20261016T000001Z");
    const files = { ...copy(jm.prefix), ...copy(pub.prefix) };
    delete files[`${pub.prefix}score.mid`];
    const s = store([jm, pub], files);
    const log: string[] = [];
    await mergeDuplicates(s, { apply: true, log: (l: string) => log.push(l) });
    expect(log[0]).toBe("vanha: skipped, a copy has no score.mid");
    expect(s.deleted).toEqual([]);
  });
});
