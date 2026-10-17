import { describe, expect, it } from "vitest";
import { biggestStep, cappedTargets, MAX_RATIO, needsWidening, nextFactors } from "../../src/client/player/spacing";

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 6));

describe("cappedTargets", () => {
  it("widens the bars around a dense one, less and less further away, and narrows nothing", () => {
    const widths = [100, 100, 500, 100, 100, 100];
    const lengths = [4, 4, 4, 4, 4, 4];
    const want = cappedTargets(widths, lengths);
    close(want, [500 / MAX_RATIO ** 2, 500 / MAX_RATIO, 500, 500 / MAX_RATIO, 500 / MAX_RATIO ** 2, 500 / MAX_RATIO ** 3]);
    want.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(widths[i]!));
    expect(biggestStep(want, lengths)).toBeLessThanOrEqual(MAX_RATIO + 1e-9);
  });

  it("leaves a score that is already even alone", () => {
    const widths = [100, 120, 110, 100];
    const lengths = [4, 4, 4, 4];
    expect(cappedTargets(widths, lengths)).toEqual(widths);
    expect(needsWidening(widths, cappedTargets(widths, lengths))).toBe(false);
  });

  it("does not let a short pickup stretch the bars after it", () => {
    // A sixteenth pickup drawn 30 wide is 120 a quarter at its word; judged as a quarter it is 30.
    const widths = [30, 100, 100];
    const lengths = [0.25, 4, 4];
    expect(cappedTargets(widths, lengths)).toEqual(widths);
  });

  it("compares speed, not width: a 3/4 bar beside a 4/4 one stays narrower", () => {
    const widths = [100, 75, 100];
    const lengths = [4, 3, 4];
    expect(cappedTargets(widths, lengths)).toEqual(widths);
  });

  it("keeps a bar with nothing drawn as it is, and it does not pull its neighbours", () => {
    const widths = [100, 0, 500];
    const lengths = [4, 4, 4];
    close(cappedTargets(widths, lengths), [100, 0, 500]);
  });
});

describe("nextFactors", () => {
  it("scales only the bars still short of their target", () => {
    close(nextFactors([1, 1, 1.5], [100, 200, 300], [150, 200, 300]), [1.5, 1, 1.5]);
  });

  it("aims a bar widened once along the line through its two measurements", () => {
    // A bar of rests: 60 of fixed room plus 40 per unit of factor. Scaling by
    // 160 / 100 reached 124; the line through both layouts lands on 160 (#75).
    const once = nextFactors([1], [100], [160]);
    close(once, [1.6]);
    close(nextFactors(once, [124], [160], { factors: [1], have: [100] }), [2.5]);
  });
});

describe("biggestStep", () => {
  it("is the largest speed ratio between neighbours either way round", () => {
    expect(biggestStep([100, 300, 150], [4, 4, 4])).toBeCloseTo(3);
    expect(biggestStep([100], [4])).toBe(1);
  });
});
