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

export function nearest(times: number[], now: number): number | null {
  let best: number | null = null;
  for (const t of times) if (best === null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  return best;
}

/**
 * The stretch from the play-through of `startBar` nearest `now` to the end of
 * the first play-through of `endBar` after it. null when endBar never follows.
 */
export function loopRange(timing: Timing, startBar: number, endBar: number, now: number): [number, number] | null {
  const start = nearest(startsOf(timing, startBar), now);
  if (start === null) return null;
  const { points } = timing;
  let i = points.findIndex((p, j) => p[0] >= start && p[1] === endBar && startsPass(points, j));
  if (i < 0) return null;
  do i++; while (i < points.length && !startsPass(points, i));
  const end = i < points.length ? points[i]![0] : timing.duration;
  return end > start ? [start, end] : null;
}

/**
 * Where to jump back to, or null to keep playing. The range is worked out once
 * when the loop is set (or after a seek), not every frame: with a repeated
 * start bar the nearest play-through flips to the later one mid-loop, and a
 * range recomputed then would never wrap.
 */
export function loopTarget(range: [number, number] | null, seconds: number): number | null {
  return range && seconds >= range[1] - 0.02 ? range[0] : null;
}
