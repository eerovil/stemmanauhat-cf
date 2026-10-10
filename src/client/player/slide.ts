import type { ScrollCurve } from "./scroll";

/**
 * The one-line view's slide as a Web Animation, for Firefox on Android. Moving
 * the line from script every frame made both the sound and the score stutter
 * on Eero's phone, however the line was drawn, while the same wide line moved
 * by a browser animation ran smoothly with clean sound (tested 2026-10-10 on
 * eerovil/stemmanauhat-cf#3): the browser then moves it by itself, without the
 * page's script in every frame.
 *
 * The animation is the smoothed scroll curve as keyframes, its time in song
 * seconds, and is only nudged back when it drifts from the music.
 */

/** Keyframes for the curve: every other sample, and both sides of each jump (a repeat). */
export function slideKeyframes(curve: ScrollCurve, shift: number, vertical: number, jump: number): Keyframe[] {
  const { xs } = curve;
  const last = xs.length - 1;
  const frame = (i: number): Keyframe => ({
    offset: last ? i / last : 0,
    transform: `translate3d(${-Math.max(0, xs[i]! - shift)}px, ${-vertical}px, 0)`,
  });
  const frames: Keyframe[] = [];
  for (let i = 0; i <= last; i++) {
    const jumpsNext = i < last && Math.abs(xs[i + 1]! - xs[i]!) > jump;
    const jumpedHere = i > 0 && Math.abs(xs[i]! - xs[i - 1]!) > jump;
    if (i % 2 === 0 || i === last || jumpsNext || jumpedHere) frames.push(frame(i));
  }
  return frames;
}

/** Allowed drift between the slide and the music before it is moved back, in ms. */
const DRIFT = 80;

export class CurveSlide {
  private animation: Animation | null = null;
  private key = "";

  constructor(private readonly el: HTMLElement) {}

  /**
   * Keeps the slide at song time `t`: running with the music while it plays,
   * held still (and moved with a drag) while it does not. `key` changes
   * whenever the curve, the playhead or the vertical position does.
   */
  follow(curve: ScrollCurve, key: string, shift: number, vertical: number, jump: number,
    t: number, running: boolean, rate: number): void {
    if (key !== this.key || !this.animation) {
      this.animation?.cancel();
      const seconds = (curve.xs.length - 1) * curve.step;
      this.animation = this.el.animate(slideKeyframes(curve, shift, vertical, jump), { duration: seconds * 1000, fill: "both" });
      this.animation.pause();
      this.key = key;
    }
    const a = this.animation;
    const want = t * 1000;
    if (a.playbackRate !== rate) a.playbackRate = rate;
    const at = Number(a.currentTime ?? 0);
    if (running) {
      if (a.playState !== "running") { a.currentTime = want; a.play(); }
      else if (Math.abs(at - want) > DRIFT) a.currentTime = want;
    } else {
      if (a.playState === "running") a.pause();
      if (Math.abs(at - want) > 0.5) a.currentTime = want;
    }
  }

  stop(): void {
    this.animation?.cancel();
    this.animation = null;
    this.key = "";
  }
}
