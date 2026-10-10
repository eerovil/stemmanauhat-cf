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
}

/**
 * Sums the parts at their gains with the effects, raises the whole by
 * `outputGain`, and scales it back down if its peak would pass `ceiling`: the
 * file's version of the Web Audio player's gain and limiter, without pumping.
 */
export function mixToWav(r: RenderedParts, gains: number[], outputGain: number, ceiling: number): ArrayBuffer {
  const frames = r.effects.length;
  const mixed = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    let v = r.effects[i]!;
    for (let p = 0; p < r.parts.length; p++) v += r.parts[p]![i]! * (gains[p] ?? 0);
    mixed[i] = v * outputGain;
    peak = Math.max(peak, Math.abs(mixed[i]!));
  }
  const scale = peak > ceiling * 32767 ? (ceiling * 32767) / peak : 1;
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
  for (let i = 0; i < frames; i++) samples[i] = Math.max(-32767, Math.min(32767, Math.round(mixed[i]! * scale)));
  return out;
}
