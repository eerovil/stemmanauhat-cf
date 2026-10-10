import { BasicMIDI } from "spessasynth_core";
import { OUTPUT_GAIN, partChannels, SOUNDFONT_URL } from "./midi";
import { DEFAULT_OTHERS, mixLevels } from "./mix";
import type { FromWorker, ToWorker } from "./render-worker";

/**
 * Firefox on Android crackles through Web Audio on Eero's phone, whatever feeds
 * it: the synth's audio worklet, an empty worklet, even a finished buffer with
 * nothing else running. The same music as a plain audio file plays cleanly
 * (tested 2026-10-10 on eerovil/stemmanauhat-cf#3). There the song is rendered
 * in a worker with the same synth and piano, one track per part, mixed into a
 * WAV file and played by an <audio> element. A mix change re-mixes and swaps the
 * file at the same spot; a tempo change renders again (Eero did not want the
 * browser's own time-stretching).
 */
export function wantsFilePlayback(userAgent = navigator.userAgent): boolean {
  return /Android/.test(userAgent) && /Firefox\//.test(userAgent);
}

const SAMPLE_RATE = 44100;
/** The Web Audio player's limiter sits at -3 dB. */
const CEILING = 10 ** (-3 / 20);

export class FilePlayer {
  onEnded: () => void = () => {};
  private master = 0;
  private others = DEFAULT_OTHERS;
  private own = true;
  private wanted = false;
  /** The song position (not the file's) while paused or while a new file loads. */
  private position = 0;
  private rate = 1;
  /** The tempo the playing file was rendered at: file seconds × fileRate = song seconds. */
  private fileRate = 1;
  private swapping = false;
  private url: string | null = null;
  private requested = 0;
  private remix: number | undefined;
  private readonly audio = new Audio();

  private constructor(private readonly worker: Worker, private readonly count: number) {
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => {
      this.wanted = false;
      this.position = this.audio.duration * this.fileRate;
      this.onEnded();
    });
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
  }

  private progress: (fraction: number) => void = () => {};
  private firstFile: (() => void) | null = null;

  static async create(midiUrl: string, partNames: string[], log: (m: string) => void = () => {}): Promise<FilePlayer> {
    const [soundfont, midi] = await Promise.all([SOUNDFONT_URL, midiUrl].map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url === SOUNDFONT_URL ? "piano" : "MIDI"}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
    const channels = partChannels(BasicMIDI.fromArrayBuffer(midi!.slice(0)), partNames);
    const worker = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
    const player = new FilePlayer(worker, channels.length);
    player.progress = (f) => log(`Valmistellaan ääntä… ${Math.round(f * 100)} %`);
    const init: ToWorker = { type: "init", soundfont: soundfont!, midi: midi!, sampleRate: SAMPLE_RATE, partChannels: channels };
    worker.postMessage(init, [soundfont!, midi!]);
    log("Valmistellaan ääntä…");
    await new Promise<void>((resolve) => { player.firstFile = resolve; player.request(); });
    return player;
  }

  levels(): number[] {
    return mixLevels(this.count, this.master, this.others, this.own);
  }

  effectiveLevels(): number[] {
    return this.levels();
  }

  setMaster(index: number): void { this.master = index; this.mixLater(); }
  setOthers(level: number): void { this.others = level; this.mixLater(); }
  setOwn(on: boolean): void { this.own = on; this.mixLater(); }
  get playing(): boolean { return this.wanted; }
  get running(): boolean { return this.wanted && !this.swapping && !this.audio.paused; }

  time(): number {
    return this.running ? this.audio.currentTime * this.fileRate : this.position;
  }

  /** Must be called straight from the singer's tap, like the Web Audio player's. */
  async play(): Promise<void> {
    this.wanted = true;
    if (this.swapping) return;
    this.audio.currentTime = this.position / this.fileRate;
    await this.audio.play();
  }

  pause(): void {
    if (this.running) this.position = this.time();
    this.wanted = false;
    this.audio.pause();
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds);
    if (!this.swapping) this.audio.currentTime = this.position / this.fileRate;
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    this.request();
  }

  sounding(): boolean {
    return this.running;
  }

  destroy(): void {
    window.clearTimeout(this.remix);
    this.audio.pause();
    this.worker.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
  }

  /** Mix changes come in bursts (a slider): mix once they settle. */
  private mixLater(): void {
    window.clearTimeout(this.remix);
    this.remix = window.setTimeout(() => this.request(), 150);
  }

  private request(): void {
    const message: ToWorker = {
      type: "make", id: ++this.requested, rate: this.rate, gains: this.levels(), outputGain: OUTPUT_GAIN, ceiling: CEILING,
    };
    this.worker.postMessage(message);
  }

  private receive(m: FromWorker): void {
    if (m.type === "progress") { this.progress(m.fraction); return; }
    if (m.type === "error") throw new Error(m.message);
    // Only the newest request counts; an older file would undo a later change.
    if (m.id !== this.requested) return;
    void this.swap(m.wav, m.rate);
  }

  /** Puts the new file in at the song position the old one had reached. */
  private async swap(wav: ArrayBuffer, rate: number): Promise<void> {
    if (this.running) this.position = this.time();
    this.swapping = true;
    const old = this.url;
    this.url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    this.audio.src = this.url;
    await new Promise((resolve) => this.audio.addEventListener("loadedmetadata", resolve, { once: true }));
    this.fileRate = rate;
    this.audio.currentTime = this.position / rate;
    this.swapping = false;
    if (old) URL.revokeObjectURL(old);
    this.firstFile?.();
    this.firstFile = null;
    if (this.wanted) await this.audio.play();
  }
}
