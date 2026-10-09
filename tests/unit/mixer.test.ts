import { describe, expect, it } from "vitest";
import { DEFAULT_OTHERS, mixLevels } from "../../src/client/player/mixer";

describe("mixLevels", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  it("never lets the gains add up to more than 1, so the mix cannot clip", () => {
    for (const others of [0, DEFAULT_OTHERS, 0.7, 1]) {
      for (const count of [2, 4, 8]) expect(sum(mixLevels(count, 0, others))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it("keeps the balance: the others at 0.16 of your part by default", () => {
    const levels = mixLevels(4, 2, DEFAULT_OTHERS);
    expect(levels[0]! / levels[2]!).toBeCloseTo(0.16, 6);
    expect(levels[2]).toBeCloseTo(1 / 1.48, 6);
  });
  it("plays every part equally when the others are turned all the way up", () => {
    expect(mixLevels(4, 0, 1)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
  it("plays your part at full volume alone", () => {
    expect(mixLevels(4, 1, 0)).toEqual([0, 1, 0, 0]);
  });
});
