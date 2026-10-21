import { BasicMIDI, BasicSoundBank } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";
import { renderParts, renderSong } from "../../src/client/player/render";
import { boosts, findNotes, silenced, unisonSteps, withoutNotes } from "../../src/client/player/unison";
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

  it("plays a unison held longer by one part as one note, held to the end", async () => {
    // S1b holds the second note a beat longer than S1. With S1 yours, the mix plays S1's copy
    // alone, held as long as S1b's (Eero, #76): one note's sound, and its reverb, to the end.
    const held: N[] = [[1, 60, 0, 480], [1, 64, 480, 1440]];
    const song = BasicMIDI.fromArrayBuffer(smf([["S1", tune(0)], ["S1b", held]]));
    const notes = findNotes(song, partChannels(song, ["S1", "S1b"]));
    const rendered = await renderParts(setupFor(2), song, notes, 1);
    const frames = rendered.effects.length;
    const alone = await renderSong(setupFor(2), BasicMIDI.fromArrayBuffer(smf([["S1", [[0, 60, 0, 480], [0, 64, 480, 1440]]], ["S1b", []]])), 1, frames);
    expect(energy(alone.effects)).toBeGreaterThan(0);
    expect([...rendered.unison![0]!]).toEqual([...alone.parts[0]!]);
    expect([...rendered.effects]).toEqual([...alone.effects]);
    const steps = unisonSteps(notes, silenced(notes, 0, true), RATE, 1);
    expect(steps).toEqual([{ at: [0, RATE / 2], gains: [1, 1] }, { at: [0, RATE / 2], gains: [0, 0] }]);
  });

  it("plays a unison of four parts about 4 dB louder than one part's note (#115)", async () => {
    const four = BasicMIDI.fromArrayBuffer(smf([0, 1, 2, 3].map((ch) => [`P${ch}`, [[ch, 60, 0, 960]]])));
    const notes = findNotes(four, partChannels(four, ["P0", "P1", "P2", "P3"]));
    const played = withoutNotes(four, silenced(notes, 0, true).keys(), notes, boosts(notes, 0, true));
    const one = BasicMIDI.fromArrayBuffer(smf([["P0", [[0, 60, 0, 960]]]]));
    const frames = RATE;
    const louder = await renderSong(setupFor(4), played, 1, frames);
    const alone = await renderSong(setupFor(4), one, 1, frames);
    const db = 10 * Math.log10(energy(louder.parts[0]!) / energy(alone.parts[0]!));
    expect(db).toBeGreaterThan(3);
    expect(db).toBeLessThan(5);
    for (const p of [1, 2, 3]) expect(energy(louder.parts[p]!)).toBe(0);
  });
});
