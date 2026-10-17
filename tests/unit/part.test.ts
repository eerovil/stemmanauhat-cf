import { describe, expect, it } from "vitest";
import { focusOf, staffCount, staffOf, startingPart, visibleStaves } from "../../src/client/player/part";

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
