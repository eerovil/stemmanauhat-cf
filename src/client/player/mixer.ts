/**
 * Plays every part's MP3 together, one <audio> element each, so the parts
 * stream instead of being decoded whole into memory (a low-end phone could not
 * hold eight decoded parts). Volumes go through Web Audio gain nodes, because
 * iPhones ignore an audio element's own volume. Your part is the clock; any
 * other part that drifts from it by more than DRIFT seconds, or stalls while
 * loading, makes all of them line up again and start together.
 */
const DRIFT = 0.05;

/**
 * Today's videos play the other parts at MuseScore volume 36 against 127. MIDI
 * volume is a squared curve, so the slider's position is that ratio and the
 * gain is its square: (36/127)^2 = 0.08, about -22 dB (an estimate, not a
 * measurement).
 *
 * The default slider position is a bit higher: Eero, testing real songs on
 * 2026-10-09, wanted the other parts louder. 0.4 is a gain of 0.16, about 6 dB up.
 */
export const DEFAULT_OTHERS = 0.4;

export function gainOf(level: number): number {
  return Math.max(0, Math.min(1, level)) ** 2;
}

/**
 * Each part's gain. Every part MP3 is rendered close to full scale (Finlandia's
 * peak at -0.3 dB), so any mix whose gains add up to more than 1 can go over
 * full scale where the parts peak together, and the browser clips it. Eero heard
 * that as crackling: at the default levels Finlandia's mix hit full scale 104
 * times. So the gains never add up to more than 1. The mix is then never louder
 * than the loudest single part, and the balance between parts is kept.
 */
export function mixLevels(count: number, master: number, others: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => (i === master ? 1 : gainOf(others)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const scale = sum > 1 ? 1 / sum : 1;
  return raw.map((g) => g * scale);
}

export class Mixer {
  readonly elements: HTMLAudioElement[];
  private context: AudioContext | null = null;
  private gains: GainNode[] = [];
  private master = 0;
  private others = DEFAULT_OTHERS;
  private driftTimer: number | undefined;
  /** What the singer asked for; the parts may briefly be paused to line up. */
  private wanted = false;
  /** Bumped by every alignment, so an older one that finishes late does nothing. */
  private generation = 0;
  private aligning = false;
  /** Parts whose file failed to load or play; the rest play on without them. */
  private broken = new Set<number>();
  /** Told when the set of broken parts changes. */
  onBroken: (parts: number[]) => void = () => {};

  constructor(urls: string[]) {
    this.elements = urls.map((url) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.preservesPitch = true;
      audio.src = url;
      audio.addEventListener("ended", () => { this.wanted = false; this.stopWatching(); });
      audio.addEventListener("error", () => this.markBroken(audio));
      return audio;
    });
  }

  /** The gain each part plays at, in part order. */
  levels(): number[] {
    return mixLevels(this.elements.length, this.master, this.others);
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

  /** Whether the singer has it playing (the play button's state). */
  get playing(): boolean {
    return this.wanted;
  }

  /** Whether sound is actually coming out right now. */
  get running(): boolean {
    return this.wanted && !this.aligning && !this.masterElement.paused;
  }


  time(): number {
    return this.masterElement.currentTime;
  }

  /**
   * Must be called straight from the singer's tap. iPhones let an audio element
   * (and the audio context) start only from a tap; once an element has been
   * started that way it may be paused and started again later. So every part is
   * started here, before anything is awaited, and the lining up comes after.
   */
  async play(): Promise<void> {
    this.ensureContext();
    const resumed = this.context?.resume();
    for (const el of this.elements) el.play().catch(() => undefined);
    this.wanted = true;
    await resumed;
    await this.align(this.time());
  }

  pause(): void {
    this.wanted = false;
    this.generation++;
    this.aligning = false;
    for (const el of this.elements) el.pause();
    this.stopWatching();
  }

  /** Moves every part to `seconds`, and if playing, starts them again together. */
  seek(seconds: number): void {
    const t = Math.max(0, seconds);
    if (this.wanted) {
      void this.align(t);
    } else {
      for (const el of this.elements) el.currentTime = t;
    }
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

  /** The part the clock is read from: yours, or the first working one if yours failed. */
  private get masterElement(): HTMLAudioElement {
    const mine = this.elements[this.master]!;
    if (!this.broken.has(this.master)) return mine;
    return this.elements.find((_, i) => !this.broken.has(i)) ?? mine;
  }

  private get working(): HTMLAudioElement[] {
    return this.elements.filter((_, i) => !this.broken.has(i));
  }

  /** Parts that failed, in part order. */
  brokenParts(): number[] {
    return [...this.broken].sort((a, b) => a - b);
  }

  /** Tries the failed parts again, from the current position. */
  retry(): void {
    const t = this.time();
    for (const i of this.broken) {
      const el = this.elements[i]!;
      el.load();
      el.currentTime = t;
    }
    this.broken.clear();
    this.onBroken([]);
    if (this.wanted) void this.align(t);
  }

  private markBroken(el: HTMLAudioElement): void {
    const i = this.elements.indexOf(el);
    if (i < 0 || this.broken.has(i)) return;
    this.broken.add(i);
    el.pause();
    this.onBroken(this.brokenParts());
  }

  /**
   * Lines the parts up: pause them all, put them all at `t`, wait until every one
   * has found its place and has sound to play, then start them together. Each
   * part is its own file, so starting them one by one, or seeking one alone while
   * the others play, is how they drift apart.
   */
  private async align(t: number): Promise<void> {
    const generation = ++this.generation;
    this.aligning = true;
    this.stopWatching();
    const parts = this.working;
    for (const el of parts) el.pause();
    for (const el of parts) el.currentTime = t;
    await Promise.all(parts.map(ready));
    if (generation !== this.generation) return;
    this.aligning = false;
    if (!this.wanted) return;
    // A part that has not loaded (or will not play) must not stop the others:
    // it is set aside and reported, and the rest play on.
    for (const el of parts) if (el.error || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) this.markBroken(el);
    await Promise.all(this.working.map((el) => el.play().catch(() => this.markBroken(el))));
    if (generation !== this.generation) return;
    this.driftTimer = window.setInterval(() => this.keepTogether(), 250);
  }

  private stopWatching(): void {
    window.clearInterval(this.driftTimer);
    this.driftTimer = undefined;
  }

  /** While playing: if a part stalls or wanders off, line them all up again. */
  private keepTogether(): void {
    if (!this.wanted || this.aligning) return;
    const t = this.time();
    const stalled = this.working.some((el) => el.paused || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
    const drifted = this.working.some((el) => Math.abs(el.currentTime - t) > DRIFT);
    if (stalled || drifted) void this.align(t);
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

/** Resolves once a part has finished seeking and has enough to play on (or after 3 s). */
function ready(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!el.seeking && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        done();
      }
    };
    const done = () => {
      window.clearTimeout(timer);
      el.removeEventListener("seeked", check);
      el.removeEventListener("canplay", check);
      resolve();
    };
    const timer = window.setTimeout(done, 3000);
    el.addEventListener("seeked", check);
    el.addEventListener("canplay", check);
    check();
  });
}
