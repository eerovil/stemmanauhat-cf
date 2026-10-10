/**
 * timing.json from song-app (eerovil/musescore-choir-plugins docs/stemmanauhat-site.md):
 * points of [seconds, measure, beat]. Between two points that name the same bar
 * the position moves in a straight line; when the next point names another bar,
 * the cursor jumps there. Repeats are already written out in play order.
 */
export type Point = [seconds: number, measure: number, beat: number];

export interface Timing {
  version: 1;
  measures: number;
  duration: number;
  points: Point[];
}

export interface Position {
  measure: number;
  beat: number;
}

export function parseTiming(value: unknown): Timing {
  const v = value as Partial<Timing> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.points) || v.points.length === 0) {
    throw new Error("timing.json is not version 1");
  }
  for (const p of v.points) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === "number")) {
      throw new Error("timing.json has a bad point");
    }
  }
  return v as Timing;
}

/** Index of the last point at or before `seconds`, or -1 before the first. */
function lastAtOrBefore(points: Point[], seconds: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function positionAt(timing: Timing, seconds: number): Position {
  const { points } = timing;
  const i = Math.max(lastAtOrBefore(points, seconds), 0);
  const [t, measure, beat] = points[i]!;
  const next = points[i + 1];
  if (!next || next[1] !== measure || next[0] <= t || seconds <= t) return { measure, beat };
  const fraction = Math.min((seconds - t) / (next[0] - t), 1);
  return { measure, beat: beat + (next[2] - beat) * fraction };
}

/** Whether point i starts a new play-through of its bar. */
function startsPass(points: Point[], i: number): boolean {
  const previous = points[i - 1];
  const p = points[i]!;
  // A bar repeated straight after itself shows as its beat going back to the start.
  return !previous || previous[1] !== p[1] || p[2] < previous[2];
}

/** When each play-through of `measure` starts (a repeated bar has several). */
export function startsOf(timing: Timing, measure: number): number[] {
  return timing.points.flatMap((p, i) => (p[1] === measure && startsPass(timing.points, i) ? [p[0]] : []));
}

/**
 * How long each bar the timing names really plays, in quarters: the furthest beat
 * any point reaches in it, which is where the bar's end point sits. A pickup bar
 * of 3 beats in 4/4 comes out as 3.
 */
export function barLengths(timing: Timing): Map<number, number> {
  const lengths = new Map<number, number>();
  for (const [, measure, beat] of timing.points) lengths.set(measure, Math.max(lengths.get(measure) ?? 0, beat));
  for (const [measure, length] of lengths) if (length <= 0) lengths.delete(measure);
  return lengths;
}

/**
 * When the music reaches `beat` of `measure`, in the play-through nearest `near`
 * (a repeated bar has several): positionAt the other way round.
 */
export function timeOf(timing: Timing, measure: number, beat: number, near: number): number | null {
  const { points } = timing;
  let best: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i]![1] !== measure || !startsPass(points, i)) continue;
    let t = points[i]![0];
    for (let j = i; j + 1 < points.length && points[j + 1]![1] === measure && !startsPass(points, j + 1); j++) {
      const [t0, , b0] = points[j]!;
      const [t1, , b1] = points[j + 1]!;
      if (beat >= b1) { t = t1; continue; }
      if (beat > b0 && b1 > b0) t = t0 + ((beat - b0) / (b1 - b0)) * (t1 - t0);
      break;
    }
    if (best === null || Math.abs(t - near) < Math.abs(best - near)) best = t;
  }
  return best;
}

export function nearest(times: number[], now: number): number | null {
  let best: number | null = null;
  for (const t of times) if (best === null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  return best;
}
