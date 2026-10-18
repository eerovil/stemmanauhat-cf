/**
 * The song rendered with the synth and piano, one track per part, for the
 * audio-file player (render-worker.ts runs it; kept apart so it runs in a test).
 */
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from "spessasynth_core";
import { unisonNotes, withoutNotes, type Notes, type UnisonNote } from "./unison";
import type { RenderedParts } from "./wav";

export interface Setup {
  soundfont: ArrayBuffer;
  sampleRate: number;
  partChannels: number[][];
}

/**
 * The song three times: without the unison notes; only them, so a mix can
 * leave out any part's copy of a unison without rendering again; and only
 * one copy of each, for their effects (reverb, chorus), which are one track
 * for all parts and so cannot be left out by part: a unison then rings as
 * one part's note does. `progress` gets 0 to 1.
 */
export async function renderParts(setup: Setup, song: BasicMIDI, notes: Notes, rate: number,
  progress: (fraction: number) => void = () => {}): Promise<RenderedParts> {
  const unison = unisonNotes(notes);
  const rest = new Set(notes.parts.flat().filter((n) => !unison.has(n)));
  const copies = new Set<UnisonNote>([...rest, ...notes.unisons.flatMap((u) => u.slice(1))]);
  // Two seconds past the last note, for the piano and the reverb to ring out.
  const frames = Math.ceil((song.duration / rate + 2) * setup.sampleRate);
  const step = (done: number) => (f: number) => progress((done + f) / 3);
  const apart = await renderSong(setup, withoutNotes(song, unison), rate, frames, step(0));
  // Every copy held as long as the longest, as the piano plays the one that is kept (unison.ts).
  const together = await renderSong(setup, withoutNotes(song, rest, notes), rate, frames, step(1));
  const once = await renderSong(setup, withoutNotes(song, copies, notes), rate, frames, step(2));
  const effects = apart.effects.map((v, i) => Math.max(-32767, Math.min(32767, v + once.effects[i]!)));
  return { sampleRate: setup.sampleRate, parts: apart.parts, effects, unison: together.parts };
}

/** One rendering of `frames` frames at the tempo `rate`. */
export async function renderSong(setup: Setup, song: BasicMIDI, rate: number, frames: number,
  progress: (fraction: number) => void = () => {}): Promise<RenderedParts> {
  const { soundfont, sampleRate, partChannels } = setup;
  const synth = new SpessaSynthProcessor(sampleRate, { effectsEnabled: true });
  await synth.processorInitialized;
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundfont), "piano");
  const seq = new SpessaSynthSequencer(synth);
  seq.skipToFirstNoteOn = false;
  seq.loadNewSongList([song]);
  seq.playbackRate = rate;
  seq.play();
  const parts = partChannels.map(() => new Int16Array(frames));
  const effects = new Int16Array(frames);
  const outs = Array.from({ length: 16 }, () => [new Float32Array(128), new Float32Array(128)]);
  const fxL = new Float32Array(128);
  const fxR = new Float32Array(128);
  const clip = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  for (let at = 0; at < frames; at += 128) {
    const n = Math.min(128, frames - at);
    for (const [l, r] of outs) { l!.fill(0); r!.fill(0); }
    fxL.fill(0);
    fxR.fill(0);
    seq.processTick();
    synth.processSplit(outs, fxL, fxR, 0, n);
    partChannels.forEach((channels, p) => {
      for (let k = 0; k < n; k++) {
        let v = 0;
        for (const c of channels) v += (outs[c]![0]![k]! + outs[c]![1]![k]!) / 2;
        parts[p]![at + k] = clip(v);
      }
    });
    for (let k = 0; k < n; k++) effects[at + k] = clip((fxL[k]! + fxR[k]!) / 2);
    if ((at / 128) % 2000 === 0) progress(at / frames);
  }
  return { sampleRate, parts, effects };
}
