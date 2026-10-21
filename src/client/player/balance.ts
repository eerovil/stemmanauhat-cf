import { dbToGain, type Notes } from "./unison";

/**
 * The sung parts' balance by pitch (eerovil/stemmanauhat-cf#117): a low note
 * sounds weaker to the ear than a high one sung as strongly, so the basses
 * sounded thin next to the tenors and sopranos. Eero chose (2026-10-21): each
 * sung note is turned up OCTAVE_DB for each octave below middle C and down as
 * much for each octave above it, always, with no setting; the piano plays as
 * written.
 */
export const OCTAVE_DB = 3;

/** The MIDI key that plays as recorded. */
export const MIDDLE_C = 60;

/** How many dB a note of this key is turned up (below 0: down). */
export function pitchDb(key: number): number {
  return (OCTAVE_DB * (MIDDLE_C - key)) / 12;
}

/** Seconds a note is early, as the sung spans' lead, for the consonant before the beat. */
const LEAD = 0.05;
/** Seconds over which a part's gain moves from one note's to the next one's (12 ms). */
const RAMP = 0.012;
/** Seconds: notes closer than this start together. */
const EPS = 0.001;

/**
 * Each part's gain over the song as breakpoints [seconds, gain, seconds, gain,
 * …], in order; the gain runs straight between them and stays flat past the
 * first and the last. It moves to a note's gain from LEAD before the note, over
 * RAMP, and holds it to the part's next note, through the voice's release and
 * any rest. A chord within the part takes the mean of the notes sounding, again
 * from where one of them ends while others go on.
 */
export function pitchCurves(notes: Notes): number[][] {
  return notes.parts.map((list) => {
    const times = [...list.map((n) => ({ t: n.start, lead: LEAD })),
      ...list.filter((n) => Number.isFinite(n.end)).map((n) => ({ t: n.end, lead: 0 }))]
      .sort((a, b) => a.t - b.t);
    const curve: number[] = [];
    let gain: number | null = null;
    let last = -Infinity;
    for (const { t, lead } of times) {
      if (t < last + EPS) continue;
      const sounding = list.filter((m) => m.start < t + EPS && m.end > t + EPS);
      if (!sounding.length) continue;
      last = t;
      const db = sounding.reduce((a, m) => a + pitchDb(m.key), 0) / sounding.length;
      const g = dbToGain(db);
      if (g === gain) continue;
      const at = Math.max(0, t - lead, curve.length ? curve[curve.length - 2]! : 0);
      if (gain !== null) curve.push(at, gain);
      curve.push(gain === null ? at : at + RAMP, g);
      gain = g;
    }
    return curve;
  });
}
