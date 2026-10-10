/**
 * The one-line view's score as short pieces, only the ones on screen shown and
 * moved, for Firefox on Android. Sliding the whole drawn line (thousands of
 * pixels wide) made Firefox's audio stutter on Eero's phone, whatever drew it:
 * the live SVG, bitmap tiles moved together, native scrolling. A wide line of
 * sliding text did the same, while the same line moved piece by piece, only
 * the visible pieces shown, played cleanly (tested 2026-10-10 on
 * eerovil/stemmanauhat-cf#3).
 *
 * Each piece is a window onto one image of the score. The drawn SVG stays in
 * place, hidden, for measuring; the highlights and the marker still move with
 * it, and they are small.
 */
const TILE = 400;

interface Tile {
  x: number;
  el: HTMLDivElement;
  shown: boolean;
}

export class ScoreTiles {
  private readonly holder = document.createElement("div");
  private tiles: Tile[] = [];
  private origin = { x: 0, y: 0 };
  private width = 0;
  private url: string | null = null;
  private built = -1;
  private hidden: SVGSVGElement | null = null;
  private wrap: HTMLElement | null = null;

  constructor(private readonly viewport: HTMLElement) {
    this.holder.className = "score-tiles";
    viewport.style.position = "relative";
    viewport.appendChild(this.holder);
  }

  /** Cuts the score into pieces again whenever it is laid out again (`version`). */
  sync(version: number, svg: SVGSVGElement | null, wrap: HTMLElement): void {
    if (version === this.built || !svg) return;
    this.clear();
    this.built = version;
    const box = svg.getBoundingClientRect();
    const at = wrap.getBoundingClientRect();
    const origin = { x: box.left - at.left, y: box.top - at.top };
    const { width, height } = box;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = url;
    void image.decode().then(() => {
      // Laid out again while the image was decoding: that layout cuts its own pieces.
      if (version !== this.built) { URL.revokeObjectURL(url); return; }
      this.url = url;
      this.origin = origin;
      this.width = this.viewport.clientWidth;
      for (let x = 0; x < width; x += TILE) {
        const el = document.createElement("div");
        el.className = "score-tile";
        el.style.width = `${Math.min(TILE, width - x)}px`;
        el.style.height = `${height}px`;
        const img = image.cloneNode() as HTMLImageElement;
        img.style.cssText = `left:${-x}px;width:${width}px;height:${height}px`;
        el.appendChild(img);
        this.holder.appendChild(el);
        this.tiles.push({ x, el, shown: false });
      }
      svg.style.visibility = "hidden";
      wrap.style.background = "transparent";
      this.hidden = svg;
      this.wrap = wrap;
    }, () => URL.revokeObjectURL(url));
  }

  /** Shows the pieces on screen where the moving line would put them; hides the rest. */
  place(offset: number, vertical: number): void {
    for (const tile of this.tiles) {
      const left = this.origin.x + tile.x - offset;
      const on = left + TILE > 0 && left < this.width;
      if (on) tile.el.style.transform = `translate3d(${left}px, ${this.origin.y - vertical}px, 0)`;
      if (on !== tile.shown) {
        tile.el.style.display = on ? "block" : "none";
        tile.shown = on;
      }
    }
  }

  /** Back to the drawn score (the page view, or before a new layout's pieces). */
  clear(): void {
    this.built = -1;
    this.holder.replaceChildren();
    this.tiles = [];
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.hidden) this.hidden.style.visibility = "";
    if (this.wrap) this.wrap.style.background = "";
    this.hidden = null;
    this.wrap = null;
  }

  destroy(): void {
    this.clear();
    this.holder.remove();
  }
}
