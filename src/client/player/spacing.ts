/**
 * Widening the bars that would scroll too fast, as song-app does for the videos
 * (eerovil/musescore-choir-plugins src/scrollvideo/spacing.py). A bar is drawn as
 * wide as what is in it needs: a bar of sixteenths with lyrics comes out far
 * wider per beat than a bar of half notes, so the one-line view speeds up and
 * slows down with the engraving. What a singer notices is a step in that speed
 * between neighbouring bars, so that step is capped and bars are only widened.
 *
 * The narrowest widths per beat with `x[i] >= natural[i]` and neighbours within
 * the cap are `x[i] = max over j of natural[j] / cap^|i - j|`: one dense bar
 * widens the few bars around it and the far end of the song not at all.
 */

/** The biggest step in width per beat allowed between one bar and the next, as in the videos. */
export const MAX_RATIO = 1.3;
/**
 * A bar shorter than this many quarters is compared as if it lasted this long: a
 * short pickup is always wide per beat (a note has a smallest width), and taken
 * at its word it stretched every bar after it (song-app #376).
 */
export const SHORTEST_COMPARED = 1;
/** A bar this close to its target counts as there. */
export const TOLERANCE = 0.01;

/**
 * How wide each bar has to be for the scroll to keep the cap. `widths` is how far
 * the music travels through each bar and `lengths` how long it plays, in quarters.
 * A bar with no width or no length (nothing drawn) keeps what it has and does not
 * pull its neighbours.
 */
export function cappedTargets(widths: number[], lengths: number[], maxRatio = MAX_RATIO): number[] {
  const judged = lengths.map((l) => Math.max(l, SHORTEST_COMPARED));
  const usable = widths.map((w, i) => w > 0 && lengths[i]! > 0);
  const perBeat = widths.map((w, i) => (usable[i] ? w / judged[i]! : 0));
  const out = [...perBeat];
  for (let i = 1; i < out.length; i++) if (usable[i]) out[i] = Math.max(out[i]!, out[i - 1]! / maxRatio);
  for (let i = out.length - 2; i >= 0; i--) if (usable[i]) out[i] = Math.max(out[i]!, out[i + 1]! / maxRatio);
  return out.map((x, i) => (usable[i] ? x * judged[i]! : widths[i]!));
}

/** Whether any bar is short of its target. */
export function needsWidening(have: number[], want: number[]): boolean {
  return want.some((w, i) => w > have[i]! * (1 + TOLERANCE));
}

/**
 * The next width factor of each bar: scaled by how far it still is from its
 * target. A bar's width does not grow in proportion to its factor (the room
 * around the bar line stays the same), so this is corrected after measuring.
 * Given the factors and widths of the layout before, a bar that has been widened
 * once is aimed along the line through its two measurements instead: a bar of
 * rests is mostly that fixed room, and scaled again it stayed 5 % short (#75).
 */
export function nextFactors(
  factors: number[], have: number[], want: number[],
  before?: { factors: number[]; have: number[] },
): number[] {
  return factors.map((f, i) => {
    const w = want[i]!;
    const h = have[i]!;
    if (!(w > h * (1 + TOLERANCE) && h > 0)) return f;
    const f0 = before?.factors[i];
    const h0 = before?.have[i];
    if (f0 !== undefined && h0 !== undefined && f > f0 && h > h0) return f + ((w - h) * (f - f0)) / (h - h0);
    return f * (w / h);
  });
}

/** The biggest step in width per beat between neighbouring bars (bars with no width skipped). */
export function biggestStep(widths: number[], lengths: number[]): number {
  let step = 1;
  for (let i = 1; i < widths.length; i++) {
    const a = widths[i - 1]! / Math.max(lengths[i - 1]!, SHORTEST_COMPARED);
    const b = widths[i]! / Math.max(lengths[i]!, SHORTEST_COMPARED);
    if (!(a > 0 && b > 0 && lengths[i - 1]! > 0 && lengths[i]! > 0)) continue;
    step = Math.max(step, a / b, b / a);
  }
  return step;
}
