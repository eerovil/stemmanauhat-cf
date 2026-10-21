import { BasicMIDI } from "spessasynth_core";
import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { words } from "../i18n";
import { DEFAULT_OTHERS, mixLevels } from "./mix";
import { allowSilentMode } from "./session";
import { boosts, findNotes, silenced, withoutNotes, type Notes, type UnisonNote } from "./unison";

/**
 * The song's MIDI, played in the browser with MuseScore's own grand piano
 * (MuseScore_General, cut down to that one preset by
 * scripts/make-piano-soundfont.mjs). Eero chose this over the per-part MP3s on
 * 2026-10-09: one sequencer drives every part from one clock, so parts cannot
 * drift apart, seeking is exact, and tempo changes the speed, not the pitch.
 */
export const SOUNDFONT_URL = "/sound/piano-1.sf3";

/**
 * Measured on seven real songs rendered with this synth and piano: the default
 * mix peaks at -18 to -22 dB. +15 dB brought it to about -3 to -7 dB, which was
 * too quiet on a phone at full volume; Eero tried +15 to +27 dB on his phone
 * (eerovil/stemmanauhat-cf#53) and chose +27. The limiter after it holds the
 * loud chords under CEILING_DB.
 */
export const OUTPUT_GAIN = 10 ** (27 / 20);

/** The loudest the output may go, in dB below full scale. */
export const CEILING_DB = -1;

let soundfont: Promise<ArrayBuffer> | null = null;

/**
 * Which MIDI channels each part plays on: by track name first; a part whose name
 * matches no track takes the next track no other part has claimed, in order, so
 * two parts never share one track's channels.
 */
export function partChannels(midi: BasicMIDI, partNames: string[]): number[][] {
  const tracks = midi.tracks.filter((t) => t.channels.size > 0);
  const norm = (s: string) => s.trim().toLowerCase();
  const claimed = new Set<number>();
  const byName = partNames.map((name) => {
    const i = tracks.findIndex((t, j) => !claimed.has(j) && norm(t.name) === norm(name));
    if (i >= 0) claimed.add(i);
    return i;
  });
  const unclaimed = tracks.map((_, j) => j).filter((j) => !claimed.has(j));
  return byName.map((i) => {
    const track = tracks[i >= 0 ? i : unclaimed.shift() ?? -1];
    return track ? [...track.channels] : [];
  });
}

export class MidiPlayer {
  onEnded: () => void = () => {};
  private master = 0;
  private others = DEFAULT_OTHERS;
  private own = true;
  private wanted = false;
  /**
   * Where playback is while paused. The sequencer runs in the audio thread and
   * confirms a new position later, so reading it straight after a seek can give
   * the old one; while paused the position the singer chose is the truth.
   */
  private position = 0;
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(1024);
  /** The notes left out of the song now playing (unison.ts). */
  private gone = new Map<UnisonNote, UnisonNote>();
  /** The notes struck louder, for a unison more than two parts sing. */
  private louder = new Map<UnisonNote, number>();
  private reloads = Promise.resolve();
  /** While the song loads again: where it was and when (the context's clock). */
  private reloading: { from: number; at: number } | null = null;

  private constructor(
    private readonly context: AudioContext,
    private readonly synth: WorkletSynthesizer,
    private readonly seq: Sequencer,
    private readonly channels: number[][],
    private readonly midi: BasicMIDI,
    private readonly notes: Notes,
  ) {
    seq.eventHandler.addEvent("songEnded", "stemmanauhat", () => {
      this.wanted = false;
      this.position = seq.duration;
      this.onEnded();
    });
    const gain = context.createGain();
    gain.gain.value = OUTPUT_GAIN;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = CEILING_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    synth.connect(gain);
    gain.connect(limiter).connect(this.meter).connect(context.destination);
    this.applyGains();
  }

  /**
   * Loads the synth, the piano and the song. Done before the first tap: the
   * audio context may be created then (it waits, suspended, until a tap
   * resumes it in play()).
   */
  static async create(midiUrl: string, partNames: string[], log: (m: string) => void = () => {}): Promise<MidiPlayer> {
    allowSilentMode();
    const context = new AudioContext();
    soundfont ??= fetch(SOUNDFONT_URL).then((r) => {
      if (!r.ok) throw new Error(`piano: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    soundfont.catch(() => { soundfont = null; });
    const [midiBuffer] = await Promise.all([
      fetch(midiUrl).then((r) => {
        if (!r.ok) throw new Error(`MIDI: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      context.audioWorklet.addModule(processorUrl),
    ]);
    const synth = new WorkletSynthesizer(context);
    await synth.isReady;
    log(words().loadingPiano);
    // A copy each time: the synth hands the buffer to its worklet, which detaches it, and a
    // second piano on the same page (Ääni back from Laulu, the next song) would get nothing.
    await synth.soundBankManager.addSoundBank((await soundfont).slice(0), "piano");

    const midi = BasicMIDI.fromArrayBuffer(midiBuffer.slice(0));
    const channels = partChannels(midi, partNames);
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    await load(seq, { binary: midiBuffer, fileName: "score.mid" });
    seq.pause();
    seq.currentTime = 0;
    return new MidiPlayer(context, synth, seq, channels, midi, findNotes(midi, channels));
  }

  levels(): number[] {
    return mixLevels(this.channels.length, this.master, this.others, this.own);
  }

  /** The gain each part's channels actually carry in the synth. */
  effectiveLevels(): number[] {
    return this.channels.map((chs, i) =>
      chs.length ? (this.synth.midiChannels[chs[0]!]?.systemParameters.gain ?? 0) : this.levels()[i]!);
  }

  setMaster(index: number): void { this.master = index; this.applyGains(); this.applyUnisons(); }
  setOthers(level: number): void { this.others = level; this.applyGains(); }
  /** Whether your own part sounds ("Ilman omaa" turns it off). */
  setOwn(on: boolean): void { this.own = on; this.applyGains(); this.applyUnisons(); }
  get playing(): boolean { return this.wanted; }
  get running(): boolean { return this.wanted && !this.seq.paused; }
  time(): number {
    const r = this.reloading;
    if (r) return this.wanted ? r.from + (this.context.currentTime - r.at) * this.seq.playbackRate : r.from;
    return this.running ? this.seq.currentHighResolutionTime : this.position;
  }

  /**
   * Must be called straight from the singer's tap: iPhones let an audio context
   * start only from one, so resume() is called before anything is awaited.
   */
  async play(): Promise<void> {
    allowSilentMode();
    const resumed = this.context.resume();
    this.wanted = true;
    if (this.reloading) this.reloading = { from: this.position, at: this.context.currentTime };
    this.seq.currentTime = this.position;
    this.seq.play();
    await resumed;
  }

  pause(): void {
    if (this.wanted) this.position = this.time();
    if (this.reloading) this.reloading = { from: this.position, at: this.context.currentTime };
    this.wanted = false;
    this.seq.pause();
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds);
    if (this.reloading) this.reloading = { from: this.position, at: this.context.currentTime };
    this.seq.currentTime = this.position;
  }

  setRate(rate: number): void {
    this.seq.playbackRate = rate;
  }

  /** Whether sound is reaching the speakers right now (for tests and diagnostics). */
  sounding(): boolean {
    this.meter.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const v of this.samples) peak = Math.max(peak, Math.abs(v));
    return peak > 1e-4;
  }

  destroy(): void {
    this.seq.pause();
    this.synth.destroy();
    void this.context.close();
  }

  /**
   * Which part sings each unison depends on your part, so the song is loaded
   * again without the others' copies when that changes, at the same place.
   */
  private applyUnisons(): void {
    this.reloads = this.reloads.then(async () => {
      const gone = silenced(this.notes, this.master, this.own);
      const louder = boosts(this.notes, this.master, this.own);
      if (gone.size === this.gone.size && [...gone.keys()].every((n) => this.gone.has(n))
        && louder.size === this.louder.size && [...louder].every(([n, db]) => this.louder.get(n) === db)) return;
      this.gone = gone;
      this.louder = louder;
      this.reloading = { from: this.time(), at: this.context.currentTime };
      try {
        await load(this.seq, withoutNotes(this.midi, gone.keys(), this.notes, louder));
        const t = this.time();
        this.seq.currentTime = t;
        if (this.wanted) this.seq.play();
        else { this.seq.pause(); this.position = t; }
      } finally {
        this.reloading = null;
      }
    }).catch((error: unknown) => console.warn(`unisons not applied: ${String(error)}`));
  }

  private applyGains(): void {
    const levels = this.levels();
    this.channels.forEach((chs, i) => {
      for (const ch of chs) this.synth.midiChannels[ch]?.setSystemParameter("gain", levels[i]!);
    });
  }
}

function load(seq: Sequencer, song: BasicMIDI | { binary: ArrayBuffer; fileName: string }): Promise<void> {
  const loaded = new Promise<void>((resolve) => seq.eventHandler.addEvent("songChange", "load", () => resolve()));
  seq.loadNewSongList([song]);
  return loaded;
}
