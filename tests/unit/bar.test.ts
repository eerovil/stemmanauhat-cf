import { describe, expect, it } from "vitest";
import { barAnchors, xOnAnchors } from "../../src/client/player/bar";
import { barLengths, parseTiming, positionAt } from "../../src/client/player/timing";

// A 4/4 song with a 3-beat pickup bar, as Finlandia-hymni has: bar 0 ends at beat 3.
const timing = parseTiming({
  version: 1, measures: 2, duration: 3.5,
  points: [
    [0, 0, 0], [0.5, 0, 1], [1, 0, 2], [1.5, 0, 3],
    [1.5, 1, 0], [2, 1, 1], [2.5, 1, 2], [3, 1, 3], [3.5, 1, 4],
  ],
});

describe("barLengths", () => {
  it("takes each bar's length from where its end point sits", () => {
    expect(barLengths(timing)).toEqual(new Map([[0, 3], [1, 4]]));
  });
});

describe("a short first bar", () => {
  // Notes on beats 0, 1 and 2, engraved 100 px apart; the bar line sits at 300 px.
  const onsets = new Map([[0, 0], [1, 100], [2, 200]]);
  const anchors = barAnchors(onsets, barLengths(timing).get(0)!, -8, 302);

  it("moves evenly up to the bar line", () => {
    // Every quarter second until the music crosses into bar 1 at 1.5 s.
    const xs = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.49].map((t) => xOnAnchors(anchors, positionAt(timing, t).beat));
    const speeds = xs.slice(1).map((x, i) => (x - xs[i]!) / (i === 5 ? 0.24 : 0.25));
    for (const speed of speeds) expect(speed).toBeCloseTo(200, 6);
    expect(xOnAnchors(anchors, 3)).toBe(300);
  });

  it("would slow down through the last beat with the time signature's length", () => {
    // The old behaviour, kept as a check that the test above can tell the difference:
    // half speed over beat 3, then a 50 px catch-up at the bar line.
    const wrong = barAnchors(onsets, 4, -8, 302);
    expect(xOnAnchors(wrong, 3) - xOnAnchors(wrong, 2)).toBeCloseTo(50, 6);
    expect(xOnAnchors(wrong, 3)).toBeCloseTo(250, 6);
  });
});
