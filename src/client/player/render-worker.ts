/// <reference lib="webworker" />
/**
 * Renders the song in this worker, one track per part, for the audio-file
 * player (file-player.ts), and mixes them into a WAV file on request. The parts
 * stay here so a mix change only re-mixes; a tempo change renders again.
 */
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from "spessasynth_core";
import { findNotes, silenced, unisonNotes, unisonSteps, withoutNotes, type Notes } from "./unison";
import { mixToWav, type RenderedParts } from "./wav";

export type ToWorker =
  | { type: "init"; soundfont: ArrayBuffer; midi: ArrayBuffer; sampleRate: number; partChannels: number[][] }
  | { type: "render"; rate: number }
  | { type: "make"; id: number; rate: number; gains: number[]; outputGain: number; ceiling: number; master: number; own: boolean };

export type FromWorker =
  | { type: "progress"; fraction: number }
  | { type: "rendered" }
  | { type: "wav"; id: number; wav: ArrayBuffer; rate: number }
  | { type: "error"; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let setup: Extract<ToWorker, { type: "init" }> | null = null;
let rendered: { rate: number; parts: RenderedParts } | null = null;
let notes: Notes | null = null;
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

/**
 * The song twice: without the unison notes, and only them (unison.ts), so a mix
 * can leave out any part's copy of a unison without rendering again.
 */
async function render(rate: number): Promise<RenderedParts> {
  const { midi, partChannels } = setup!;
  const song = BasicMIDI.fromArrayBuffer(midi.slice(0));
  notes ??= findNotes(song, partChannels);
  const unison = unisonNotes(notes);
  const rest = new Set(notes.parts.flat().filter((n) => !unison.has(n)));
  // Two seconds past the last note, for the piano and the reverb to ring out.
  const frames = Math.ceil((song.duration / rate + 2) * setup!.sampleRate);
  const apart = await renderSong(withoutNotes(song, unison), rate, frames, 0);
  const together = await renderSong(withoutNotes(song, rest), rate, frames, 0.5);
  const effects = apart.effects.map((v, i) => Math.max(-32767, Math.min(32767, v + together.effects[i]!)));
  return { sampleRate: apart.sampleRate, parts: apart.parts, effects, unison: together.parts };
}

/** One rendering, reported as the half of the progress from `done`. */
async function renderSong(song: BasicMIDI, rate: number, frames: number, done: number): Promise<RenderedParts> {
  const { soundfont, sampleRate, partChannels } = setup!;
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
    if ((at / 128) % 2000 === 0) post({ type: "progress", fraction: done + (at / frames) / 2 });
  }
  return { sampleRate, parts, effects };
}

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  try {
    if (m.type === "init") { setup = m; return; }
    if (!rendered || rendered.rate !== m.rate) rendered = { rate: m.rate, parts: await render(m.rate) };
    if (m.type === "render") { post({ type: "rendered" }); return; }
    const steps = unisonSteps(notes!, silenced(notes!, m.master, m.own), rendered.parts.sampleRate, m.rate);
    const wav = mixToWav(rendered.parts, m.gains, m.outputGain, m.ceiling, steps);
    post({ type: "wav", id: m.id, wav, rate: m.rate }, [wav]);
  } catch (error) {
    post({ type: "error", message: String(error) });
  }
};
