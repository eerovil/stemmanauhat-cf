import { BasicMIDI, BasicSoundBank } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";
import { renderParts, renderSong } from "../../src/client/player/render";
import { findNotes } from "../../src/client/player/unison";
import { smf, type N } from "./smf";

const RATE = 22050;
const setupFor = (parts: number) => ({
  soundfont: BasicSoundBank.getSampleSoundBankFile(),
  sampleRate: RATE,
  partChannels: Array.from({ length: parts }, (_, p) => [p]),
});
const tune = (ch: number): N[] => [[ch, 60, 0, 480], [ch, 64, 480, 960]];
const energy = (a: Int16Array) => a.reduce((sum, v) => sum + v * v, 0);

describe("renderParts", () => {
  it("rings a unison in the effects as one part's note, not one per copy", async () => {
    // S1 and S1b sing the same two notes; the left-out copy must not add its reverb.
    const song = BasicMIDI.fromArrayBuffer(smf([["S1", tune(0)], ["S1b", tune(1)]]));
    const notes = findNotes(song, partChannels(song, ["S1", "S1b"]));
    const rendered = await renderParts(setupFor(2), song, notes, 1);

    const frames = rendered.effects.length;
    const one = await renderSong(setupFor(1), BasicMIDI.fromArrayBuffer(smf([["S1", tune(0)]])), 1, frames);
    const both = await renderSong(setupFor(2), song, 1, frames);
    expect(energy(one.effects)).toBeGreaterThan(0);
    expect([...rendered.effects]).toEqual([...one.effects]);
    expect(energy(both.effects)).toBeGreaterThan(2 * energy(one.effects));
    // Each part still has its own dry copy, for the mix to choose from.
    expect(energy(rendered.unison![0]!)).toBeGreaterThan(0);
    expect(energy(rendered.unison![1]!)).toBeGreaterThan(0);
    expect(energy(rendered.parts[0]!)).toBe(0);
  });

  it("rings a unison copy held longer to its end", async () => {
    // S1b holds the second note a beat longer than S1: its reverb must last as long.
    const held: N[] = [[1, 60, 0, 480], [1, 64, 480, 1440]];
    const song = BasicMIDI.fromArrayBuffer(smf([["S1", tune(0)], ["S1b", held]]));
    const notes = findNotes(song, partChannels(song, ["S1", "S1b"]));
    const rendered = await renderParts(setupFor(2), song, notes, 1);
    const alone = await renderSong(setupFor(2), BasicMIDI.fromArrayBuffer(smf([["S1", []], ["S1b", held]])), 1,
      rendered.effects.length);
    expect(energy(alone.effects)).toBeGreaterThan(0);
    expect([...rendered.effects]).toEqual([...alone.effects]);
  });
});
