import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";
import { findNotes, silenced, silentSpans, unisonSteps, withoutNotes } from "../../src/client/player/unison";
import { smf } from "./smf";

// S1 and S1b start together on C4, part, and meet again on E4, which S1b holds longer.
const song = () => BasicMIDI.fromArrayBuffer(smf([
  ["S1", [[0, 60, 0, 480], [0, 62, 480, 960], [0, 64, 960, 1440]]],
  ["S1b", [[1, 60, 0, 480], [1, 65, 480, 960], [1, 64, 960, 1920]]],
  ["A", [[2, 48, 0, 1920]]],
]));

/** The tick of the first note-off of `key` on channel `ch`. */
const offTick = (midi: BasicMIDI, ch: number, key: number) => midi.tracks.flatMap((t) => t.events)
  .find((e) => ((e.statusByte === (0x80 | ch)) || (e.statusByte === (0x90 | ch) && e.data[1] === 0)) && e.data[0] === key)?.ticks;

const keys = (midi: BasicMIDI, ch: number) => midi.tracks.flatMap((t) => t.events)
  .filter((e) => e.statusByte === (0x90 | ch) && e.data[1]! > 0).map((e) => e.data[0]);

describe("unisons", () => {
  const midi = song();
  const notes = findNotes(midi, partChannels(midi, ["S1", "S1b", "A"]));

  it("are the notes two parts start together on the same pitch", () => {
    expect(notes.unisons.map((u) => u.map((n) => [n.part, n.start]))).toEqual([[[0, 0], [1, 0]], [[0, 1], [1, 1]]]);
  });

  it("sound once, in your part when it is one of them", () => {
    const gone = silenced(notes, 1, true);
    // S1b sings both; S1 drops C4 and E4 (S1b holds E4 longer, so S1's ends first).
    expect([...gone.keys()].map((n) => [n.part, n.start])).toEqual([[0, 0], [0, 1]]);
    const played = withoutNotes(midi, gone.keys(), notes);
    expect(keys(played, 0)).toEqual([62]);
    expect(keys(played, 1)).toEqual([60, 65, 64]);
    expect(keys(midi, 0)).toEqual([60, 62, 64]);
  });

  it("sound as one note held as long as the longest copy", () => {
    // S1 sings both; S1b's E4 is held a beat longer, so S1's is held with it (Eero, #76).
    const gone = silenced(notes, 0, true);
    expect([...gone.keys()].map((n) => [n.part, n.start])).toEqual([[1, 0], [1, 1]]);
    const played = withoutNotes(midi, gone.keys(), notes);
    expect(keys(played, 1)).toEqual([65]);
    expect(offTick(played, 0, 64)).toBe(1920);
    expect(offTick(midi, 0, 64)).toBe(1440);
  });

  it("never hold a note into its own part's next strike of that key", () => {
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["S1", [[0, 64, 0, 480], [0, 64, 480, 960]]],
      ["S1b", [[1, 64, 0, 960]]],
    ]));
    const notes = findNotes(midi, partChannels(midi, ["S1", "S1b"]));
    const played = withoutNotes(midi, silenced(notes, 0, true).keys(), notes);
    expect(keys(played, 0)).toEqual([64, 64]);
    expect(offTick(played, 0, 64)).toBe(480);
  });

  it("go to another part when yours is silent or not one of them", () => {
    expect([...silenced(notes, 1, false).keys()].map((n) => [n.part, n.start])).toEqual([[1, 0], [1, 1]]);
    expect([...silenced(notes, 2, true).keys()].map((n) => [n.part, n.start])).toEqual([[1, 0], [1, 1]]);
  });

  it("leave a sung part out from a little before the note through its release", () => {
    // C4's release would run into S1's next note (D4 at 0.5 s): it stops there. E4 is S1's last.
    const spans = silentSpans(notes, silenced(notes, 1, true));
    expect(spans[0]).toEqual([[0, 0.5], [0.95, 1.65]]);
    expect(spans[1]).toEqual([]);
    expect(spans[2]).toEqual([]);
  });

  it("bring a sung part held longer back in when the note that sings it ends", () => {
    // S1 sings; S1b holds E4 to 2 s and is heard again from S1's end at 1.5 s.
    expect(silentSpans(notes, silenced(notes, 0, true))[1]).toEqual([[0, 0.5], [0.95, 1.5]]);
  });

  it("leave a rest between two left-out notes heard, and join notes that follow on", () => {
    // S1b doubles S1 on C4, rests, doubles it on E4, then straight on with F4.
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["S1", [[0, 60, 0, 480], [0, 64, 1920, 2400], [0, 65, 2400, 2880]]],
      ["S1b", [[1, 60, 0, 480], [1, 64, 1920, 2400], [1, 65, 2400, 2880]]],
    ]));
    const notes = findNotes(midi, partChannels(midi, ["S1", "S1b"]));
    const spans = silentSpans(notes, silenced(notes, 0, true));
    expect(spans[1]).toEqual([[0, 0.65], [1.95, 3.15]]);
  });

  it("keep a sung part in when it holds another note of its own across the left-out one", () => {
    // S1b holds G3 under the unison C4 (a chord within the part): muting S1b would take the G3.
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["S1", [[0, 60, 480, 960], [0, 62, 1920, 2400]]],
      ["S1b", [[1, 55, 0, 1440], [1, 60, 480, 960], [1, 62, 1920, 2400]]],
    ]));
    const notes = findNotes(midi, partChannels(midi, ["S1", "S1b"]));
    const gone = silenced(notes, 0, true);
    expect(gone.size).toBe(2);
    expect(silentSpans(notes, gone)[1]).toEqual([[1.95, 2.65]]);
  });

  it("set the file player's gains at each part's unison notes", () => {
    const steps = unisonSteps(notes, silenced(notes, 1, true), 1000, 2);
    expect(steps[0]).toEqual({ at: [0, 500], gains: [0, 0] });
    expect(steps[1]).toEqual({ at: [0, 500], gains: [1, 1] });
    expect(steps[2]).toEqual({ at: [], gains: [] });
  });
});
