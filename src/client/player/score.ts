import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

/** OSMD lays out in units of 10 px at zoom 1. */
const UNIT = 10;

interface Bar {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** [beat in quarters, x], sorted by beat. */
  anchors: [number, number][];
}

/**
 * The score drawn by OpenSheetMusicDisplay, and where each bar ended up on the
 * page, in pixels relative to the container, so a cursor can be drawn over it.
 */
export class Score {
  private readonly osmd: OpenSheetMusicDisplay;
  private bars: (Bar | undefined)[] = [];

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

  async load(musicXml: string): Promise<void> {
    await this.osmd.load(musicXml);
    this.render();
  }

  render(): void {
    this.osmd.Zoom = this.container.clientWidth < 600 ? 0.6 : 0.8;
    this.osmd.render();
    this.measure();
  }

  get barCount(): number {
    return this.bars.length;
  }

  /** Where the cursor goes for a bar and beat, or null for a bar not drawn. */
  locate(measure: number, beat: number): { x: number; top: number; bottom: number } | null {
    const bar = this.bars[measure];
    if (!bar) return null;
    const a = bar.anchors;
    let x = a[a.length - 1]![1];
    for (let i = 0; i < a.length - 1; i++) {
      const [b0, x0] = a[i]!;
      const [b1, x1] = a[i + 1]!;
      if (beat <= b1) {
        x = b1 > b0 ? x0 + ((Math.max(beat, b0) - b0) / (b1 - b0)) * (x1 - x0) : x0;
        break;
      }
    }
    return { x, top: bar.top, bottom: bar.bottom };
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

    this.bars = this.osmd.GraphicSheet.MeasureList.map((staves) => {
      const drawn = staves.filter((m) => m && m.PositionAndShape);
      if (!drawn.length) return undefined;
      const first = drawn[0]!.PositionAndShape;
      const last = drawn[drawn.length - 1]!.PositionAndShape;
      const x0 = px(first.AbsolutePosition.x, dx);
      const x1 = px(first.AbsolutePosition.x + first.Size.width, dx);
      const length = (drawn[0]!.parentSourceMeasure?.Duration?.RealValue ?? 1) * 4;

      const byBeat = new Map<number, number>();
      for (const m of drawn) {
        for (const entry of m.staffEntries) {
          const beat = entry.relInMeasureTimestamp.RealValue * 4;
          const x = px(entry.PositionAndShape.AbsolutePosition.x, dx);
          byBeat.set(beat, Math.min(byBeat.get(beat) ?? x, x));
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
      };
    });
  }
}
