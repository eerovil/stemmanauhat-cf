import type { ScrollCurve } from "./scroll";

/**
 * The one-line view's slide for Firefox on Android, as browser animations of
 * small elements. Two Firefox profiles from Eero's phone (2026-10-10,
 * eerovil/stemmanauhat-cf#3) showed why the line stuttered:
 * - Moved by script, or by one browser animation of the whole line (many
 *   screens wide), Firefox redrew the line on the page's thread every frame and
 *   re-rasterised the score's vector graphics, at 30–45 frames a second.
 * - Firefox runs a transform animation on its compositor only for an element
 *   not much bigger than the screen. Screen-sized picture pieces, each with its
 *   own animation, ran there, with nothing re-drawn per frame.
 *
 * So the score is cut once into bitmap pieces, each animated along the smoothed
 * scroll curve. The marker and the lit notes are small and sit in `movers`, a
 * size-less layer animated the same way. The drawn SVG stays in place, hidden,
 * for measuring. All the animations run on song time and are nudged back
 * together only when they drift from the music.
 */

/**
 * Keyframes for the curve: every other sample, and both sides of each jump (a
 * repeat). `x`, `y` place the moving element when the line is at the start.
 */
export function slideKeyframes(curve: ScrollCurve, shift: number, vertical: number, jump: number, x = 0, y = 0): Keyframe[] {
  const { xs } = curve;
  const last = xs.length - 1;
  const frame = (i: number): Keyframe => ({
    offset: last ? i / last : 0,
    transform: `translate3d(${x - Math.max(0, xs[i]! - shift)}px, ${y - vertical}px, 0)`,
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
/** At most this many device pixels per CSS pixel in the pieces: sharp enough, and half the memory of 3x. */
const MAX_DENSITY = 2;

export class SlidingPieces {
  /** The marker and the lit notes go in here (positioned as in the drawn score). */
  readonly movers = document.createElement("div");
  private readonly holder = document.createElement("div");
  private pieces: { x: number; el: HTMLCanvasElement }[] = [];
  /** Where the drawing and the movers sit in the box when the line is at its start. */
  private origin = { x: 0, y: 0 };
  private moversOrigin = { x: 0, y: 0 };
  private animations: Animation[] = [];
  private key = "";
  private built = -1;
  private building = -1;
  private hidden: SVGSVGElement | null = null;

  constructor(private readonly box: HTMLElement) {
    this.holder.className = "score-pieces";
    this.movers.className = "movers";
    box.style.position = "relative";
    box.appendChild(this.holder);
    box.appendChild(this.movers);
  }

  /** Whether the pieces for this layout are drawn and showing. */
  ready(version: number): boolean {
    return this.built === version;
  }

  /** Cuts the drawn score into pieces (once per layout, `version`); until then the caller moves the line itself. */
  build(version: number, svg: SVGSVGElement | null, wrap: HTMLElement): void {
    if (!svg || version === this.built || version === this.building) return;
    this.building = version;
    // Measured from layout, not from where the line may have been moved meanwhile.
    const drawn = svg.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    const moversOrigin = { x: wrap.offsetLeft, y: wrap.offsetTop };
    const origin = { x: moversOrigin.x + drawn.left - wrapBox.left, y: moversOrigin.y + drawn.top - wrapBox.top };
    const { width, height } = drawn;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = url;
    void image.decode().then(() => {
      URL.revokeObjectURL(url);
      if (this.building !== version) return;
      const density = Math.min(devicePixelRatio || 1, MAX_DENSITY);
      const tile = Math.max(200, Math.min(512, this.box.clientWidth));
      const k = image.naturalWidth / width;
      const pieces: { x: number; el: HTMLCanvasElement }[] = [];
      for (let x = 0; x < width; x += tile) {
        const w = Math.min(tile, width - x);
        const el = document.createElement("canvas");
        el.width = Math.ceil(w * density);
        el.height = Math.ceil(height * density);
        el.style.width = `${w}px`;
        el.style.height = `${height}px`;
        el.getContext("2d")!.drawImage(image, x * k, 0, w * k, image.naturalHeight, 0, 0, el.width, el.height);
        pieces.push({ x, el });
      }
      this.clearPieces();
      this.holder.replaceChildren(...pieces.map((p) => p.el));
      this.pieces = pieces;
      this.origin = origin;
      this.moversOrigin = moversOrigin;
      svg.style.visibility = "hidden";
      this.hidden = svg;
      this.built = version;
      this.key = "";
    }, () => URL.revokeObjectURL(url));
  }

  /**
   * Keeps everything at song time `t`: running with the music while it plays,
   * held (and moved with a drag) while it does not. `key` changes whenever the
   * curve, the playhead or the vertical position does.
   */
  follow(curve: ScrollCurve, key: string, shift: number, vertical: number, jump: number,
    t: number, running: boolean, rate: number): void {
    if (key !== this.key) {
      for (const a of this.animations) a.cancel();
      const duration = (curve.xs.length - 1) * curve.step * 1000;
      const animate = (el: Element, x: number, y: number) =>
        el.animate(slideKeyframes(curve, shift, vertical, jump, x, y), { duration, fill: "both" });
      this.animations = [
        ...this.pieces.map((p) => animate(p.el, this.origin.x + p.x, this.origin.y)),
        animate(this.movers, this.moversOrigin.x, this.moversOrigin.y),
      ];
      for (const a of this.animations) a.pause();
      this.key = key;
    }
    const lead = this.animations[0];
    if (!lead) return;
    const want = t * 1000;
    const at = Number(lead.currentTime ?? 0);
    const all = (f: (a: Animation) => void) => { for (const a of this.animations) f(a); };
    if (lead.playbackRate !== rate) all((a) => { a.playbackRate = rate; });
    if (running) {
      if (lead.playState !== "running") all((a) => { a.currentTime = want; a.play(); });
      else if (Math.abs(at - want) > DRIFT) all((a) => { a.currentTime = want; });
    } else {
      if (lead.playState === "running") all((a) => a.pause());
      if (Math.abs(at - want) > 0.5) all((a) => { a.currentTime = want; });
    }
  }

  /** Back to the drawn score (the page view, or before a new layout's pieces). */
  stop(): void {
    this.building = -1;
    this.built = -1;
    this.clearPieces();
    this.holder.replaceChildren();
    this.pieces = [];
  }

  destroy(): void {
    this.stop();
    this.holder.remove();
    this.movers.remove();
  }

  private clearPieces(): void {
    for (const a of this.animations) a.cancel();
    this.animations = [];
    this.key = "";
    if (this.hidden) this.hidden.style.visibility = "";
    this.hidden = null;
  }
}
