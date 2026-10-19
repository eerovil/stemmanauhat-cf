import { words } from "../i18n";
import { BasicMIDI } from "spessasynth_core";
import { CEILING_DB, partChannels } from "./midi";
import { onlyBetween, StartingNote } from "./cue";
import { DEFAULT_OTHERS, mixLevels } from "./mix";
import { allowSilentMode } from "./session";
import type { FromWorklet, ToWorklet } from "./sung-worklet";
import { findNotes, silenced, silentSpans, type Notes } from "./unison";
import workletUrl from "./sung-worklet?worker&url";

/**
 * The sung parts' boost before the limiter: the renders peak near −2 dB and sound
 * quieter than the piano, which gets +27 dB into the same limiter (Eero, 2026-10-13:
 * "make it a bit louder"). The limiter keeps the peaks under CEILING_DB.
 */
export const SUNG_GAIN = 10 ** (6 / 20);

/** Seconds the starting note's voice is let in before the note (its consonant) and after it (its release). */
const CUE_LEAD = 0.05;
const CUE_TAIL = 0.15;

/**
 * A song whose parts are sung recordings, one MP3 per part (a local test Eero
 * asked for on 2026-10-12; the live site plays score.mid). The per-part MP3s
 * were dropped on 2026-10-09 because <audio> elements drifted apart and the mix
 * clipped. Here neither can happen by design: every part is decoded on one
 * AudioContext and handed to one audio worklet (sung-worklet.ts), which reads
 * all of them at a single position, so one sample clock drives them all at any
 * tempo (stretched without changing the pitch, as the piano's tempo is); and
 * the parts' gains are scaled by their combined power, so a song with eight parts is
 * about as loud as one with two; then SUNG_GAIN lifts it and the limiter holds the peaks.
 */
export class SungPlayer {
  onEnded: () => void = () => {};
  /** The parts' gains changed by themselves (the starting note in "Ilman omaa", cue.ts). */
  onLevels: () => void = () => {};
  private master = 0;
  private others = DEFAULT_OTHERS;
  private own = true;
  private wanted = false;
  private rate = 1;
  /** The song position while paused. */
  private position = 0;
  /** The worklet's last reported position (song seconds) and the context time it was read at. */
  private reported = 0;
  private reportedAt = 0;
  private applied: number[] = [];
  private notes: Notes | null = null;
  private readonly count: number;
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(1024);
  private readonly starting: StartingNote;
  readonly duration: number;

  private constructor(private readonly context: AudioContext, private readonly node: AudioWorkletNode, buffers: AudioBuffer[]) {
    this.duration = Math.max(0, ...buffers.map((b) => b.duration));
    this.count = buffers.length;
    this.starting = new StartingNote(() => context.currentTime,
      () => { this.applyGains(); this.applyUnisons(); this.onLevels(); }, CUE_TAIL);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = CEILING_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    const boost = context.createGain();
    boost.gain.value = SUNG_GAIN;
    node.connect(boost).connect(limiter).connect(this.meter).connect(context.destination);
    node.port.onmessage = (event: MessageEvent<FromWorklet>) => this.receive(event.data);
    // The worklet gets each part's samples once (the decoded buffers are only
    // read here, so their channel data can be given away).
    const parts = buffers.map((b) => b.getChannelData(0));
    this.send({ type: "load", parts }, parts.map((p) => p.buffer));
    this.applyGains();
  }

  /**
   * Fetches and decodes every part before the first tap. The context is made
   * here, suspended until play() resumes it from the tap (iPhones allow no other
   * way); the test passes a fake one.
   */
  static async create(urls: string[], log: (m: string) => void = () => {}, given?: AudioContext): Promise<SungPlayer> {
    allowSilentMode();
    const context = given ?? new AudioContext();
    log(words().loadingParts);
    const [buffers] = await Promise.all([
      Promise.all(urls.map(async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return context.decodeAudioData(await r.arrayBuffer());
      })),
      context.audioWorklet.addModule(workletUrl),
    ]);
    const node = new AudioWorkletNode(context, "sung-parts", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    return new SungPlayer(context, node, buffers);
  }

  levels(): number[] {
    return mixLevels(this.count, this.master, this.others, this.own || this.starting.on);
  }

  /** The gain each part actually carries in the worklet. */
  effectiveLevels(): number[] {
    return [...this.applied];
  }

  setMaster(index: number): void { this.master = index; this.applyGains(); this.applyUnisons(); this.cue(this.time()); }
  setOthers(level: number): void { this.others = level; this.applyGains(); }
  /** Whether your own part sounds ("Ilman omaa" turns it off, but for the starting note). */
  setOwn(on: boolean): void { this.own = on; this.applyGains(); this.applyUnisons(); this.cue(this.time()); }

  /** The song's notes from its MIDI, to sing each unison once (unison.ts) and to find the starting note. */
  setUnisons(notes: Notes): void { this.notes = notes; this.applyUnisons(); }
  get playing(): boolean { return this.wanted; }
  get running(): boolean { return this.wanted && this.context.state === "running"; }

  /** Song seconds: the worklet's last word plus the context time since, at the tempo. */
  time(): number {
    if (!this.running) return this.position;
    return Math.min(this.duration, this.reported + Math.max(0, this.context.currentTime - this.reportedAt) * this.rate);
  }

  /** Must be called straight from the singer's tap, like the other players' play(). */
  async play(): Promise<void> {
    allowSilentMode();
    const resumed = this.context.resume();
    this.wanted = true;
    this.assume(this.position);
    this.send({ type: "play", frames: this.frames(this.position) });
    this.cue(this.position);
    await resumed;
  }

  pause(): void {
    this.position = this.time();
    this.wanted = false;
    this.send({ type: "pause" });
    this.starting.stop();
  }

  /** Every part moves together: the worklet has only one position. */
  seek(seconds: number): void {
    this.position = Math.max(0, Math.min(this.duration, seconds));
    this.assume(this.position);
    this.send({ type: "seek", frames: this.frames(this.position) });
    this.cue(this.position);
  }

  /** Speed without the pitch, as the piano's tempo (stretch.ts). */
  setRate(rate: number): void {
    if (rate === this.rate) return;
    // Fold the time played so far into the position: the clock's slope changes here.
    this.assume(this.time());
    this.starting.setRate(rate);
    this.rate = rate;
    this.send({ type: "rate", rate });
  }

  /** Whether sound is reaching the speakers right now (for tests and diagnostics). */
  sounding(): boolean {
    this.meter.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const v of this.samples) peak = Math.max(peak, Math.abs(v));
    return peak > 1e-4;
  }

  destroy(): void {
    this.starting.stop();
    this.send({ type: "pause" });
    this.node.disconnect();
    void this.context.close();
  }

  /** While playing in "Ilman omaa", your part's starting note from `from`; else none. */
  private cue(from: number): void {
    if (this.wanted && !this.own) this.starting.start(this.notes?.parts[this.master], from);
    else this.starting.stop();
  }

  private frames(seconds: number): number {
    return Math.round(seconds * this.context.sampleRate);
  }

  /** Until the worklet reports, the clock runs from here. */
  private assume(seconds: number): void {
    this.reported = seconds;
    this.reportedAt = this.context.currentTime;
  }

  private send(m: ToWorklet, transfer: Transferable[] = []): void {
    this.node.port.postMessage(m, transfer);
  }

  private receive(m: FromWorklet): void {
    if (m.type === "position") {
      // Only while running: a report from before a pause or a seek must not move the clock.
      if (!this.wanted || m.at < this.reportedAt) return;
      this.reported = m.frames / this.context.sampleRate;
      this.reportedAt = m.at;
    } else if (m.type === "ended") {
      if (!this.wanted) return;
      this.wanted = false;
      this.starting.stop();
      this.position = this.duration;
      this.onEnded();
    }
  }

  /**
   * The parts' gains from the same rule as the piano's, scaled so their squares add up
   * to at most 1. Singing voices add up by power, not by amplitude: scaling by the plain
   * sum (as before) made a song quieter the more parts it had, eight parts at 1/8 each
   * (Eero, "Lempilintu", eeron-omat-taskit#45). Where the parts sing in unison and add
   * up louder, the limiter holds the peaks.
   */
  /** The parts left out of each unison, as stretches of song frames for the worklet. */
  private applyUnisons(): void {
    if (!this.notes) return;
    const rate = this.context.sampleRate;
    const spans = silentSpans(this.notes, silenced(this.notes, this.master, this.own))
      .map((list) => list.flatMap(([a, b]) => [Math.round(a * rate), Math.round(b * rate)]));
    // The starting note in "Ilman omaa": your part sings only it, to the sample.
    const cue = this.starting.cue;
    if (cue) {
      spans[this.master] = onlyBetween(spans[this.master] ?? [], this.frames(Math.max(0, cue.start - CUE_LEAD)),
        this.frames(cue.end + CUE_TAIL), this.frames(this.duration));
    }
    this.send({ type: "silences", silences: spans });
  }

  private applyGains(): void {
    const levels = this.levels();
    const power = levels.reduce((a, b) => a + b * b, 0);
    const scale = power > 1 ? 1 / Math.sqrt(power) : 1;
    this.applied = levels.map((g) => g * scale);
    this.send({ type: "gains", gains: this.applied });
  }
}

/**
 * The song's notes from its MIDI file, for the sung player to sing each unison
 * once; null when they cannot be read (then the parts sing every note).
 */
export async function loadNotes(midiUrl: string, partNames: string[]): Promise<Notes | null> {
  try {
    const r = await fetch(midiUrl);
    if (!r.ok) throw new Error(`MIDI: HTTP ${r.status}`);
    const midi = BasicMIDI.fromArrayBuffer(await r.arrayBuffer());
    return findNotes(midi, partChannels(midi, partNames));
  } catch (error) {
    console.warn(`unisons not found: ${String(error)}`);
    return null;
  }
}
