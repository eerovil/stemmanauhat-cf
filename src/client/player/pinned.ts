import { columns, KINDS, stampAt, type Kind, type Stamp } from "./signature";

const SVG = "http://www.w3.org/2000/svg";
/** OSMD draws each sign in a group of its own, directly in the bar's group. */
const GROUP: Record<Kind, string> = { clef: "g.vf-clef", key: "g.vf-keysignature", time: "g.vf-timesignature" };
/** The line's own left margin: the pinned copy's staff lines start there while the line is new on screen. */
const MARGIN = 20;
/** Notes above the staff reach this far (drawing units) before the white cover begins: clear of tempo marks. */
const ABOVE_STAFF = 15;

interface Piece {
  el: SVGGElement;
  x: number;
  width: number;
}

interface Shown {
  svg: SVGSVGElement;
  /** In drawing units. */
  end: number;
  width: number;
}

/**
 * The clef, key and time signature in force, copied from the drawn score into a layer
 * of their own at the left edge of the one-line view (see signature.ts). It is built
 * once per layout from the bars that draw them, and afterwards only switches which
 * set shows. Nothing in it moves with the line: the host is placed by the player
 * (vertically like the line) and sits over the sliding score.
 */
export class PinnedSignature {
  private sets: Shown[] = [];
  private stamps: Stamp[] = [];
  /** `stamps` in pixels, as of the last `fit`. */
  private scaled: Stamp[] = [];
  /** Drawing units to pixels. */
  private k = 1;
  private shown = -1;
  private visible = false;
  private clip = "";
  private top = "";

  constructor(private readonly host: HTMLElement) {}

  /**
   * Copies the signs from the drawn `svg`. `bars` is how many bars the score has; a
   * score drawn some other way (a bar missing, a staff the DOM does not match) gets
   * no pinned signature.
   */
  build(svg: SVGSVGElement | null, bars: number): void {
    this.clear();
    if (!svg || !bars) return;
    const rows = [...svg.querySelectorAll<SVGGElement>(":scope > g.staffline")]
      .map((line) => [...line.querySelectorAll<SVGGElement>(":scope > g.vf-measure")]);
    if (!rows.length || rows.some((row) => row.length !== bars)) return;
    const [vbX = 0, vbY = 0, , vbH = 0] = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
    const lines = rows.map((row) => staffLines(row[0]!));
    if (lines.some((l) => !l.length)) return;
    const coverTop = Math.min(...lines.map((l) => l[0]!.y)) - ABOVE_STAFF;

    const current: Partial<Record<Kind, Piece>>[] = rows.map(() => ({}));
    // A clef change OSMD draws late in a bar (at its end) takes effect from the next bar.
    let pending: Sign[] = [];
    for (let bar = 0; bar < bars; bar++) {
      let end = 0;
      const next: Sign[] = [];
      const pieces: Sign[] = [...pending];
      rows.forEach((row, r) => {
        const found = signsOf(row[bar]!);
        pieces.push(...found.begin.map((sign) => ({ ...sign, row: r })));
        if (found.later) next.push({ ...found.later, row: r });
      });
      pending = next;
      for (const piece of pieces) {
        current[piece.row]![piece.kind] = piece;
        end = Math.max(end, piece.x + piece.width);
      }
      if (!pieces.length && bar > 0) continue;
      const set = this.draw(current, lines, { vbX, vbY, vbH, coverTop }, end);
      if (set) this.sets.push(set);
      else if (bar === 0) return;
    }
    this.stamps = this.sets.map((s) => ({ end: s.end, width: s.width }));
    this.host.replaceChildren(...this.sets.map((s) => s.svg));
  }

  /** One set of signs: every staff's staff lines and the signs now in force on them. */
  private draw(current: Partial<Record<Kind, Piece>>[], lines: StaffLine[][],
    box: { vbX: number; vbY: number; vbH: number; coverTop: number }, end: number): Shown | null {
    const widths = { clef: 0, key: 0, time: 0 };
    for (const row of current) for (const kind of KINDS) widths[kind] = Math.max(widths[kind], row[kind]?.width ?? 0);
    if (!KINDS.some((kind) => widths[kind] > 0)) return null;
    const { x, width } = columns(widths);
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `${box.vbX} ${box.vbY} ${width} ${box.vbH}`);
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("signature-set");
    svg.toggleAttribute("hidden", true);
    const cover = document.createElementNS(SVG, "rect");
    cover.setAttribute("x", String(box.vbX));
    cover.setAttribute("y", String(box.coverTop));
    cover.setAttribute("width", String(width));
    cover.setAttribute("height", String(box.vbY + box.vbH - box.coverTop));
    cover.setAttribute("fill", "#fff");
    svg.appendChild(cover);
    current.forEach((row, r) => {
      for (const line of lines[r]!) {
        const copy = line.el.cloneNode(false) as SVGPathElement;
        copy.removeAttribute("id");
        copy.setAttribute("d", `M${box.vbX} ${line.y}L${width} ${line.y}`);
        svg.appendChild(copy);
      }
      for (const kind of KINDS) {
        const piece = row[kind];
        if (!piece) continue;
        const copy = piece.el.cloneNode(true) as SVGGElement;
        for (const el of [copy, ...copy.querySelectorAll("[id]")]) el.removeAttribute("id");
        // Left-aligned in the kind's column.
        const g = document.createElementNS(SVG, "g");
        g.setAttribute("transform", `translate(${x[kind] - piece.x} 0)`);
        g.appendChild(copy);
        svg.appendChild(g);
      }
    });
    return { svg, end, width };
  }

  /** Sizes the sets for a drawing `k` pixels per unit and `height` pixels tall (a zoom changes both). */
  fit(k: number, height: number): void {
    this.k = k;
    this.scaled = this.stamps.map((s) => ({ end: s.end * k, width: s.width * k }));
    for (const set of this.sets) {
      set.svg.style.width = `${set.width * k}px`;
      set.svg.style.height = `${height}px`;
    }
  }

  /**
   * Shows the signs in force when the line is scrolled by `offset` pixels, moved down
   * by `vertical` as the line is. Hidden at the very start, where the line's own
   * signs are on screen, and when they would cover the note being sung: `playhead`
   * is where it sits, `reach` how far its marker spreads to the left of that.
   */
  show(offset: number, vertical: number, playhead: number, reach: number): void {
    const stamps = this.scaled;
    if (!stamps.length) return;
    const index = stampAt(stamps, offset);
    const fits = stamps[index]!.width <= playhead - reach;
    const on = offset > 0.5 && fits;
    if (on !== this.visible) {
      this.host.hidden = !on;
      this.visible = on;
    }
    if (!on) return;
    if (index !== this.shown) {
      if (this.shown >= 0) this.sets[this.shown]!.svg.toggleAttribute("hidden", true);
      this.sets[index]!.svg.toggleAttribute("hidden", false);
      this.shown = index;
      this.host.dataset.set = String(index);
      this.clip = "";
    }
    const top = `translateY(${-vertical}px)`;
    if (top !== this.top) { this.host.style.transform = top; this.top = top; }
    // While the line's own left margin is still on screen, the staff lines start where it does.
    const clip = `inset(0 0 0 ${Math.max(0, Math.round((MARGIN * this.k - offset) * 2) / 2)}px)`;
    if (clip !== this.clip) { this.sets[index]!.svg.style.clipPath = clip; this.clip = clip; }
  }

  clear(): void {
    this.sets = [];
    this.stamps = [];
    this.scaled = [];
    this.shown = -1;
    this.visible = false;
    this.clip = "";
    this.top = "";
    this.host.replaceChildren();
    this.host.hidden = true;
    delete this.host.dataset.set;
  }
}

interface StaffLine {
  el: SVGPathElement;
  y: number;
}

/** A bar's five staff lines: the full-width straight paths drawn first in its group. */
function staffLines(bar: SVGGElement): StaffLine[] {
  const out: StaffLine[] = [];
  for (const el of bar.querySelectorAll<SVGPathElement>(":scope > path")) {
    const box = el.getBBox();
    if (box.height === 0 && box.width > 0) out.push({ el, y: box.y });
  }
  return out;
}

/** A piece of a staff's signature and the staff (row) it belongs to. */
type Sign = Piece & { kind: Kind; row: number };

/**
 * The clef, key and time signature a bar draws at its start, and the clef it draws
 * later (a change at its end, which holds from the next bar), each without a row yet.
 */
function signsOf(bar: SVGGElement): { begin: Omit<Sign, "row">[]; later: Omit<Sign, "row"> | null } {
  const groups = bar.querySelectorAll<SVGGElement>(KINDS.map((kind) => `:scope > ${GROUP[kind]}`).join(", "));
  if (!groups.length) return { begin: [], later: null };
  const firstNote = bar.querySelector<SVGGElement>(":scope > g.vf-stavenote")?.getBBox().x ?? Infinity;
  const begin: Omit<Sign, "row">[] = [];
  let later: Omit<Sign, "row"> | null = null;
  for (const el of groups) {
    // OSMD also draws a clef it keeps invisible (fully transparent) at a bar's end in a staff whose clef did not change.
    if (invisible(el)) continue;
    const kind = KINDS.find((k) => el.matches(GROUP[k]))!;
    const box = el.getBBox();
    const piece = { kind, el, x: box.x, width: box.width };
    if (box.x + box.width <= firstNote) begin.push(piece);
    else if (kind === "clef") later = piece;
  }
  return { begin, later };
}

/** Whether every glyph of a sign is drawn transparent (a colour with an alpha of 00, as OSMD marks its hidden clefs). */
function invisible(sign: SVGGElement): boolean {
  const glyphs = [...sign.querySelectorAll("path")];
  return glyphs.length > 0 && glyphs.every((p) => /^#[0-9a-f]{6}00$/i.test(p.getAttribute("fill") ?? ""));
}
