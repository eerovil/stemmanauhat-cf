import { describe, expect, it } from "vitest";
import { nearest, parseTiming, positionAt, startsOf, type Timing } from "../../src/client/player/timing";

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

describe("repeats", () => {
  it("finds each play-through of a bar", () => {
    // Bar 1 is repeated straight after itself: its beat going back marks the second pass.
    expect(startsOf(timing, 1)).toEqual([2, 4]);
    expect(startsOf(timing, 2)).toEqual([6]);
  });
  it("jumps to the play-through of a bar nearest the current time", () => {
    expect(nearest(startsOf(timing, 1), 0)).toBe(2);
    expect(nearest(startsOf(timing, 1), 4.5)).toBe(4);
  });
  it("refuses a file that is not version 1", () => {
    expect(() => parseTiming({ version: 2, points: [] })).toThrow();
    expect(() => parseTiming({ version: 1, points: [[0, 0]] })).toThrow();
  });
});
