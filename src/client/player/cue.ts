import type { UnisonNote } from "./unison";

/**
 * "Ilman omaa" gives the singer their starting pitch (eerovil/stemmanauhat-cf#94): on every
 * play, on a seek while playing and on choosing the mode while playing, the singer's own part
 * sounds its first note from there for the note's written length, then goes silent again. A note
 * already sounding where playback starts does not count (the piano cannot strike it again): the
 * next one that starts does. A tempo change does not give the note again.
 */
export interface Cue {
  /** Song seconds. */
  start: number;
  end: number;
}

/** Seconds: a note starting this little before the place still counts as starting there. */
const EPS = 0.01;
/** Seconds a note with no end (a missing note-off) is given. */
const NO_END = 1;

/** The part's first note starting at or after `from` (a chord's longest note), or null. */
export function cueNote(notes: UnisonNote[] | undefined, from: number): Cue | null {
  const first = notes?.find((n) => n.start >= from - EPS);
  if (!notes || !first) return null;
  const ends = notes.filter((n) => Math.abs(n.start - first.start) <= EPS)
    .map((n) => (Number.isFinite(n.end) ? n.end : n.start + NO_END));
  return { start: first.start, end: Math.max(...ends) };
}

/**
 * The sung part's silences (song frames, start and end pairs, in order) with everything but
 * [from, to) silenced too, up to `length`: the part sings only its starting note.
 */
export function onlyBetween(spans: number[], from: number, to: number, length: number): number[] {
  const out = from > 0 ? [0, from] : [];
  for (let k = 0; k < spans.length; k += 2) {
    const a = Math.max(from, spans[k]!);
    const b = Math.min(to, spans[k + 1]!);
    if (b > a) out.push(a, b);
  }
  if (to < length) out.push(to, length);
  return out;
}

/**
 * Keeps the singer's starting note on until it has played out. The player's own song clock can
 * lag a seek by a moment (the piano's sequencer confirms a new place later), so the note is timed
 * on the audio context's clock from where it was asked for, at the tempo, and a tempo change
 * folds in the time played so far.
 */
export class StartingNote {
  cue: Cue | null = null;
  /** Song seconds left until the note ends, as of `at` (the context's clock). */
  private left = 0;
  private at = 0;
  private rate = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `endShift` moves the end (song seconds): the piano goes quiet a little early, so its next
   * note never starts out loud; the sung part a little late, for the voice's release.
   */
  constructor(private readonly clock: () => number, private readonly changed: () => void,
    private readonly endShift = 0) {}

  get on(): boolean { return this.cue !== null; }

  /** Starts the part's starting note from song second `from` (none after the part's last note). */
  start(notes: UnisonNote[] | undefined, from: number): void {
    const was = this.on;
    this.clear();
    this.cue = cueNote(notes, from);
    if (!this.cue) { if (was) this.changed(); return; }
    this.left = this.cue.end + this.endShift - from;
    this.at = this.clock();
    this.wait();
    this.changed();
  }

  stop(): void {
    if (!this.cue) return;
    this.clear();
    this.cue = null;
    this.changed();
  }

  setRate(rate: number): void {
    if (this.cue) this.fold();
    this.rate = rate;
  }

  private fold(): void {
    const now = this.clock();
    this.left -= (now - this.at) * this.rate;
    this.at = now;
  }

  private wait(): void {
    this.fold();
    if (this.left <= 0) { this.timer = undefined; this.stop(); return; }
    // Checked again at least four times a second, so a tempo change is followed.
    this.timer = setTimeout(() => this.wait(), Math.min(250, (this.left / this.rate) * 1000));
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
