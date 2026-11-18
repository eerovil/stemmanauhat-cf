import { describe, expect, it } from "vitest";
import { columns, LEFT, stampAt } from "../../src/client/player/signature";

describe("pinned signature columns", () => {
  it("starts at the line's own first sign and spaces the rest as VexFlow does", () => {
    // The first bar of tests/fixtures/signatures: a clef 24.4 wide, one flat 7.4 wide, 4/4 13.5 wide.
    const { x, width } = columns({ clef: 24.4, key: 7.4, time: 13.5 });
    expect(x.clef).toBe(LEFT);
    expect(x.key).toBeCloseTo(60.4, 1);
    expect(x.time).toBeCloseTo(84.3, 1);
    expect(width).toBeGreaterThan(x.time + 13.5);
  });
  it("leaves out a kind no staff has, with no gap for it", () => {
    const withKey = columns({ clef: 24, key: 8, time: 13 });
    const noKey = columns({ clef: 24, key: 0, time: 13 });
    expect(noKey.x.time).toBeLessThan(withKey.x.time);
    expect(noKey.width).toBeLessThan(withKey.width);
    // A time signature alone starts where the first sign does.
    expect(columns({ clef: 0, key: 0, time: 13 }).x.time).toBe(LEFT);
  });
});

describe("which signature is pinned", () => {
  // Two changes: bar one's signs (first), then two more, each 100 px wide, ending at 1000 and 2000.
  const stamps = [{ end: 100, width: 100 }, { end: 1000, width: 120 }, { end: 2000, width: 110 }];
  it("keeps the first until a change has slid under it", () => {
    expect(stampAt(stamps, 0)).toBe(0);
    expect(stampAt(stamps, 800)).toBe(0);
    // The change's own drawing ends 1000 - 899 = 101 px from the edge: still showing past the pinned 100.
    expect(stampAt(stamps, 899)).toBe(0);
    expect(stampAt(stamps, 900)).toBe(1);
  });
  it("moves on to the next, and back when the line jumps back (a repeat)", () => {
    expect(stampAt(stamps, 1950)).toBe(2);
    expect(stampAt(stamps, 1700)).toBe(1);
    expect(stampAt(stamps, 50)).toBe(0);
  });
  it("is the first for a score with no changes", () => {
    expect(stampAt([{ end: 100, width: 100 }], 5000)).toBe(0);
    expect(stampAt([], 5000)).toBe(0);
  });
});
