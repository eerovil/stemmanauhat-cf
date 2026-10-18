/**
 * Mixing the separately rendered parts into one 16-bit mono WAV file, for the
 * audio-file player (file-player.ts). Mono, and at a low sample rate there,
 * because Firefox reads WAV in 768-byte pieces (dom/media/wave/WaveDemuxer.h)
 * and, while the page animates, fetches only about 60 of them a second: a
 * stereo 44.1 kHz file ran dry, a mono 22 kHz one keeps up. Kept apart so it
 * can be tested on its own.
 */
export interface RenderedParts {
  sampleRate: number;
  /** One mono track per part, full scale ±32767. */
  parts: Int16Array[];
  /** The synth's effects (reverb, chorus), mono. */
  effects: Int16Array;
  /** Each part's unison notes (unison.ts), rendered apart from `parts` so the mix can leave them out. */
  unison?: Int16Array[];
}

/** A part's gain over the file: `gains[k]` from frame `at[k]` on (before the first, `gains[0]`). */
export interface GainSteps {
  at: number[];
  gains: number[];
}

/** Frames over which a gain step slides, so it does not click. */
const SLIDE = 64;

/**
 * Sums the parts at their gains with the effects, raises the whole by
 * `outputGain`, and limits the peaks to `ceiling`: the file's version of the
 * Web Audio player's gain and limiter. Only the loud moments are turned down,
 * not the whole song, so the boost is heard in the file player too.
 */
export function mixToWav(r: RenderedParts, gains: number[], outputGain: number, ceiling: number,
  unisonGains: GainSteps[] = []): ArrayBuffer {
  const frames = r.effects.length;
  const mixed = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = r.effects[i]!;
    for (let p = 0; p < r.parts.length; p++) v += r.parts[p]![i]! * (gains[p] ?? 0);
    mixed[i] = v;
  }
  (r.unison ?? []).forEach((track, p) => {
    const steps = unisonGains[p] ?? { at: [], gains: [] };
    const level = gains[p] ?? 0;
    let g = (steps.gains[0] ?? 1) * level;
    let from = g;
    let to = g;
    let slid = SLIDE;
    let k = 0;
    for (let i = 0; i < frames; i++) {
      for (; k < steps.at.length && steps.at[k]! <= i; k++) {
        from = g;
        to = steps.gains[k]! * level;
        slid = 0;
      }
      g = slid < SLIDE ? from + (to - from) * (++slid / SLIDE) : to;
      mixed[i]! += track[i]! * g;
    }
  });
  for (let i = 0; i < frames; i++) mixed[i]! *= outputGain;
  limit(mixed, ceiling * 32767, r.sampleRate);
  const out = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(out);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, r.sampleRate, true);
  view.setUint32(28, r.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  const samples = new Int16Array(out, 44);
  for (let i = 0; i < frames; i++) samples[i] = Math.max(-32767, Math.min(32767, Math.round(mixed[i]!)));
  return out;
}

/**
 * Turns the samples down where they would pass `top`, like the Web Audio
 * player's limiter: 150 ms to recover after a peak, and since the whole file is
 * at hand, it starts turning down 2 ms before the peak instead of clicking.
 */
function limit(x: Float32Array, top: number, sampleRate: number): void {
  const g = new Float32Array(x.length);
  const release = Math.exp(-1 / (0.15 * sampleRate));
  let level = 1;
  for (let i = 0; i < x.length; i++) {
    level = Math.min(top / Math.max(1e-9, Math.abs(x[i]!)), 1 - (1 - level) * release);
    g[i] = level;
  }
  const step = 1 / Math.max(1, Math.round(0.002 * sampleRate));
  for (let i = x.length - 2; i >= 0; i--) g[i] = Math.min(g[i]!, g[i + 1]! + step);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * g[i]!;
}
