import { describe, expect, it } from "vitest";
import { buildCurve, curveAt, SmoothClock, timeAtX } from "../../src/client/player/scroll";

describe("scroll curve", () => {
  it("keeps a steady scroll steady", () => {
    const c = buildCurve(10, (t) => t * 100, 300);
    expect(curveAt(c, 5)).toBeCloseTo(500, 6);
  });
  it("evens out a speed that lurches from bar to bar", () => {
    // Fast for half a second, slow for half a second, over and over.
    const lurch = (t: number) => Math.floor(t) * 100 + Math.min(t % 1, 0.5) * 160 + Math.max(0, (t % 1) - 0.5) * 40;
    const c = buildCurve(20, lurch, 1000);
    const speeds = [];
    for (let t = 3; t < 17; t += 0.1) speeds.push((curveAt(c, t + 0.1) - curveAt(c, t)) / 0.1);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(15);
    // ...and stays on the music: within a few pixels of where the note is.
    expect(Math.abs(curveAt(c, 10.25) - lurch(10.25))).toBeLessThan(25);
  });
  it("does not smooth across a repeat jumping back", () => {
    const c = buildCurve(10, (t) => (t < 5 ? t * 100 : (t - 5) * 100), 200);
    expect(curveAt(c, 4.9)).toBeGreaterThan(400);
    expect(curveAt(c, 5.05)).toBeLessThan(60);
  });
});

describe("SmoothClock", () => {
  it("runs on between coarse audio updates and snaps after a seek", () => {
    const clock = new SmoothClock();
    clock.read(1, false, 1, 0);
    expect(clock.read(1, true, 1, 100)).toBeCloseTo(1.1, 6);
    expect(clock.read(1, true, 1, 200)).toBeCloseTo(1.2, 6);
    // A late audio update only nudges the clock...
    const nudged = clock.read(1.15, true, 1, 250);
    expect(nudged).toBeGreaterThan(1.15);
    expect(nudged).toBeLessThan(1.25);
    // ...a seek moves it at once.
    expect(clock.read(30, true, 1, 300)).toBe(30);
  });
});

describe("timeAtX", () => {
  it("finds the time a position is shown, both ways", () => {
    const c = buildCurve(10, (t) => t * 100, 300);
    expect(timeAtX(c, 700, 5)).toBeCloseTo(7, 2);
    expect(timeAtX(c, 250, 5)).toBeCloseTo(2.5, 2);
    expect(timeAtX(c, 5000, 5)).toBeCloseTo(10, 2);
    expect(timeAtX(c, -50, 5)).toBe(0);
  });
  it("stays in the pass being played when a repeat comes back over the same place", () => {
    const c = buildCurve(10, (t) => (t < 5 ? t * 100 : (t - 5) * 100), 200);
    // The second pass (after 5 s) shows the same positions again.
    expect(timeAtX(c, 300, 7)).toBeCloseTo(8, 1);
    expect(timeAtX(c, 300, 2)).toBeCloseTo(3, 1);
  });
});
