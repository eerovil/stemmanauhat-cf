import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { barAnchors, joinBars, xOnAnchors, type Anchor } from "./bar";

/** OSMD lays out in units of 10 px at zoom 1. */
const UNIT = 10;
/** About one notehead, in OSMD units. The cursor band is two of them, as in the videos. */
const NOTEHEAD = 1.3;

interface Sounding {
  /** Index of the part (MusicXML instrument) the note belongs to. */
  part: number;
  start: number;
  end: number;
  el: SVGGElement;
}

interface Bar {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** [beat in quarters, x], sorted by beat; the last one is the bar's end. */
  anchors: Anchor[];
  notes: Sounding[];
}

/**
 * The score drawn by OpenSheetMusicDisplay, and where each bar ended up on the
 * page, in pixels relative to the container, so a cursor can be drawn over it.
 */
export class Score {
  private readonly osmd: OpenSheetMusicDisplay;
  private bars: (Bar | undefined)[] = [];
  /**
   * The sounding notes, copied in their highlight colour onto a layer of their
   * own over the score. Colouring the notes in the score itself made the browser
   * paint the whole score again at every note, which a phone cannot always do
   * within one frame, so the sliding line hitched each time the marker stepped.
   */
  private readonly highlights = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private copies = new Map<Sounding, SVGGElement>();
  /** Each part's staff, top to bottom with room for notes above and lyrics below. */
  private spans = new Map<number, { top: number; bottom: number }>();
  private noteWidth = 0;

  constructor(private readonly container: HTMLElement) {
    this.highlights.classList.add("highlights");
    this.highlights.setAttribute("aria-hidden", "true");
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: "svg",
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawingParameters: "compacttight",
      // One graphical bar per bar in the file, so timing.json's indexes line up.
      autoGenerateMultipleRestMeasuresFromRestMeasures: false,
    });
  }

  async load(musicXml: string, visible?: boolean[]): Promise<void> {
    await this.osmd.load(musicXml);
    if (visible) this.applyVisible(visible);
    this.render();
  }

  /** Draws only the parts marked true (in MusicXML part order) and lays the score out again. */
  setVisible(visible: boolean[]): void {
    this.applyVisible(visible);
    // The graphical sheet is built from the visible parts, so build it again.
    this.osmd.updateGraphic();
    this.render();
  }

  private applyVisible(visible: boolean[]): void {
    this.osmd.Sheet.Instruments.forEach((instrument, i) => { instrument.Visible = visible[i] ?? true; });
  }

  /**
   * How long each bar really plays, in quarters, from timing.json (`barLengths`).
   * A bar it does not name falls back to its time signature.
   */
  barLengths = new Map<number, number>();

  /** The singer's own zoom, times the size that suits the screen. */
  zoom = 1;
  /** The size the last layout used for this screen width; OSMD's zoom is this times `zoom`. */
  baseZoom = 1;
  /** The whole score on one line that scrolls sideways, as in the videos. */
  singleLine = false;

  setSingleLine(on: boolean): void {
    this.singleLine = on;
    this.render();
  }

  /** How much the drawing is stretched past its last layout (zoom without laying out again). */
  private stretch = 1;
  private renderedZoom = 1;
  private relayout: number | undefined;

  /**
   * Zooms at once by resizing the drawn score; laying it out again takes about
   * half a second on a real song. The one-line view never needs that. Page lines
   * do, to re-wrap, so they are laid out again once the clicking stops.
   */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.stretch = zoom / this.renderedZoom;
    const svg = this.drawing();
    if (svg) {
      svg.style.width = `${Number(svg.getAttribute("width")) * this.stretch}px`;
      svg.style.height = `${Number(svg.getAttribute("height")) * this.stretch}px`;
    }
    this.version++;
    this.measure();
    window.clearTimeout(this.relayout);
    if (!this.singleLine) this.relayout = window.setTimeout(() => this.render(), 400);
  }

  /** Goes up on every layout, so anything measured from the last one knows to measure again. */
  version = 0;

  render(): void {
    window.clearTimeout(this.relayout);
    this.version++;
    this.stretch = 1;
    this.renderedZoom = this.zoom;
    this.osmd.setOptions({ renderSingleHorizontalStaffline: this.singleLine });
    this.baseZoom = window.innerWidth < 600 ? 0.6 : 0.8;
    this.osmd.Zoom = this.baseZoom * this.zoom;
    this.osmd.render();
    // OSMD may reuse the SVG element: drop any stretch a zoom left on it.
    const svg = this.drawing();
    if (svg) { svg.style.width = ""; svg.style.height = ""; }
    this.measure();
  }

  /** OSMD's drawing of the score (not the highlight layer). */
  private drawing(): SVGSVGElement | null {
    return this.container.querySelector("svg:not(.highlights)");
  }

  get barCount(): number {
    return this.bars.length;
  }

  /**
   * The video's beat marker: a translucent band two noteheads wide that steps to
   * each new note as it starts, rather than sliding between them.
   */
  marker(measure: number, beat: number): { x0: number; x1: number; top: number; bottom: number } | null {
    const bar = this.bars[measure];
    if (!bar) return null;
    const onsets = bar.anchors.slice(0, -1);
    let x = onsets[0]![1];
    for (const [b, ax] of onsets) if (b <= beat + 1e-6) x = ax;
    // OSMD places a staff entry at its notehead's centre.
    const centre = x;
    return { x0: centre - this.noteWidth, x1: centre + this.noteWidth, top: bar.top, bottom: bar.bottom };
  }

  /** Where a part's staff is, in container pixels (meaningful in the one-line view). */
  partSpan(part: number): { top: number; bottom: number } | null {
    return this.spans.get(part) ?? null;
  }

  /** The drawn score's width in pixels. */
  /** Measured with the layout, not on every call: reading it forces the browser to lay the page out. */
  private size = { width: 0, height: 0 };

  get width(): number {
    return this.size.width;
  }

  /** The drawn score's height in pixels. */
  get height(): number {
    return this.size.height;
  }

  /**
   * Where the music is, sliding smoothly between notes: what the one-line view
   * scrolls by, so the page moves evenly while the marker steps from note to note.
   */
  xAt(measure: number, beat: number): number | null {
    const bar = this.bars[measure];
    if (!bar) return null;
    return xOnAnchors(bar.anchors, beat);
  }

  /**
   * Colours the notes sounding at this bar and beat, as the videos do: your part's
   * notes full blue, everyone else's a lighter blue. Returns how many are lit.
   */
  light(measure: number | null, beat: number, focusPart: number): number {
    const bar = measure === null ? undefined : this.bars[measure];
    const now = bar ? bar.notes.filter((n) => n.start <= beat + 1e-6 && beat < n.end - 1e-6) : [];
    for (const [n, copy] of this.copies) {
      if (!now.includes(n)) { copy.remove(); this.copies.delete(n); }
    }
    for (const n of now) {
      let copy = this.copies.get(n);
      if (!copy) {
        copy = n.el.cloneNode(true) as SVGGElement;
        for (const el of [copy, ...copy.querySelectorAll("[id]")]) el.removeAttribute("id");
        this.highlights.appendChild(copy);
        this.copies.set(n, copy);
      }
      copy.classList.toggle("lit-focus", n.part === focusPart);
      copy.classList.toggle("lit-other", n.part !== focusPart);
    }
    return now.length;
  }

  /** The bar under a point in container pixels. */
  barAt(x: number, y: number): number | null {
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i];
      if (bar && x >= bar.x0 && x <= bar.x1 && y >= bar.top && y <= bar.bottom) return i;
    }
    return null;
  }

  /**
   * The note under a tap in the page view, in container pixels: the nearest note
   * of the bar tapped, or null off the staves. Lyrics just below count as the staff.
   */
  noteAt(x: number, y: number): { measure: number; beat: number } | null {
    let found: { measure: number; bar: Bar; distance: number } | null = null;
    this.bars.forEach((bar, measure) => {
      if (!bar || x < bar.x0 || x > bar.x1) return;
      const distance = y < bar.top ? bar.top - y : y > bar.bottom ? y - bar.bottom : 0;
      if (distance > bar.bottom - bar.top || (found && found.distance <= distance)) return;
      found = { measure, bar, distance };
    });
    if (!found) return null;
    const { measure, bar } = found as { measure: number; bar: Bar };
    let beat = bar.anchors[0]![0];
    let gap = Infinity;
    for (const [b, ax] of bar.anchors.slice(0, -1)) {
      if (Math.abs(ax - x) < gap) { gap = Math.abs(ax - x); beat = b; }
    }
    return { measure, beat };
  }

  private measure(): void {
    const svg = this.drawing();
    const box = this.container.getBoundingClientRect();
    const svgBox = svg?.getBoundingClientRect() ?? box;
    this.size = svg ? { width: svgBox.width, height: svgBox.height } : { width: 0, height: 0 };
    const dx = svgBox.left - box.left;
    const dy = svgBox.top - box.top;
    const scale = UNIT * this.osmd.Zoom * this.stretch;
    const px = (u: number, offset: number) => u * scale + offset;
    this.noteWidth = NOTEHEAD * scale;
    // The highlight layer lies exactly over the drawing, in the same units, and
    // starts empty after every layout. OSMD may clear the container: put it back.
    const layer = this.highlights;
    this.container.appendChild(layer);
    layer.replaceChildren();
    this.copies = new Map();
    layer.setAttribute("viewBox", svg?.getAttribute("viewBox")
      ?? `0 0 ${svg?.getAttribute("width") ?? 0} ${svg?.getAttribute("height") ?? 0}`);
    layer.style.width = `${svgBox.width}px`;
    layer.style.height = `${svgBox.height}px`;
    layer.style.transform = `translate(${dx}px, ${dy}px)`;
    this.spans = new Map();
    const instruments = this.osmd.Sheet.Instruments;

    this.bars = this.osmd.GraphicSheet.MeasureList.map((staves, index) => {
      // A hidden part's bars stay in the list, undrawn at position 0: skip them.
      const drawn = staves.filter((m) => m && m.PositionAndShape && m.ParentStaff.ParentInstrument.Visible);
      if (!drawn.length) return undefined;
      const first = drawn[0]!.PositionAndShape;
      const last = drawn[drawn.length - 1]!.PositionAndShape;
      const x0 = px(first.AbsolutePosition.x, dx);
      const x1 = px(first.AbsolutePosition.x + first.Size.width, dx);
      const length = this.barLengths.get(index) ?? (drawn[0]!.parentSourceMeasure?.Duration?.RealValue ?? 1) * 4;

      const byBeat = new Map<number, number>();
      const notes: Sounding[] = [];
      for (const m of drawn) {
        const part = instruments.indexOf(m.ParentStaff.ParentInstrument);
        const staffY = m.PositionAndShape.AbsolutePosition.y;
        const span = this.spans.get(part);
        const top = px(staffY - 3, dy);
        const bottom = px(staffY + 9, dy);
        this.spans.set(part, { top: Math.min(span?.top ?? top, top), bottom: Math.max(span?.bottom ?? bottom, bottom) });
        for (const entry of m.staffEntries) {
          const beat = entry.relInMeasureTimestamp.RealValue * 4;
          const x = px(entry.PositionAndShape.AbsolutePosition.x, dx);
          byBeat.set(beat, Math.min(byBeat.get(beat) ?? x, x));
          for (const voice of entry.graphicalVoiceEntries) {
            for (const note of voice.notes) {
              // Every VexFlow note can give its SVG group; the type only promises a GraphicalNote.
              const el = (note as unknown as { getSVGGElement?: () => SVGGElement | undefined })
                .getSVGGElement?.();
              if (!el) continue;
              notes.push({ part, start: beat, end: beat + note.sourceNote.Length.RealValue * 4, el });
            }
          }
        }
      }
      const anchors = barAnchors(byBeat, length, x0, x1);

      return {
        x0, x1,
        top: px(first.AbsolutePosition.y - 1.5, dy),
        bottom: px(last.AbsolutePosition.y + 5.5, dy),
        anchors,
        notes,
      };
    });
    joinBars(this.bars);
  }
}
