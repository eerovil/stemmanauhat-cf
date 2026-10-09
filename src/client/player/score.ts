import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

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
  anchors: [number, number][];
  notes: Sounding[];
}

/**
 * The score drawn by OpenSheetMusicDisplay, and where each bar ended up on the
 * page, in pixels relative to the container, so a cursor can be drawn over it.
 */
export class Score {
  private readonly osmd: OpenSheetMusicDisplay;
  private bars: (Bar | undefined)[] = [];
  private lit: Sounding[] = [];
  private noteWidth = 0;

  constructor(private readonly container: HTMLElement) {
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

  /** The singer's own zoom, times the size that suits the screen. */
  zoom = 1;
  /** The whole score on one line that scrolls sideways, as in the videos. */
  singleLine = false;

  setSingleLine(on: boolean): void {
    this.singleLine = on;
    this.render();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.render();
  }

  /** Goes up on every layout, so anything measured from the last one knows to measure again. */
  version = 0;

  render(): void {
    this.version++;
    this.osmd.setOptions({ renderSingleHorizontalStaffline: this.singleLine });
    this.osmd.Zoom = (window.innerWidth < 600 ? 0.6 : 0.8) * this.zoom;
    this.osmd.render();
    this.measure();
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

  /**
   * Where the music is, sliding smoothly between notes: what the one-line view
   * scrolls by, so the page moves evenly while the marker steps from note to note.
   */
  xAt(measure: number, beat: number): number | null {
    const bar = this.bars[measure];
    if (!bar) return null;
    const a = bar.anchors;
    for (let i = 0; i < a.length - 1; i++) {
      const [b0, x0] = a[i]!;
      const [b1, x1] = a[i + 1]!;
      if (beat <= b1) return b1 > b0 ? x0 + ((Math.max(beat, b0) - b0) / (b1 - b0)) * (x1 - x0) : x0;
    }
    return a[a.length - 1]![1];
  }

  /**
   * Colours the notes sounding at this bar and beat, as the videos do: your part's
   * notes full blue, everyone else's a lighter blue. Returns how many are lit.
   */
  light(measure: number | null, beat: number, focusPart: number): number {
    const bar = measure === null ? undefined : this.bars[measure];
    const now = bar ? bar.notes.filter((n) => n.start <= beat + 1e-6 && beat < n.end - 1e-6) : [];
    for (const n of this.lit) if (!now.includes(n)) n.el.classList.remove("lit-focus", "lit-other");
    for (const n of now) {
      n.el.classList.toggle("lit-focus", n.part === focusPart);
      n.el.classList.toggle("lit-other", n.part !== focusPart);
    }
    this.lit = now;
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

  private measure(): void {
    const svg = this.container.querySelector("svg");
    const box = this.container.getBoundingClientRect();
    const svgBox = svg?.getBoundingClientRect() ?? box;
    const dx = svgBox.left - box.left;
    const dy = svgBox.top - box.top;
    const scale = UNIT * this.osmd.Zoom;
    const px = (u: number, offset: number) => u * scale + offset;
    this.noteWidth = NOTEHEAD * scale;
    this.lit = [];
    const instruments = this.osmd.Sheet.Instruments;

    this.bars = this.osmd.GraphicSheet.MeasureList.map((staves) => {
      // A hidden part's bars stay in the list, undrawn at position 0: skip them.
      const drawn = staves.filter((m) => m && m.PositionAndShape && m.ParentStaff.ParentInstrument.Visible);
      if (!drawn.length) return undefined;
      const first = drawn[0]!.PositionAndShape;
      const last = drawn[drawn.length - 1]!.PositionAndShape;
      const x0 = px(first.AbsolutePosition.x, dx);
      const x1 = px(first.AbsolutePosition.x + first.Size.width, dx);
      const length = (drawn[0]!.parentSourceMeasure?.Duration?.RealValue ?? 1) * 4;

      const byBeat = new Map<number, number>();
      const notes: Sounding[] = [];
      for (const m of drawn) {
        const part = instruments.indexOf(m.ParentStaff.ParentInstrument);
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
      const anchors = [...byBeat.entries()].sort((a, b) => a[0] - b[0]);
      if (!anchors.length || anchors[0]![0] > 0) anchors.unshift([0, anchors[0]?.[1] ?? x0 + 8]);
      const lastBeat = anchors[anchors.length - 1]![0];
      anchors.push([Math.max(length, lastBeat + 0.001), x1 - 2]);

      return {
        x0, x1,
        top: px(first.AbsolutePosition.y - 1.5, dy),
        bottom: px(last.AbsolutePosition.y + 5.5, dy),
        anchors,
        notes,
      };
    });
  }
}
