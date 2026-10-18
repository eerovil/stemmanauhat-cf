import { describe, expect, it } from "vitest";
import { wantsFilePlayback } from "../../src/client/player/file-player";
import { mixToWav } from "../../src/client/player/wav";

const parts = [Int16Array.from([1000, 2000]), Int16Array.from([100, 200])];
const effects = Int16Array.from([10, 30]);
const samples = (wav: ArrayBuffer) => [...new Int16Array(wav, 44)];

describe("mixToWav", () => {
  it("writes a 16-bit mono WAV header", () => {
    const wav = mixToWav({ sampleRate: 44100, parts, effects }, [1, 1], 1, 1);
    const view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(4);
  });

  it("adds each part at its gain, with the effects", () => {
    expect(samples(mixToWav({ sampleRate: 44100, parts, effects }, [1, 0.5], 1, 1))).toEqual([1060, 2130]);
  });

  it("adds each part's unison notes at its gain, left out where the steps say", () => {
    const unison = [new Int16Array(400).fill(1000), new Int16Array(400).fill(100)];
    const r = { sampleRate: 44100, parts: [new Int16Array(400), new Int16Array(400)], effects: new Int16Array(400), unison };
    const out = samples(mixToWav(r, [1, 0.5], 1, 1, [{ at: [100, 200, 300], gains: [1, 0, 1] }]));
    expect(out[150]).toBe(1050);
    // Sliding to nothing over 64 frames from frame 200, and back from 300.
    expect(out[232]).toBe(534);
    expect(out[280]).toBe(50);
    expect(out[399]).toBe(1050);
  });

  it("keeps every sample under the ceiling", () => {
    const out = samples(mixToWav({ sampleRate: 44100, parts: [Int16Array.from([20000, 10000])], effects: new Int16Array(2) }, [1], 4, 0.5));
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(16384);
  });

  it("turns down only around a loud burst, not the whole song", () => {
    // Two seconds of a quiet tone with a short burst 16 times louder in the middle.
    const rate = 22050;
    const tone = Int16Array.from({ length: 2 * rate }, (_, i) => Math.round(Math.sin(i / 10) * (i >= 11000 && i < 11100 ? 16000 : 1000)));
    const out = samples(mixToWav({ sampleRate: rate, parts: [tone], effects: new Int16Array(2 * rate) }, [1], 8, 0.5));
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(16384);
    // Away from the burst (150 ms release) the quiet tone keeps the whole boost (8 × 1000).
    const quiet = (from: number, to: number) => Math.max(...out.slice(from, to).map(Math.abs));
    expect(quiet(0, 10000)).toBeGreaterThan(7900);
    expect(quiet(rate, 2 * rate)).toBeGreaterThan(7900);
    // It is already turned down just before the burst (no click at its start).
    expect(quiet(10990, 11000)).toBeLessThan(6000);
  });
});

describe("wantsFilePlayback", () => {
  it("is Firefox on Android only", () => {
    expect(wantsFilePlayback("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0")).toBe(true);
    expect(wantsFilePlayback("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(false);
    expect(wantsFilePlayback("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe(false);
  });
});
