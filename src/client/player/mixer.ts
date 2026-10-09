/**
 * Plays every part's MP3 together, one <audio> element each, so the parts
 * stream instead of being decoded whole into memory (a low-end phone could not
 * hold eight decoded parts). Volumes go through Web Audio gain nodes, because
 * iPhones ignore an audio element's own volume. Your part is the clock; any
 * other part that drifts from it by more than DRIFT seconds is put back.
 */
const DRIFT = 0.03;

/**
 * Today's videos play the other parts at MuseScore volume 36 against 127. MIDI
 * volume is a squared curve, so the slider's position is that ratio and the
 * gain is its square: (36/127)^2 = 0.08, about -22 dB.
 */
export const DEFAULT_OTHERS = 36 / 127;

export function gainOf(level: number): number {
  return Math.max(0, Math.min(1, level)) ** 2;
}

export class Mixer {
  readonly elements: HTMLAudioElement[];
  private context: AudioContext | null = null;
  private gains: GainNode[] = [];
  private master = 0;
  private others = DEFAULT_OTHERS;
  private driftTimer: number | undefined;

  constructor(urls: string[]) {
    this.elements = urls.map((url) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.preservesPitch = true;
      audio.src = url;
      return audio;
    });
  }

  /** The gain each part plays at, in part order. */
  levels(): number[] {
    return this.elements.map((_, i) => (i === this.master ? 1 : gainOf(this.others)));
  }

  /** What each part actually plays at: its gain node times its element's volume. */
  effectiveLevels(): number[] {
    return this.elements.map((el, i) => (this.gains[i]?.gain.value ?? 1) * el.volume);
  }

  setMaster(index: number): void {
    this.master = index;
    this.applyGains();
  }

  setOthers(level: number): void {
    this.others = level;
    this.applyGains();
  }

  get playing(): boolean {
    return !this.masterElement.paused;
  }

  time(): number {
    return this.masterElement.currentTime;
  }

  async play(): Promise<void> {
    this.ensureContext();
    await this.context?.resume();
    const t = this.time();
    for (const el of this.elements) if (Math.abs(el.currentTime - t) > DRIFT) el.currentTime = t;
    await Promise.all(this.elements.map((el) => el.play()));
    window.clearInterval(this.driftTimer);
    this.driftTimer = window.setInterval(() => this.keepTogether(), 250);
  }

  pause(): void {
    for (const el of this.elements) el.pause();
    window.clearInterval(this.driftTimer);
  }

  seek(seconds: number): void {
    const t = Math.max(0, seconds);
    for (const el of this.elements) el.currentTime = t;
  }

  setRate(rate: number): void {
    for (const el of this.elements) {
      el.preservesPitch = true;
      el.playbackRate = rate;
    }
  }

  destroy(): void {
    this.pause();
    for (const el of this.elements) el.removeAttribute("src");
    void this.context?.close();
  }

  private get masterElement(): HTMLAudioElement {
    return this.elements[this.master]!;
  }

  private keepTogether(): void {
    const t = this.time();
    for (const el of this.elements) {
      if (el === this.masterElement) continue;
      if (Math.abs(el.currentTime - t) > DRIFT) el.currentTime = t;
      if (el.paused && !this.masterElement.paused) void el.play();
    }
  }

  /** Created on the first tap on play: browsers allow audio only after one. */
  private ensureContext(): void {
    if (this.context || typeof AudioContext === "undefined") return;
    this.context = new AudioContext();
    const context = this.context;
    this.gains = this.elements.map((el) => {
      // The element's own volume was the stand-in until now; from here the gain
      // node is the only volume, or the two would multiply.
      el.volume = 1;
      const gain = context.createGain();
      context.createMediaElementSource(el).connect(gain).connect(context.destination);
      return gain;
    });
    this.applyGains();
  }

  private applyGains(): void {
    const levels = this.levels();
    if (this.gains.length) {
      this.gains.forEach((gain, i) => { gain.gain.value = levels[i]!; });
    } else {
      // No Web Audio yet (before the first play) or at all: element volume is
      // right everywhere but iPhones, and the gains take over once they exist.
      this.elements.forEach((el, i) => { el.volume = levels[i]!; });
    }
  }
}
