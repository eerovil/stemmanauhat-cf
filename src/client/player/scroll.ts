/**
 * The one-line view's scroll, made the way song-app makes the videos'
 * (scrollvideo/timing.py `smooth_scroll`): follow the notes, then average the
 * position over SMOOTH_SECONDS so the speed does not lurch with how tightly each
 * bar happens to be engraved. A jump bigger than JUMP_FRACTION of the screen is a
 * repeat or D.C., and the average never reaches across one.
 */
export const SMOOTH_SECONDS = 2;
export const JUMP_FRACTION = 0.25;
const STEP = 0.05;

export interface ScrollCurve {
  step: number;
  xs: number[];
}

/** `xAt` gives the note position at a time; `jump` is in the same pixels. */
export function buildCurve(duration: number, xAt: (seconds: number) => number, jump: number): ScrollCurve {
  const count = Math.max(2, Math.ceil(duration / STEP) + 1);
  const raw = Array.from({ length: count }, (_, i) => xAt(i * STEP));
  const half = Math.round(SMOOTH_SECONDS / 2 / STEP);
  // Segments between jumps, each smoothed on its own with a running sum.
  const xs: number[] = new Array(count);
  let start = 0;
  for (let i = 1; i <= count; i++) {
    if (i < count && Math.abs(raw[i]! - raw[i - 1]!) <= jump) continue;
    const prefix = [0];
    for (let j = start; j < i; j++) prefix.push(prefix[prefix.length - 1]! + raw[j]!);
    for (let j = start; j < i; j++) {
      const lo = Math.max(start, j - half);
      const hi = Math.min(i - 1, j + half);
      xs[j] = (prefix[hi - start + 1]! - prefix[lo - start]!) / (hi - lo + 1);
    }
    start = i;
  }
  return { step: STEP, xs };
}

export function curveAt(curve: ScrollCurve, seconds: number): number {
  const { xs, step } = curve;
  const f = Math.max(0, seconds / step);
  const i = Math.min(xs.length - 1, Math.floor(f));
  const next = xs[i + 1];
  if (next === undefined) return xs[i]!;
  const x = xs[i]!;
  // Across a jump the view lands on the far side rather than sliding through.
  return x + (next - x) * (f - i);
}

/**
 * The time at which the view shows `x`, found by walking the curve from `near`
 * (where playback is now) toward `x`. It stops at a repeat's jump, so dragging
 * moves through the music being played instead of leaping to another pass.
 */
export function timeAtX(curve: ScrollCurve, x: number, near: number): number {
  const { xs, step } = curve;
  const last = xs.length - 1;
  let i = Math.min(last, Math.max(0, Math.round(near / step)));
  const jump = (a: number, b: number) => xs[b]! < xs[a]!;
  if (x >= xs[i]!) {
    while (i < last && !jump(i, i + 1) && xs[i + 1]! <= x) i++;
    if (i < last && !jump(i, i + 1) && xs[i + 1]! > xs[i]!) {
      return (i + (x - xs[i]!) / (xs[i + 1]! - xs[i]!)) * step;
    }
  } else {
    while (i > 0 && !jump(i - 1, i) && xs[i - 1]! >= x) i--;
    if (i > 0 && !jump(i - 1, i) && xs[i]! > xs[i - 1]!) {
      return (i - 1 + (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!)) * step;
    }
  }
  return i * step;
}

/**
 * A clock that moves every frame. Browsers update an audio element's time in
 * coarse steps (a few times a second on some), which makes a scroll read from it
 * stutter. This runs on the frame clock and is pulled gently toward the audio,
 * snapping only after a seek.
 */
export class SmoothClock {
  private base = 0;
  private at = 0;
  private seen = -1;

  read(audioTime: number, playing: boolean, rate: number, now: number): number {
    if (!playing) {
      this.base = audioTime;
      this.at = now;
      this.seen = audioTime;
      return audioTime;
    }
    const estimate = this.base + ((now - this.at) / 1000) * rate;
    if (audioTime !== this.seen) {
      this.seen = audioTime;
      const error = audioTime - estimate;
      this.base = Math.abs(error) > 0.25 ? audioTime : estimate + error * 0.15;
      this.at = now;
      return this.base;
    }
    return estimate;
  }
}
