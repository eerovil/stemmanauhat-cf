import { describe, expect, it } from "vitest";
import { DEFAULT_OTHERS, mixLevels } from "../../src/client/player/mixer";

describe("mixLevels", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  it("plays the default mix as is: your part full, the others at the videos' level", () => {
    const levels = mixLevels(4, 2, DEFAULT_OTHERS);
    expect(levels[2]).toBe(1);
    expect(levels[0]).toBeCloseTo(0.08, 3);
  });
  it("never lets the mix get louder than the default, so all parts up does not clip", () => {
    const budget = sum(mixLevels(4, 0, DEFAULT_OTHERS));
    const all = mixLevels(4, 0, 1);
    expect(sum(all)).toBeCloseTo(budget, 6);
    expect(new Set(all.map((x) => x.toFixed(6))).size).toBe(1);
  });
  it("leaves your part alone when the others are quieter than default", () => {
    expect(mixLevels(4, 1, 0)).toEqual([0, 1, 0, 0]);
  });
});
