import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { focusOf, keepChoirPart, partLabel, placeOf, staffCount, staffOf, startingPart, visibleStaves, type Voice }
  from "../../src/client/player/part";

/** The voice tree as the migration seeds it (#107). */
const tree: Voice[] = [...readFileSync("migrations/0009_voices.sql", "utf8")
  .matchAll(/^ {2}\('([^']+)', (NULL|'[^']+'), '([^']+)', '([^']+)', '(\[.*\])'\)/gm)]
  .map(([, id, parent, fi, en, names]) => ({ id: id!, parent: parent === "NULL" ? null : parent!.slice(1, -1), fi: fi!, en: en!,
    names: JSON.parse(names!) }));

describe("startingPart", () => {
  const split = ["S1", "S1b", "S2", "A1", "A2"];
  const plain = ["S1", "S2", "A1", "A2"];
  it("starts on the part chosen for this song first", () => {
    expect(startingPart(split, "S2", "S1b")).toBe(2);
    expect(startingPart(plain, "A1", "S1b")).toBe(2);
  });
  it("else starts on the choir part, the split one when the song has it", () => {
    expect(startingPart(split, null, "S1b")).toBe(1);
    expect(startingPart(split, "T1", "A2")).toBe(4);
  });
  it("falls back from a split part to the unsplit one in a song without it", () => {
    expect(startingPart(plain, null, "S1b")).toBe(0);
    expect(startingPart(["T1", "T2", "B1", "B2"], undefined, "T1b")).toBe(0);
    expect(startingPart(plain, "T1", "A2b")).toBe(3);
  });
  it("asks when neither part is in the song", () => {
    expect(startingPart(plain, null, null)).toBe(-1);
    expect(startingPart(plain, "T1", "T1b")).toBe(-1);
    expect(startingPart(["b", "B"], null, "b")).toBe(0);
    expect(startingPart(["T1", "T2"], null, "b")).toBe(-1);
  });
});

describe("the voice tree (#107)", () => {
  it("is seeded, at most four levels deep", () => {
    expect(tree.length).toBeGreaterThan(30);
    expect(tree.every((v) => placeOf(v.names[0]!, tree) !== null)).toBe(true);
    expect(placeOf("Upper bass 2", tree)).toEqual(["men", "B", "B2", "B2u"]);
  });
  it("reads one place from its many names, ignoring case and spaces", () => {
    for (const name of ["Sopraano 1", "S1", "soprano 1", "Soprano1"]) expect(placeOf(name, tree)).toEqual(["women", "S", "S1"]);
    for (const name of ["Basso", "Bass", "B"]) expect(placeOf(name, tree)).toEqual(["men", "B"]);
    expect(placeOf("Baritoni", tree)).toEqual(["men", "Bar"]);
    expect(placeOf("Miehet", tree)).toEqual(["men"]);
    expect(placeOf("Men", tree)).toEqual(["men"]);
  });
  it("puts a split part just below the part it splits", () => {
    expect(placeOf("Tenorib", tree)).toEqual(["men", "T", "T+b"]);
    expect(placeOf("T1b", tree)).toEqual(["men", "T", "T1", "T1+b"]);
    expect(placeOf("Upper bass 2b", tree)).toBeNull();
  });
  it("knows no solo or trio part, so those match only themselves", () => {
    for (const name of ["Tenori solo", "Solo 1", "Trio T1", "Solo", "Bassi"]) expect(placeOf(name, tree)).toBeNull();
  });
  it("leaves out a row too deep or whose parents loop or are missing", () => {
    const deep: Voice[] = ([{ id: "a", parent: null, names: ["a"] }, { id: "b", parent: "a", names: ["bb"] },
      { id: "c", parent: "b", names: ["c"] }, { id: "d", parent: "c", names: ["d"] }, { id: "e", parent: "d", names: ["e"] },
      { id: "x", parent: "y", names: ["x"] }, { id: "y", parent: "x", names: ["y"] }, { id: "z", parent: "gone", names: ["z"] }] as Omit<Voice, "fi" | "en">[]).map((v) => ({ ...v, fi: v.id, en: v.id }));
    expect(placeOf("d", deep)).toEqual(["a", "b", "c", "d"]);
    expect(placeOf("e", deep)).toBeNull();
    expect(placeOf("x", deep)).toBeNull();
    expect(placeOf("z", deep)).toBeNull();
    // A name on a broken row and on a whole one is read from the whole one, as publishing does.
    expect(placeOf("e", [...deep, { id: "f", parent: "a", fi: "f", en: "f", names: ["e"] }])).toEqual(["a", "f"]);
  });

  const start = (names: string[], choirPart: string, songPart: string | null = null) =>
    startingPart(names, songPart, choirPart, tree);
  it("carries a divided part to the undivided one, whatever the song calls it", () => {
    expect(start(["Sopraano", "Altto", "Tenori", "Basso"], "Basso 2")).toBe(3);
    expect(start(["Soprano", "Alto", "Tenor", "Bass"], "Basso 2")).toBe(3);
    expect(start(["Sopraano", "Basso 1", "Basso 2"], "Bass 2")).toBe(2);
    expect(start(["Sopraano", "Basso 1", "Basso 2"], "B2")).toBe(2);
    expect(start(["Basso 1", "Basso 2"], "Upper bass 2")).toBe(1);
    expect(start(["Naiset", "Miehet"], "Basso 2")).toBe(1);
    expect(start(["T1", "T2", "B1", "B2"], "T1b")).toBe(0);
  });
  it("never moves down or sideways in the tree", () => {
    expect(start(["Sopraano", "Basso 1", "Basso 2"], "Basso")).toBe(-1);
    expect(start(["Upper bass 2", "Lower bass 2"], "Basso 2")).toBe(-1);
    expect(start(["Miehet", "Altto 2"], "Altto 1")).toBe(-1);
    expect(start(["Sopraano solo", "Altto"], "Sopraano")).toBe(-1);
  });
  it("prefers the exact name, and a solo is never the choir part", () => {
    expect(start(["Tenori solo", "Tenori"], "Tenori")).toBe(1);
    expect(start(["Tenori", "Tenori solo"], "Tenori solo")).toBe(1);
    expect(start(["B", "Basso"], "Basso")).toBe(1);
  });
  it("finds the song's own part by its place too", () => {
    expect(start(["Tenori", "Bass"], "Tenori", "Basso")).toBe(1);
  });
  it("shows every part by its place's own name, in the site's language", () => {
    for (const name of ["B2", "Bass 2", "basso2"]) expect(partLabel(name, tree, "fi")).toBe("Basso 2");
    expect(partLabel("B2", tree, "en")).toBe("Bass 2");
    expect(partLabel("Upper B2", tree, "fi")).toBe("Basso 2 ylä");
    expect(partLabel("Mezzo", tree, "en")).toBe("Mezzo-soprano");
    expect(partLabel("Tenori solo", tree, "en")).toBe("Tenori solo");
    expect(partLabel("T1b", tree, "fi")).toBe("T1b");
    expect(partLabel("B2", [], "fi")).toBe("B2");
  });
  it("keeps the choir part when the singer picks a place above it", () => {
    expect(keepChoirPart("Basso 2", "Basso", tree)).toBe(true);
    expect(keepChoirPart("Upper bass 2", "Basso 2", tree)).toBe(true);
    expect(keepChoirPart("Basso 2", "Miehet", tree)).toBe(true);
    expect(keepChoirPart("Basso 2", "Tenori", tree)).toBe(false);
    expect(keepChoirPart("Basso", "Basso 2", tree)).toBe(false);
    expect(keepChoirPart("Basso 2", "Bass 2", tree)).toBe(false);
    expect(keepChoirPart(null, "Basso", tree)).toBe(false);
  });
});

describe("where a part is drawn (musescore-choir-plugins#420)", () => {
  const shared = [{ staff: 0, voices: [1] }, { staff: 0, voices: [2] }, { staff: 1, voices: [1] }];
  const own = [{}, {}, {}];
  it("a part without a staff has its own, at its own index", () => {
    expect([0, 1, 2].map((i) => staffOf(own, i))).toEqual([0, 1, 2]);
    expect(staffCount(own)).toBe(3);
    expect(focusOf(own, 1)).toEqual({ staff: 1, voices: undefined });
  });
  it("parts sharing a staff are drawn on it, each in its own voices", () => {
    expect([0, 1, 2].map((i) => staffOf(shared, i))).toEqual([0, 0, 1]);
    expect(staffCount(shared)).toBe(2);
    expect(focusOf(shared, 1)).toEqual({ staff: 0, voices: [2] });
  });
  it("draws every staff, or only the singer's own, shared or not", () => {
    expect(visibleStaves(shared, 1, true)).toEqual([true, true]);
    expect(visibleStaves(shared, 1, false)).toEqual([true, false]);
    expect(visibleStaves(shared, 2, false)).toEqual([false, true]);
    expect(visibleStaves(own, 2, false)).toEqual([false, false, true]);
  });
});
