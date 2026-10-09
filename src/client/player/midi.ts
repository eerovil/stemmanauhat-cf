import { BasicMIDI } from "spessasynth_core";
import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { DEFAULT_OTHERS, mixLevels } from "./mix";

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
 * mix peaks at -18 to -22 dB. +15 dB brings it to about -3 to -7 dB. The limiter
 * after it catches the rare chord that would still go over.
 */
const OUTPUT_GAIN = 10 ** (15 / 20);

let soundfont: Promise<ArrayBuffer> | null = null;

/** Which MIDI channels each part plays on: by track name, else in track order. */
export function partChannels(midi: BasicMIDI, partNames: string[]): number[][] {
  const tracks = midi.tracks.filter((t) => t.channels.size > 0);
  const norm = (s: string) => s.trim().toLowerCase();
  return partNames.map((name, i) => {
    const track = tracks.find((t) => norm(t.name) === norm(name)) ?? tracks[i];
    return track ? [...track.channels] : [];
  });
}

export class MidiPlayer {
  onEnded: () => void = () => {};
  private master = 0;
  private others = DEFAULT_OTHERS;
  private wanted = false;
  /**
   * Where playback is while paused. The sequencer runs in the audio thread and
   * confirms a new position later, so reading it straight after a seek can give
   * the old one; while paused the position the singer chose is the truth.
   */
  private position = 0;
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(1024);

  private constructor(
    private readonly context: AudioContext,
    private readonly synth: WorkletSynthesizer,
    private readonly seq: Sequencer,
    private readonly channels: number[][],
  ) {
    seq.eventHandler.addEvent("songEnded", "stemmanauhat", () => {
      this.wanted = false;
      this.position = seq.duration;
      this.onEnded();
    });
    const gain = context.createGain();
    gain.gain.value = OUTPUT_GAIN;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
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
    log("Ladataan pianoa…");
    await synth.soundBankManager.addSoundBank(await soundfont, "piano");

    const channels = partChannels(BasicMIDI.fromArrayBuffer(midiBuffer.slice(0)), partNames);
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    const loaded = new Promise<void>((resolve) => seq.eventHandler.addEvent("songChange", "load", () => resolve()));
    seq.loadNewSongList([{ binary: midiBuffer, fileName: "score.mid" }]);
    await loaded;
    seq.pause();
    seq.currentTime = 0;
    return new MidiPlayer(context, synth, seq, channels);
  }

  levels(): number[] {
    return mixLevels(this.channels.length, this.master, this.others);
  }

  /** The gain each part's channels actually carry in the synth. */
  effectiveLevels(): number[] {
    return this.channels.map((chs, i) =>
      chs.length ? (this.synth.midiChannels[chs[0]!]?.systemParameters.gain ?? 0) : this.levels()[i]!);
  }

  setMaster(index: number): void { this.master = index; this.applyGains(); }
  setOthers(level: number): void { this.others = level; this.applyGains(); }
  get playing(): boolean { return this.wanted; }
  get running(): boolean { return this.wanted && !this.seq.paused; }
  time(): number { return this.running ? this.seq.currentHighResolutionTime : this.position; }

  /**
   * Must be called straight from the singer's tap: iPhones let an audio context
   * start only from one, so resume() is called before anything is awaited.
   */
  async play(): Promise<void> {
    const resumed = this.context.resume();
    this.wanted = true;
    this.seq.currentTime = this.position;
    this.seq.play();
    await resumed;
  }

  pause(): void {
    if (this.running) this.position = this.seq.currentHighResolutionTime;
    this.wanted = false;
    this.seq.pause();
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds);
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

  private applyGains(): void {
    const levels = this.levels();
    this.channels.forEach((chs, i) => {
      for (const ch of chs) this.synth.midiChannels[ch]?.setSystemParameter("gain", levels[i]!);
    });
  }
}
