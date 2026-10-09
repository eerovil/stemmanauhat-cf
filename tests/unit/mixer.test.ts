import { describe, expect, it } from "vitest";
import { DEFAULT_OTHERS, mixLevels, VIDEO_OTHERS } from "../../src/client/player/mixer";

describe("mixLevels", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  it("plays the videos' mix as is: your part full, the others at 36/127", () => {
    const levels = mixLevels(4, 2, VIDEO_OTHERS);
    expect(levels[2]).toBe(1);
    expect(levels[0]).toBeCloseTo(0.08, 3);
  });
  it("defaults to the others a bit louder than the videos, within the same loudness", () => {
    const video = mixLevels(4, 2, VIDEO_OTHERS);
    const levels = mixLevels(4, 2, DEFAULT_OTHERS);
    expect(levels[0]! / levels[2]!).toBeCloseTo(0.16, 3);
    expect(sum(levels)).toBeCloseTo(sum(video), 6);
  });
  it("never lets the mix get louder than the videos' mix, so all parts up does not clip", () => {
    const budget = sum(mixLevels(4, 0, VIDEO_OTHERS));
    const all = mixLevels(4, 0, 1);
    expect(sum(all)).toBeCloseTo(budget, 6);
    expect(new Set(all.map((x) => x.toFixed(6))).size).toBe(1);
  });
  it("leaves your part alone when the others are quieter than the videos'", () => {
    expect(mixLevels(4, 1, 0)).toEqual([0, 1, 0, 0]);
  });
});
