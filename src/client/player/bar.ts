/**
 * Where the music is inside one bar: [beat in quarters, x] anchors, one per note
 * onset plus the bar's end. Kept apart from OSMD so it can be tested on its own.
 */
export type Anchor = [beat: number, x: number];

/**
 * Sorts the onsets and closes them with a start and an end anchor. `length` is
 * how long the bar really plays: a pickup or a bar cut short before a repeat ends
 * before its time signature says, and an end anchor placed too late would slow
 * the position down through the bar's last beat and rush it across the bar line.
 */
export function barAnchors(onsets: Map<number, number>, length: number, x0: number, x1: number): Anchor[] {
  const anchors = [...onsets.entries()].sort((a, b) => a[0] - b[0]);
  if (!anchors.length || anchors[0]![0] > 0) anchors.unshift([0, anchors[0]?.[1] ?? x0 + 8]);
  const lastBeat = anchors[anchors.length - 1]![0];
  anchors.push([Math.max(length, lastBeat + 0.001), x1 - 2]);
  return anchors;
}

/** The x at a beat, sliding in a straight line between anchors. */
export function xOnAnchors(a: Anchor[], beat: number): number {
  for (let i = 0; i < a.length - 1; i++) {
    const [b0, x0] = a[i]!;
    const [b1, x1] = a[i + 1]!;
    if (beat <= b1) return b1 > b0 ? x0 + ((Math.max(beat, b0) - b0) / (b1 - b0)) * (x1 - x0) : x0;
  }
  return a[a.length - 1]![1];
}

/**
 * Ends each bar where the next bar's music starts, when the two sit on one line,
 * instead of at the bar line. Otherwise the position jumps the gap between the
 * bar line and the next bar's first note at every bar, and the smoothed scroll
 * turns each jump into a sudden change of speed (a hitch the eye catches).
 */
export function joinBars(bars: ({ x1: number; top: number; anchors: Anchor[] } | undefined)[]): void {
  for (let i = 0; i + 1 < bars.length; i++) {
    const bar = bars[i];
    const next = bars[i + 1];
    if (!bar || !next || Math.abs(next.top - bar.top) > 1 || next.anchors[0]![1] < bar.x1 - 2) continue;
    bar.anchors[bar.anchors.length - 1]![1] = next.anchors[0]![1];
  }
}
