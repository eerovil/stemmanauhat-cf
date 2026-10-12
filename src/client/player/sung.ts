import { CEILING_DB } from "./midi";
import { DEFAULT_OTHERS, mixLevels } from "./mix";

/**
 * A song whose parts are sung recordings, one MP3 per part (a local test Eero
 * asked for on 2026-10-12; the live site plays score.mid). The per-part MP3s
 * were dropped on 2026-10-09 because <audio> elements drifted apart and the mix
 * clipped. Here neither can happen by design: every part is decoded into memory
 * on one AudioContext, and on play every part's source node is started at the
 * same context time, so one sample clock drives them all; and the parts' gains
 * never add up to more than 1, so the mix is never louder than one part at full
 * scale (the limiter after it is only a guard).
 */

/** Started this far ahead, so every part is scheduled before the first one is due. */
const LEAD = 0.03;

export class SungPlayer {
  onEnded: () => void = () => {};
  private master = 0;
  private others = DEFAULT_OTHERS;
  private own = true;
  private wanted = false;
  private rate = 1;
  /** The song position while paused, and the one play started from. */
  private position = 0;
  /** Context time the current sources were scheduled to start at. */
  private startedAt = 0;
  private sources: AudioBufferSourceNode[] = [];
  private readonly gains: GainNode[];
  private readonly sum: GainNode;
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(1024);
  readonly duration: number;

  private constructor(private readonly context: AudioContext, private readonly buffers: AudioBuffer[]) {
    this.duration = Math.max(0, ...buffers.map((b) => b.duration));
    this.sum = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = CEILING_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    this.gains = buffers.map(() => {
      const gain = context.createGain();
      gain.connect(this.sum);
      return gain;
    });
    this.sum.connect(limiter).connect(this.meter).connect(context.destination);
    this.applyGains();
  }

  /**
   * Fetches and decodes every part before the first tap. The context is made
   * here, suspended until play() resumes it from the tap (iPhones allow no other
   * way); the test passes a fake one.
   */
  static async create(urls: string[], log: (m: string) => void = () => {}, context: AudioContext = new AudioContext()): Promise<SungPlayer> {
    log("Ladataan stemmoja…");
    const buffers = await Promise.all(urls.map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return context.decodeAudioData(await r.arrayBuffer());
    }));
    return new SungPlayer(context, buffers);
  }

  levels(): number[] {
    return mixLevels(this.buffers.length, this.master, this.others, this.own);
  }

  /** The gain each part actually carries: its own node times the common scale. */
  effectiveLevels(): number[] {
    return this.gains.map((g) => g.gain.value * this.sum.gain.value);
  }

  setMaster(index: number): void { this.master = index; this.applyGains(); }
  setOthers(level: number): void { this.others = level; this.applyGains(); }
  setOwn(on: boolean): void { this.own = on; this.applyGains(); }
  get playing(): boolean { return this.wanted; }
  get running(): boolean { return this.wanted && this.sources.length > 0 && this.context.state === "running"; }

  /** Song seconds: the position play started from plus the context time since, at the tempo. */
  time(): number {
    if (!this.running) return this.position;
    return Math.min(this.duration, this.position + Math.max(0, this.context.currentTime - this.startedAt) * this.rate);
  }

  /** Must be called straight from the singer's tap, like the other players' play(). */
  async play(): Promise<void> {
    const resumed = this.context.resume();
    this.wanted = true;
    this.start(this.position);
    await resumed;
  }

  pause(): void {
    this.position = this.time();
    this.wanted = false;
    this.stop();
  }

  /** Every part stops and starts again together at the new place: no part can seek on its own. */
  seek(seconds: number): void {
    const t = Math.max(0, seconds);
    this.stop();
    this.position = t;
    if (this.wanted) this.start(t);
  }

  /** Speed and pitch together (a buffer's playbackRate does not keep the pitch). */
  setRate(rate: number): void {
    if (rate === this.rate) return;
    // Fold the time played so far into the position: the clock's slope changes here.
    this.position = this.time();
    this.startedAt = this.context.currentTime;
    this.rate = rate;
    for (const source of this.sources) source.playbackRate.value = rate;
  }

  /** Whether sound is reaching the speakers right now (for tests and diagnostics). */
  sounding(): boolean {
    this.meter.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const v of this.samples) peak = Math.max(peak, Math.abs(v));
    return peak > 1e-4;
  }

  destroy(): void {
    this.stop();
    void this.context.close();
  }

  /** One source per part, all told to start at the same context time. */
  private start(offset: number): void {
    const when = this.context.currentTime + LEAD;
    this.startedAt = when;
    this.position = offset;
    this.sources = this.buffers.map((buffer, i) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = this.rate;
      source.connect(this.gains[i]!);
      source.start(when, Math.min(offset, buffer.duration));
      return source;
    });
    // The longest part says when the song is over. A source stopped by us has
    // its handler taken off first, so only the end of the music reaches here.
    const longest = this.sources[this.buffers.findIndex((b) => b.duration === this.duration)];
    if (longest) longest.onended = () => {
      if (!this.sources.includes(longest)) return;
      this.sources = [];
      this.wanted = false;
      this.position = this.duration;
      this.onEnded();
    };
  }

  private stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* not started yet */ }
      source.disconnect();
    }
    this.sources = [];
  }

  /**
   * The parts' gains from the same rule as the piano's, scaled so they add up to
   * at most 1: a mix is then never louder than its loudest part alone, and these
   * parts peak at -6 dB, so the sum stays well under full scale.
   */
  private applyGains(): void {
    const levels = this.levels();
    const total = levels.reduce((a, b) => a + b, 0);
    this.sum.gain.value = total > 1 ? 1 / total : 1;
    this.gains.forEach((gain, i) => { gain.gain.value = levels[i]!; });
  }
}
