import { describe, expect, it } from "vitest";
import { loopRange, loopTarget, parseTiming, positionAt, startsOf, type Timing } from "../../src/client/player/timing";

// Bar 0 at 1 s a beat, then bar 1 played twice (a repeat), then bar 2.
const timing: Timing = parseTiming({
  version: 1, measures: 3, duration: 10,
  points: [
    [0, 0, 0], [1, 0, 1], [2, 0, 2],
    [2, 1, 0], [3, 1, 1], [4, 1, 2],
    [4, 1, 0], [5, 1, 1], [6, 1, 2],
    [6, 2, 0], [8, 2, 1], [10, 2, 2],
  ],
});

describe("positionAt", () => {
  it("moves in a straight line inside a bar", () => {
    expect(positionAt(timing, 0.5)).toEqual({ measure: 0, beat: 0.5 });
    expect(positionAt(timing, 7)).toEqual({ measure: 2, beat: 0.5 });
  });
  it("jumps to the next bar, and back on a repeat", () => {
    expect(positionAt(timing, 2)).toEqual({ measure: 1, beat: 0 });
    expect(positionAt(timing, 3.5)).toEqual({ measure: 1, beat: 1.5 });
    expect(positionAt(timing, 4)).toEqual({ measure: 1, beat: 0 });
  });
  it("stays at the ends", () => {
    expect(positionAt(timing, -1)).toEqual({ measure: 0, beat: 0 });
    expect(positionAt(timing, 99)).toEqual({ measure: 2, beat: 2 });
  });
});

describe("repeats and loops", () => {
  it("finds each play-through of a bar", () => {
    // Bar 1 is repeated straight after itself: its beat going back marks the second pass.
    expect(startsOf(timing, 1)).toEqual([2, 4]);
    expect(startsOf(timing, 2)).toEqual([6]);
  });
  it("loops from a bar to the end of another", () => {
    expect(loopRange(timing, 0, 1, 0)).toEqual([0, 4]);
    expect(loopRange(timing, 1, 1, 4.5)).toEqual([4, 6]);
    expect(loopRange(timing, 2, 2, 9)).toEqual([6, 10]);
    expect(loopRange(timing, 2, 0, 9)).toBeNull();
  });
  it("refuses a file that is not version 1", () => {
    expect(() => parseTiming({ version: 2, points: [] })).toThrow();
    expect(() => parseTiming({ version: 1, points: [[0, 0]] })).toThrow();
  });
});

describe("a loop whose start bar repeats", () => {
  // Bars 0-5 at 2 s each (0-12 s), then a D.C. plays them all again (12-24 s).
  const points: [number, number, number][] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let bar = 0; bar < 6; bar++) {
      const t = pass * 12 + bar * 2;
      points.push([t, bar, 0], [t + 1, bar, 1], [t + 2, bar, 2]);
    }
  }
  const dc = parseTiming({ version: 1, measures: 6, duration: 24, points });

  it("keeps the range it was set with, and wraps at its end", () => {
    const range = loopRange(dc, 0, 5, 0);
    expect(range).toEqual([0, 12]);
    // Recomputing near the end would pick the second pass, which never wraps.
    expect(loopRange(dc, 0, 5, 11.9)).toEqual([12, 24]);
    expect(loopTarget(range, 11)).toBeNull();
    expect(loopTarget(range, 11.99)).toBe(0);
    expect(loopTarget(null, 11.99)).toBeNull();
  });
});
