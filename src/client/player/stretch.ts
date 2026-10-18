/**
 * The sung parts mixed and played at a tempo, keeping the pitch: the heart of
 * the sung player's audio worklet (sung-worklet.ts), kept free of Web Audio so
 * it runs in a unit test. All parts share one read position, so whatever the
 * tempo they stay sample-locked; the gains are applied here as the parts are
 * read, so a mix change needs no new rendering.
 *
 * The stretch is WSOLA (waveform-similarity overlap-add): the output is built
 * from windowed grains of the input, each grain taken from near where the tempo
 * says it should come from, shifted a little (up to TOLERANCE) to where it
 * continues the previous grain's waveform best. Grains overlap by half with a
 * Hann window, which sums to one. At tempo 1.0 the input is copied as it is.
 */

/** A grain, in frames: 46 ms at 44.1 kHz, long enough for a bass note's period. */
export const GRAIN = 2048;
/** The output step between grains: half a grain, where the Hann window sums to one. */
const HOP = GRAIN / 2;
/** How far a grain may move from its nominal place to line up with the last one (12 ms at 44.1 kHz). */
const TOLERANCE = 512;
/** How much of the overlap the line-up compares. */
const COMPARE = 512;
/** Frames over which the sound fades in after a start or a jump, so no click. */
const FADE = 128;
/** Frames over which a part fades out of and back into a unison it is left out of (12 ms at 44.1 kHz). */
const QUIET_FADE = 512;
const NONE: number[] = [];

const WINDOW = new Float32Array(GRAIN);
for (let i = 0; i < GRAIN; i++) WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN);

export class PartStretcher {
  rate = 1;
  playing = false;
  /** The frames of the longest part: where the song ends. */
  readonly length: number;
  private gains: number[];
  /** Per part, where it is left out (unison.ts): song frames, [start, end] pairs in order. */
  private silences: number[][];
  /** Song frames at the last start, jump or tempo change, and output frames since: the position. */
  private base = 0;
  private emitted = 0;
  /** Where the next grain nominally comes from (song frames, fractional at a tempo). */
  private nominal = 0;
  /** Where the last grain came from; null when the next grain need not line up. */
  private lastGrain: number | null = null;
  /** Finished output waiting to go out, and the grains' overlapping tail. */
  private readonly fifo = new Float32Array(GRAIN * 2);
  private fifoStart = 0;
  private fifoEnd = 0;
  private readonly overlap = new Float32Array(GRAIN);
  private readonly grain = new Float32Array(GRAIN);
  private readonly candidate = new Float32Array(GRAIN + 2 * TOLERANCE);
  private readonly reference = new Float32Array(COMPARE);
  private fade = 0;

  constructor(private readonly parts: Float32Array[]) {
    this.length = Math.max(0, ...parts.map((p) => p.length));
    this.gains = parts.map(() => 0);
    this.silences = parts.map(() => []);
  }

  setGains(gains: number[]): void {
    this.gains = this.parts.map((_, i) => gains[i] ?? 0);
  }

  setSilences(silences: number[][]): void {
    this.silences = this.parts.map((_, i) => silences[i] ?? []);
  }

  /** The song position, in frames: where the sound going out now comes from. */
  position(): number {
    return Math.min(this.length, this.base + this.emitted * this.rate);
  }

  /** Starts (or jumps) at a song position, in frames. */
  start(frames: number): void {
    this.base = Math.max(0, Math.min(this.length, Math.round(frames)));
    this.emitted = 0;
    this.nominal = this.base;
    this.lastGrain = null;
    this.fifoStart = this.fifoEnd = 0;
    this.overlap.fill(0);
    this.fade = 0;
    this.playing = true;
  }

  pause(): void {
    this.base = this.position();
    this.emitted = 0;
    this.playing = false;
  }

  /**
   * A new tempo from the position reached. The grains already waiting to go out
   * were made at the old tempo (up to 23 ms of sound): the position reported
   * for them is off by that much at most, and the next grain lines up as usual.
   */
  setRate(rate: number): void {
    if (rate === this.rate) return;
    const was = this.rate === 1;
    this.base = this.position();
    this.emitted = 0;
    this.rate = rate;
    if (was || rate === 1) {
      // Between copying and stretching: start the grains from here, with a fade over the join.
      this.nominal = this.base;
      this.lastGrain = null;
      this.fifoStart = this.fifoEnd = 0;
      this.overlap.fill(0);
      this.fade = 0;
    }
  }

  /** Fills `out` with the mix; false once the song has played out (then the rest is silence). */
  render(out: Float32Array): boolean {
    out.fill(0);
    if (!this.playing) return true;
    if (this.position() >= this.length) {
      this.playing = false;
      return false;
    }
    if (this.rate === 1) {
      this.mix(this.base + this.emitted, out, 0, out.length, 1);
    } else {
      let filled = 0;
      while (filled < out.length) {
        if (this.fifoEnd === this.fifoStart) this.nextGrain();
        const n = Math.min(out.length - filled, this.fifoEnd - this.fifoStart);
        out.set(this.fifo.subarray(this.fifoStart, this.fifoStart + n), filled);
        this.fifoStart += n;
        filled += n;
      }
    }
    if (this.fade < FADE) {
      for (let i = 0; i < out.length && this.fade < FADE; i++, this.fade++) out[i]! *= this.fade / FADE;
    }
    this.emitted += out.length;
    return true;
  }

  /** The gains applied to the parts from `from` for `n` frames, added into `out` at `at`, times `scale`. */
  private mix(from: number, out: Float32Array, at: number, n: number, scale: number): void {
    const start = Math.round(from);
    for (let p = 0; p < this.parts.length; p++) {
      const gain = this.gains[p]! * scale;
      if (gain === 0) continue;
      const part = this.parts[p]!;
      const end = Math.min(n, part.length - start);
      const quiet = this.silencesIn(p, start, start + n);
      if (!quiet.length) {
        for (let i = Math.max(0, -start); i < end; i++) out[at + i]! += part[start + i]! * gain;
        continue;
      }
      for (let i = Math.max(0, -start); i < end; i++) {
        const f = start + i;
        let g = 1;
        for (let k = 0; k < quiet.length; k += 2) {
          const depth = Math.min(f - quiet[k]!, quiet[k + 1]! - f);
          if (depth > 0) g = Math.min(g, 1 - Math.min(1, depth / QUIET_FADE));
        }
        out[at + i]! += part[start + i]! * gain * g;
      }
    }
  }

  /** The part's silences that reach into frames [from, to). */
  private silencesIn(p: number, from: number, to: number): number[] {
    const s = this.silences[p]!;
    let lo = 0;
    let hi = s.length / 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[2 * mid + 1]! <= from) lo = mid + 1;
      else hi = mid;
    }
    if (2 * lo >= s.length || s[2 * lo]! >= to) return NONE;
    const found: number[] = [];
    for (let k = 2 * lo; k < s.length && s[k]! < to; k += 2) found.push(s[k]!, s[k + 1]!);
    return found;
  }

  /**
   * The next grain: from near `nominal`, moved by up to TOLERANCE to where it
   * best continues the last grain (the last grain's own continuation is the
   * reference). Overlap-added with the tail of the last one; the first half is
   * then finished and goes to the fifo.
   */
  private nextGrain(): void {
    let from = Math.round(this.nominal);
    if (this.lastGrain !== null) {
      const continuation = this.lastGrain + HOP;
      this.reference.fill(0);
      this.mix(continuation, this.reference, 0, COMPARE, 1);
      const lowest = Math.max(0, from - TOLERANCE);
      this.candidate.fill(0);
      this.mix(lowest, this.candidate, 0, this.candidate.length, 1);
      let best = from - lowest;
      let bestScore = -Infinity;
      // Every other offset first, then the neighbours of the best: a quarter of the work.
      const score = (offset: number) => {
        let dot = 0;
        let energy = 1e-9;
        for (let i = 0; i < COMPARE; i++) {
          const v = this.candidate[offset + i]!;
          dot += v * this.reference[i]!;
          energy += v * v;
        }
        return dot / Math.sqrt(energy);
      };
      for (let offset = 0; offset <= 2 * TOLERANCE; offset += 2) {
        const s = score(offset);
        if (s > bestScore) { bestScore = s; best = offset; }
      }
      for (const offset of [best - 1, best + 1]) {
        if (offset < 0 || offset > 2 * TOLERANCE) continue;
        const s = score(offset);
        if (s > bestScore) { bestScore = s; best = offset; }
      }
      from = lowest + best;
    }
    this.lastGrain = from;
    this.nominal += HOP * this.rate;
    this.grain.fill(0);
    this.mix(from, this.grain, 0, GRAIN, 1);
    for (let i = 0; i < GRAIN; i++) this.overlap[i]! += this.grain[i]! * WINDOW[i]!;
    // The first half is complete; the second half waits for the next grain.
    if (this.fifoEnd + HOP > this.fifo.length) {
      this.fifo.copyWithin(0, this.fifoStart, this.fifoEnd);
      this.fifoEnd -= this.fifoStart;
      this.fifoStart = 0;
    }
    this.fifo.set(this.overlap.subarray(0, HOP), this.fifoEnd);
    this.fifoEnd += HOP;
    this.overlap.copyWithin(0, HOP);
    this.overlap.fill(0, HOP);
  }
}
