import { describe, expect, it } from "vitest";
import { wantsFilePlayback } from "../../src/client/player/file-player";
import { mixToWav } from "../../src/client/player/wav";

const parts = [Int16Array.from([1000, 2000]), Int16Array.from([100, 200])];
const effects = Int16Array.from([10, 20, 30, 40]);
const samples = (wav: ArrayBuffer) => [...new Int16Array(wav, 44)];

describe("mixToWav", () => {
  it("writes a 16-bit stereo WAV header", () => {
    const wav = mixToWav({ sampleRate: 44100, parts, effects }, [1, 1], 1, 1);
    const view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(8);
  });

  it("adds each part at its gain to both sides, with the effects", () => {
    expect(samples(mixToWav({ sampleRate: 44100, parts, effects }, [1, 0.5], 1, 1))).toEqual([1060, 1070, 2130, 2140]);
  });

  it("scales the whole down when the boost would pass the ceiling", () => {
    const out = samples(mixToWav({ sampleRate: 44100, parts: [Int16Array.from([20000, 10000])], effects: new Int16Array(4) }, [1], 4, 0.5));
    expect(Math.max(...out)).toBe(16384);
    expect(out[2]).toBe(8192);
  });
});

describe("wantsFilePlayback", () => {
  it("is Firefox on Android only", () => {
    expect(wantsFilePlayback("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0")).toBe(true);
    expect(wantsFilePlayback("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(false);
    expect(wantsFilePlayback("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe(false);
  });
});
