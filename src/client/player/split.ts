/**
 * Long bars cut into pieces of about one ordinary bar before drawing.
 *
 * Some songs write a free-rhythm verse as one huge bar under a hidden time
 * signature (#45: "Es ist ein Ros", a bar of 200 quarters). OSMD never breaks a
 * bar across lines, so it squeezed the whole verse into one line, notes and
 * lyrics on top of each other. Cut at points where no note sounds across and no
 * beam is open, joined by invisible bar lines, the verse wraps like any other.
 *
 * The pieces exist only in the drawing: timing.json, the bar numbers shown and
 * everything else keep the song's own bars, and `BarMap` translates.
 */

/** A bar at least this long, in quarters, is cut (no ordinary time signature is). */
export const LONG_BAR = 16;
/** About how long each piece is, in quarters: one bar of 4/4. */
export const PIECE = 4;

/** Rounds a position in quarters, so sums of divisions compare equal. */
const q = (x: number) => Math.round(x * 3840) / 3840;

/**
 * Where to cut a bar of `length` quarters: the start of each piece (the first is 0),
 * picking from `clean` the point nearest to `target` past the last cut each time.
 */
export function cutPoints(length: number, clean: number[], target = PIECE): number[] {
  const starts = [0];
  let s = 0;
  while (length - s > target * 1.5) {
    const want = s + target;
    let best: number | undefined;
    for (const p of clean) {
      if (p <= s + target / 2 || length - p < target / 2) continue;
      if (best === undefined || Math.abs(p - want) < Math.abs(best - want)) best = p;
    }
    if (best === undefined || best > s + target * 2) {
      // Nothing near: take the next clean point at all, or stop.
      const next = clean.filter((p) => p > s && length - p >= target / 2).sort((a, b) => a - b)[0];
      if (next === undefined) break;
      best = next;
    }
    starts.push(best);
    s = best;
  }
  return starts;
}

/**
 * Between the song's bars (timing.json's measure and beat) and the drawn pieces.
 * `starts[m]` is where each piece of bar m starts, in quarters; [0] for a bar not cut.
 */
export class BarMap {
  private readonly first: number[] = [];
  private readonly owner: { measure: number; start: number; end: number | null }[] = [];

  constructor(private readonly starts: number[][]) {
    starts.forEach((s, measure) => {
      this.first.push(this.owner.length);
      s.forEach((start, k) => this.owner.push({ measure, start, end: s[k + 1] ?? null }));
    });
  }

  get pieces(): number {
    return this.owner.length;
  }

  /** The drawn piece and the beat in it for a bar and beat of the song. */
  toPiece(measure: number, beat: number): { piece: number; beat: number } {
    const s = this.starts[measure];
    if (!s) return { piece: this.owner.length + measure - this.starts.length, beat };
    let k = 0;
    while (k + 1 < s.length && s[k + 1]! <= beat + 1e-6) k++;
    return { piece: this.first[measure]! + k, beat: beat - s[k]! };
  }

  /** The song's bar and beat for a drawn piece and a beat in it. */
  fromPiece(piece: number, beat: number): { measure: number; beat: number } {
    const o = this.owner[piece];
    if (!o) return { measure: piece - this.owner.length + this.starts.length, beat };
    return { measure: o.measure, beat: o.start + beat };
  }

  /** How long a piece plays, given how long its whole bar does (null: as drawn). */
  pieceLength(piece: number, barLength: number | null): number | null {
    const o = this.owner[piece];
    if (!o || (o.start === 0 && o.end === null)) return barLength;
    const end = o.end ?? barLength;
    return end === null ? null : Math.max(end - o.start, 0.001);
  }
}

interface Token {
  el: Element;
  /** Where it starts in the bar, in quarters. */
  start: number;
  /** For a note that moves time on: how long. Chord notes, grace notes and the rest: 0. */
  length: number;
  divisions: number;
  kind: "note" | "chord" | "move" | "left" | "right" | "other";
}

interface PartBar {
  measure: Element;
  tokens: Token[];
  /** The time signature in force when the bar starts. */
  time: Element | null;
}

const child = (el: Element, name: string) => [...el.children].find((c) => c.tagName === name) ?? null;
const text = (el: Element, name: string) => child(el, name)?.textContent?.trim() ?? null;

/** Reads one part's bars as timed tokens. */
function readPart(part: Element): PartBar[] {
  let divisions = 1;
  let time: Element | null = null;
  return [...part.children].filter((m) => m.tagName === "measure").map((measure) => {
    const startTime = time;
    const tokens: Token[] = [];
    let cursor = 0;
    let lastStart = 0;
    for (const el of measure.children) {
      const dur = Number(text(el, "duration") ?? 0) / divisions;
      if (el.tagName === "attributes") {
        const d = Number(text(el, "divisions"));
        if (d > 0) divisions = d;
        const t = child(el, "time");
        if (t) time = t;
        tokens.push({ el, start: q(cursor), length: 0, divisions, kind: "other" });
      } else if (el.tagName === "note") {
        const grace = !!child(el, "grace");
        if (child(el, "chord")) {
          tokens.push({ el, start: q(lastStart), length: 0, divisions, kind: "chord" });
        } else {
          lastStart = cursor;
          tokens.push({ el, start: q(cursor), length: grace ? 0 : q(dur), divisions, kind: "note" });
          if (!grace) cursor += dur;
        }
      } else if (el.tagName === "backup" || el.tagName === "forward") {
        cursor += el.tagName === "backup" ? -dur : dur;
        tokens.push({ el, start: q(cursor), length: 0, divisions, kind: "move" });
      } else if (el.tagName === "barline") {
        const location = el.getAttribute("location") ?? "right";
        tokens.push({ el, start: q(cursor), length: 0, divisions, kind: location === "left" ? "left" : location === "right" ? "right" : "other" });
      } else {
        tokens.push({ el, start: q(cursor), length: 0, divisions, kind: "other" });
      }
    }
    return { measure, tokens, time: startTime };
  });
}

/** Points inside the bar where every part could take a bar line. */
function cleanPoints(bars: PartBar[], length: number): number[] {
  const starts = new Set<number>();
  const blocked: [number, number][] = [];
  for (const { tokens } of bars) {
    const beams = new Map<string, number>();
    for (const t of tokens) {
      if (t.kind !== "note" && t.kind !== "chord") continue;
      if (t.length > 0) {
        starts.add(t.start);
        blocked.push([t.start, t.start + t.length]);
      }
      const beam = [...t.el.children].find((c) => c.tagName === "beam" && (c.getAttribute("number") ?? "1") === "1");
      const voice = text(t.el, "voice") ?? "1";
      const state = beam?.textContent?.trim();
      if (state === "begin") beams.set(voice, t.start);
      else if (state === "end" && beams.has(voice)) {
        blocked.push([beams.get(voice)!, t.start + 1e-6]);
        beams.delete(voice);
      }
    }
  }
  return [...starts]
    .filter((p) => p > 0 && p < length && !blocked.some(([a, b]) => a < p - 1e-6 && p < b - 1e-6))
    .sort((a, b) => a - b);
}

/** A hidden time signature `length` quarters long. */
function hiddenTime(doc: Document, length: number): Element {
  let beatType = 4;
  while (Math.abs(length * (beatType / 4) - Math.round(length * (beatType / 4))) > 1e-6 && beatType < 64) beatType *= 2;
  const time = doc.createElement("time");
  time.setAttribute("print-object", "no");
  const beats = doc.createElement("beats");
  beats.textContent = String(Math.round(length * (beatType / 4)));
  const type = doc.createElement("beat-type");
  type.textContent = String(beatType);
  time.appendChild(beats);
  time.appendChild(type);
  return time;
}

function move(doc: Document, kind: "backup" | "forward", quarters: number, divisions: number): Element {
  const el = doc.createElement(kind);
  const d = doc.createElement("duration");
  d.textContent = String(Math.round(quarters * divisions));
  el.appendChild(d);
  return el;
}

/** Puts `time` into an attributes element where MusicXML wants it: after divisions and key. */
function setTime(attributes: Element, time: Element): void {
  child(attributes, "time")?.remove();
  const after = [...attributes.children].filter((c) => c.tagName === "divisions" || c.tagName === "key").pop();
  attributes.insertBefore(time, after ? after.nextSibling : attributes.firstChild);
}

/**
 * Cuts the long bars of a MusicXML score (partwise, as MuseScore writes it).
 * Returns the score to draw and, for each of the song's bars, where its pieces start.
 */
export function splitLongBars(xml: string): { xml: string; starts: number[][] } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = [...doc.documentElement.children].filter((c) => c.tagName === "part");
  const read = parts.map(readPart);
  const count = Math.max(0, ...read.map((r) => r.length));
  const starts: number[][] = [];
  let changed = false;

  for (let m = 0; m < count; m++) {
    const bars = read.map((r) => r[m]).filter((b): b is PartBar => !!b);
    const length = Math.max(0, ...bars.flatMap((b) => b.tokens.map((t) => t.start + t.length)));
    const cuts = length >= LONG_BAR && bars.length === read.length ? cutPoints(length, cleanPoints(bars, length)) : [0];
    starts.push(cuts);
    if (cuts.length < 2) continue;
    changed = true;

    for (let p = 0; p < bars.length; p++) {
      const { measure, tokens, time } = bars[p]!;
      const divisions = tokens[0]?.divisions ?? 1;
      const pieces = cuts.map((start, k) => {
        const end = cuts[k + 1] ?? Infinity;
        const el = k === 0 ? measure : doc.createElement("measure");
        if (k > 0) {
          el.setAttribute("number", measure.getAttribute("number") ?? String(m + 1));
          el.setAttribute("implicit", "yes");
        }
        el.removeAttribute("width");
        return { el, start, end, out: [] as Element[], cursor: start, divisions };
      });
      let forced = time;
      for (const t of tokens) {
        if (t.kind === "move") continue;
        const piece = t.kind === "left" ? pieces[0]!
          : t.kind === "right" ? pieces[pieces.length - 1]!
          : pieces.find((x) => x.start <= t.start && t.start < x.end) ?? pieces[pieces.length - 1]!;
        if (t.el.tagName === "attributes") {
          const tm = child(t.el, "time");
          if (tm) { forced = tm; tm.remove(); }
        }
        if (t.kind !== "chord" && t.kind !== "left" && t.kind !== "right") {
          const target = Math.max(t.start, piece.start);
          if (target > piece.cursor + 1e-6) piece.out.push(move(doc, "forward", target - piece.cursor, t.divisions));
          if (target < piece.cursor - 1e-6) piece.out.push(move(doc, "backup", piece.cursor - target, t.divisions));
          piece.cursor = target + t.length;
        }
        piece.out.push(t.el);
      }
      measure.replaceChildren();
      pieces.forEach((piece, k) => {
        const pieceLength = (cuts[k + 1] ?? length) - piece.start;
        const first = piece.out[0];
        const attributes = first?.tagName === "attributes" && k === 0 ? first : doc.createElement("attributes");
        setTime(attributes, hiddenTime(doc, pieceLength));
        if (attributes !== first) piece.out.unshift(attributes);
        if (k < pieces.length - 1) {
          const barline = doc.createElement("barline");
          barline.setAttribute("location", "right");
          const style = doc.createElement("bar-style");
          style.textContent = "none";
          barline.appendChild(style);
          piece.out.push(barline);
        }
        piece.el.replaceChildren(...piece.out);
        if (k > 0) measure.parentNode!.insertBefore(piece.el, pieces[k - 1]!.el.nextSibling);
      });
      // The bar after goes on in the time signature the song had, unseen.
      const next = read[p]?.[m + 1]?.measure;
      if (next && forced) {
        const attributes = [...next.children].find((c) => c.tagName === "attributes");
        if (!attributes || !child(attributes, "time")) {
          const copy = forced.cloneNode(true) as Element;
          copy.setAttribute("print-object", "no");
          if (attributes) setTime(attributes, copy);
          else {
            const a = doc.createElement("attributes");
            a.appendChild(copy);
            next.insertBefore(a, next.firstChild);
          }
        }
      }
    }
  }
  return { xml: changed ? new XMLSerializer().serializeToString(doc) : xml, starts };
}
