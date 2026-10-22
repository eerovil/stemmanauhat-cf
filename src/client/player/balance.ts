import { dbToGain, type Notes } from "./unison";

/**
 * The sung parts' balance by pitch (eerovil/stemmanauhat-cf#117): a low note
 * sounds weaker to the ear than a high one sung as strongly, so the basses
 * sounded thin next to the tenors and sopranos. Eero chose (2026-10-22, by ear
 * on a prototype): each sung note is turned up OCTAVE_DB for each octave below
 * the middle of the moment (the mean key of every part's notes sounding then)
 * and down as much above it, so the lowest part sounding is the loudest and a
 * part singing alone stays as recorded. Säädöt › Lisäasetukset can change the
 * amount and the middle (middle C, or the whole song's mean); the piano plays
 * as written. Listening again with better headphones, Eero found the parts in
 * balance as recorded (2026-10-22): the amount starts at 0, off, and the
 * slider stays for whoever wants it.
 */
export const OCTAVE_DB = 0;

/** Middle C, the MIDI key that plays as recorded with the fixed middle. */
export const MIDDLE_C = 60;

/** How many dB a note of this key is turned up (below 0: down). */
export function pitchDb(key: number, octaveDb = OCTAVE_DB, pivot = MIDDLE_C): number {
  return (octaveDb * (pivot - key)) / 12;
}

/** Seconds a note is early, as the sung spans' lead, for the consonant before the beat. */
const LEAD = 0.05;
/** Seconds over which a part's gain moves from one note's to the next one's (12 ms). */
const RAMP = 0.012;
/** Seconds: notes closer than this start together. */
const EPS = 0.001;

/** The key that plays as recorded: a fixed key, the song's mean, or the moment's mean. */
export type Pivot = number | "song" | "moment";
export const DEFAULT_PIVOT: Pivot = "moment";

/** The song's middle: the mean key of every note, weighted by how long it sounds. */
export function songPivot(notes: Notes): number {
  let sum = 0;
  let time = 0;
  for (const n of notes.parts.flat()) {
    if (!Number.isFinite(n.end)) continue;
    sum += n.key * (n.end - n.start);
    time += n.end - n.start;
  }
  return time ? sum / time : MIDDLE_C;
}

/**
 * Each part's gain over the song as breakpoints [seconds, gain, seconds, gain,
 * …], in order; the gain runs straight between them and stays flat past the
 * first and the last. It moves to a note's gain from LEAD before the note, over
 * RAMP, and holds it to the part's next note, through the voice's release and
 * any rest. A chord within the part takes the mean of the notes sounding, again
 * from where one of them ends while others go on. With the moment's middle,
 * every part's notes starting or ending move it.
 */
export function pitchCurves(notes: Notes, octaveDb = OCTAVE_DB, pivot: Pivot = DEFAULT_PIVOT): number[][] {
  const fixed = pivot === "song" ? songPivot(notes) : pivot;
  // One pass through every note's start and end in time order (starts first at the same time),
  // keeping each part's and the whole song's sounding notes as a count and a sum of keys.
  const events: { t: number; start: boolean; part: number; key: number }[] = [];
  for (const n of notes.parts.flat()) {
    events.push({ t: n.start, start: true, part: n.part, key: n.key });
    if (Number.isFinite(n.end)) events.push({ t: n.end, start: false, part: n.part, key: n.key });
  }
  events.sort((a, b) => a.t - b.t || Number(b.start) - Number(a.start));
  const parts = notes.parts.length;
  const count = new Array<number>(parts).fill(0);
  const sum = new Array<number>(parts).fill(0);
  let allCount = 0;
  let allSum = 0;
  const curves: number[][] = notes.parts.map(() => []);
  const gains: (number | null)[] = notes.parts.map(() => null);
  for (let i = 0; i < events.length;) {
    // Everything within EPS of the first event happens together, at its time.
    const t = events[i]!.t;
    const first = events[i]!.start ? LEAD : 0;
    const leads = new Map<number, number>();
    for (; i < events.length && events[i]!.t < t + EPS; i++) {
      const e = events[i]!;
      if (!leads.has(e.part)) leads.set(e.part, e.start ? LEAD : 0);
      const d = e.start ? 1 : -1;
      count[e.part]! += d;
      sum[e.part]! += d * e.key;
      allCount += d;
      allSum += d * e.key;
    }
    // With the middle of the moment, every part's notes move every part's gain.
    const middle = pivot === "moment" ? allSum / Math.max(1, allCount) : (fixed as number);
    for (let p = 0; p < parts; p++) {
      const lead = pivot === "moment" ? first : leads.get(p);
      if (lead === undefined || count[p]! <= 0) continue;
      const g = dbToGain(pitchDb(sum[p]! / count[p]!, octaveDb, middle));
      const gain = gains[p]!;
      if (g === gain) continue;
      const curve = curves[p]!;
      const at = Math.max(0, t - lead, curve.length ? curve[curve.length - 2]! : 0);
      if (gain !== null) curve.push(at, gain);
      curve.push(gain === null ? at : at + RAMP, g);
      gains[p] = g;
    }
  }
  return curves;
}
