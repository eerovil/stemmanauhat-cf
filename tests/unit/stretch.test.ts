import { describe, expect, it } from "vitest";
import { GRAIN, PartStretcher } from "../../src/client/player/stretch";

const RATE = 44100;
const BLOCK = 128;

/** A tone of `hz` for `seconds`, peaking at `peak`. */
function tone(hz: number, seconds: number, peak = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = peak * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

/** Renders block by block until the song ends or `max` frames are out. */
function render(s: PartStretcher, max: number): Float32Array {
  const out = new Float32Array(max);
  const block = new Float32Array(BLOCK);
  let n = 0;
  while (n + BLOCK <= max && s.render(block)) { out.set(block, n); n += BLOCK; }
  return out.subarray(0, n);
}

/** The strongest frequency in `signal`, by a coarse search of the ones given. */
function pitchOf(signal: Float32Array, candidates: number[]): number {
  let best = 0;
  let bestPower = -1;
  for (const hz of candidates) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < signal.length; i++) {
      const a = (2 * Math.PI * hz * i) / RATE;
      re += signal[i]! * Math.cos(a);
      im += signal[i]! * Math.sin(a);
    }
    const power = re * re + im * im;
    if (power > bestPower) { bestPower = power; best = hz; }
  }
  return best;
}

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("PartStretcher", () => {
  it("at tempo 1 copies the parts' mix as it is", () => {
    const parts = [tone(220, 1), tone(330, 0.5)];
    const s = new PartStretcher(parts);
    s.setGains([0.8, 0.2]);
    s.start(1000);
    const out = render(s, 4096);
    for (let i = 128; i < 4096; i += 97) {
      expect(out[i]).toBeCloseTo(0.8 * parts[0]![1000 + i]! + 0.2 * parts[1]![1000 + i]!, 6);
    }
    expect(s.position()).toBe(1000 + 4096);
  });

  it("fades in after a start, so a jump into the middle of a wave does not click", () => {
    const s = new PartStretcher([tone(220, 1)]);
    s.setGains([1]);
    s.start(50);
    const out = render(s, 256);
    expect(Math.abs(out[0]!)).toBeLessThan(1e-6);
    expect(Math.abs(out[1]!)).toBeLessThan(Math.abs(out[100]!) + 1e-6);
  });

  it("stretches without changing the pitch, and the position runs at the tempo", () => {
    const parts = [tone(220, 2), tone(330, 2)];
    for (const rate of [0.5, 0.7, 1.2]) {
      const s = new PartStretcher(parts);
      s.setGains([1, 0]);
      s.rate = rate;
      s.start(0);
      const out = render(s, RATE);
      expect(out.length).toBe(Math.floor(RATE / BLOCK) * BLOCK);
      expect(s.position()).toBeCloseTo(out.length * rate, 3);
      expect(pitchOf(out.subarray(GRAIN * 2), [110, 165, 220, 330, 440])).toBe(220);
      // Grains overlap-add to one: the level stays, not louder and not pumping.
      expect(peak(out.subarray(GRAIN * 2))).toBeGreaterThan(0.45);
      expect(peak(out.subarray(GRAIN * 2))).toBeLessThan(0.56);
    }
  });

  it("keeps the parts together: at any tempo the mix of two tones is still both tones", () => {
    const s = new PartStretcher([tone(220, 2), tone(330, 2)]);
    s.setGains([0.5, 0.5]);
    s.rate = 0.6;
    s.start(0);
    const out = render(s, RATE).subarray(GRAIN * 2);
    expect(pitchOf(out, [220, 440])).toBe(220);
    expect(pitchOf(out, [330, 660])).toBe(330);
    expect(pitchOf(out, [275])).toBe(275); // a candidate alone always wins: just a sanity check of the helper
  });

  it("changes tempo from where it is, both ways across tempo 1", () => {
    const s = new PartStretcher([tone(220, 3)]);
    s.setGains([1]);
    s.start(0);
    render(s, 20480);
    expect(s.position()).toBe(20480);
    s.setRate(0.5);
    render(s, 40960);
    expect(s.position()).toBeCloseTo(20480 + 20480, 3);
    s.setRate(1);
    render(s, 1024);
    expect(s.position()).toBeCloseTo(40960 + 1024, 3);
    s.setRate(1.2);
    render(s, 1280);
    expect(s.position()).toBeCloseTo(40960 + 1024 + 1536, 3);
  });

  it("ends when the longest part has played out, at any tempo", () => {
    for (const rate of [1, 0.8]) {
      const s = new PartStretcher([tone(220, 0.1), tone(330, 0.3)]);
      s.setGains([1, 1]);
      s.rate = rate;
      s.start(0);
      const out = render(s, RATE);
      expect(s.playing).toBe(false);
      expect(out.length).toBeGreaterThanOrEqual(Math.floor(0.3 * RATE / rate / BLOCK) * BLOCK - BLOCK);
      expect(out.length).toBeLessThanOrEqual(0.3 * RATE / rate + BLOCK);
    }
  });

  it("pauses where it is and goes on from there", () => {
    const s = new PartStretcher([tone(220, 1)]);
    s.setGains([1]);
    s.start(0);
    render(s, 2048);
    s.pause();
    expect(s.playing).toBe(false);
    expect(s.position()).toBe(2048);
    const silent = new Float32Array(BLOCK);
    expect(s.render(silent)).toBe(true);
    expect(peak(silent)).toBe(0);
    s.start(s.position());
    render(s, 1024);
    expect(s.position()).toBe(3072);
  });

  it("leaves a part out of its silences, fading at their edges", () => {
    const parts = [tone(220, 1), tone(330, 1)];
    const s = new PartStretcher(parts);
    s.setGains([1, 1]);
    s.setSpans([[10000, 20000, 0]]);
    s.start(0);
    const out = render(s, 30000);
    // Fully out inside, only part 2 sounding there; untouched outside; between, a fade.
    for (const i of [11000, 15000, 19000]) expect(out[i]).toBeCloseTo(parts[1]![i]!, 6);
    for (const i of [5000, 25000]) expect(out[i]).toBeCloseTo(parts[0]![i]! + parts[1]![i]!, 6);
    expect(out[10256]).toBeCloseTo(0.5 * parts[0]![10256]! + parts[1]![10256]!, 3);
  });

  it("turns a part up over its louder spans, fading at their edges", () => {
    const parts = [tone(220, 1), tone(330, 1)];
    const s = new PartStretcher(parts);
    s.setGains([1, 1]);
    s.setSpans([[10000, 20000, 1.5]]);
    s.start(0);
    const out = render(s, 30000);
    for (const i of [11000, 15000, 19000]) expect(out[i]).toBeCloseTo(1.5 * parts[0]![i]! + parts[1]![i]!, 6);
    for (const i of [5000, 25000]) expect(out[i]).toBeCloseTo(parts[0]![i]! + parts[1]![i]!, 6);
    expect(out[10256]).toBeCloseTo(1.25 * parts[0]![10256]! + parts[1]![10256]!, 3);
  });

  it("follows a part's gain curve, straight between its points and flat past its ends", () => {
    const parts = [tone(220, 1), tone(330, 1)];
    const s = new PartStretcher(parts);
    s.setGains([1, 1]);
    s.setCurves([[10000, 2, 10100, 0.5]]);
    s.start(0);
    const out = render(s, 20000);
    expect(out[5000]).toBeCloseTo(2 * parts[0]![5000]! + parts[1]![5000]!, 6);
    expect(out[10050]).toBeCloseTo(1.25 * parts[0]![10050]! + parts[1]![10050]!, 6);
    expect(out[15000]).toBeCloseTo(0.5 * parts[0]![15000]! + parts[1]![15000]!, 6);
  });

  it("multiplies a gain curve with the unison spans", () => {
    const parts = [tone(220, 1)];
    const s = new PartStretcher(parts);
    s.setGains([1]);
    s.setCurves([[0, 2]]);
    s.setSpans([[10000, 20000, 1.5]]);
    s.start(0);
    const out = render(s, 30000);
    expect(out[15000]).toBeCloseTo(3 * parts[0]![15000]!, 6);
    expect(out[25000]).toBeCloseTo(2 * parts[0]![25000]!, 6);
  });
});
