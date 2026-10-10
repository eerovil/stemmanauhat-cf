import { describe, expect, it } from "vitest";
import { DEFAULT_OTHERS, mixLevels } from "../../src/client/player/mix";

describe("mixLevels", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  it("plays your part at 1 and the others at 0.16 by default", () => {
    const levels = mixLevels(4, 2, DEFAULT_OTHERS);
    expect(levels[2]).toBe(1);
    expect(levels[0]).toBeCloseTo(0.16, 6);
  });
  it("never gets louder than the default mix when the others go up", () => {
    const budget = sum(mixLevels(8, 0, DEFAULT_OTHERS));
    for (const others of [0.6, 0.8, 1]) expect(sum(mixLevels(8, 0, others))).toBeCloseTo(budget, 6);
    expect(new Set(mixLevels(4, 0, 1).map((x) => x.toFixed(6))).size).toBe(1);
  });
  it("mutes your part for 'Ilman omaa' and keeps the mix no louder than the default", () => {
    const levels = mixLevels(4, 1, 1, false);
    expect(levels[1]).toBe(0);
    expect(sum(levels)).toBeCloseTo(sum(mixLevels(4, 1, DEFAULT_OTHERS)), 6);
  });
  it("plays your part alone at full volume", () => {
    expect(mixLevels(4, 1, 0)).toEqual([0, 1, 0, 0]);
  });
});
