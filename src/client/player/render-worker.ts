/// <reference lib="webworker" />
/**
 * Renders the song in this worker, one track per part, for the audio-file
 * player (file-player.ts), and mixes them into a WAV file on request. The parts
 * stay here so a mix change only re-mixes; a tempo change renders again.
 */
import { BasicMIDI } from "spessasynth_core";
import { renderParts } from "./render";
import { boosts, findNotes, silenced, unisonSteps, type Notes } from "./unison";
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

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  try {
    if (m.type === "init") { setup = m; return; }
    if (!rendered || rendered.rate !== m.rate) {
      const song = BasicMIDI.fromArrayBuffer(setup!.midi.slice(0));
      notes ??= findNotes(song, setup!.partChannels);
      const progress = (fraction: number) => post({ type: "progress", fraction });
      rendered = { rate: m.rate, parts: await renderParts(setup!, song, notes, m.rate, progress) };
    }
    if (m.type === "render") { post({ type: "rendered" }); return; }
    const steps = unisonSteps(notes!, silenced(notes!, m.master, m.own), rendered.parts.sampleRate, m.rate,
      boosts(notes!, m.master, m.own));
    const wav = mixToWav(rendered.parts, m.gains, m.outputGain, m.ceiling, steps);
    post({ type: "wav", id: m.id, wav, rate: m.rate }, [wav]);
  } catch (error) {
    post({ type: "error", message: String(error) });
  }
};
