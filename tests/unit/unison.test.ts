import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";
import { boostDb, boosts, findNotes, gainSpans, sameWords, silenced, unisonSteps, withoutNotes } from "../../src/client/player/unison";
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
    const spans = gainSpans(notes, silenced(notes, 1, true));
    expect(spans[0]).toEqual([[0, 0.5, 0], [0.95, 1.65, 0]]);
    expect(spans[1]).toEqual([]);
    expect(spans[2]).toEqual([]);
  });

  it("bring a sung part held longer back in when the note that sings it ends", () => {
    // S1 sings; S1b holds E4 to 2 s and is heard again from S1's end at 1.5 s.
    expect(gainSpans(notes, silenced(notes, 0, true))[1]).toEqual([[0, 0.5, 0], [0.95, 1.5, 0]]);
  });

  it("leave a rest between two left-out notes heard, and join notes that follow on", () => {
    // S1b doubles S1 on C4, rests, doubles it on E4, then straight on with F4.
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["S1", [[0, 60, 0, 480], [0, 64, 1920, 2400], [0, 65, 2400, 2880]]],
      ["S1b", [[1, 60, 0, 480], [1, 64, 1920, 2400], [1, 65, 2400, 2880]]],
    ]));
    const notes = findNotes(midi, partChannels(midi, ["S1", "S1b"]));
    const spans = gainSpans(notes, silenced(notes, 0, true));
    expect(spans[1]).toEqual([[0, 0.65, 0], [1.95, 3.15, 0]]);
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
    expect(gainSpans(notes, gone)[1]).toEqual([[1.95, 2.65, 0]]);
  });

  it("set the file player's gains at each part's unison notes", () => {
    const steps = unisonSteps(notes, silenced(notes, 1, true), 1000, 2);
    expect(steps[0]).toEqual({ at: [0, 500], gains: [0, 0] });
    expect(steps[1]).toEqual({ at: [0, 500], gains: [1, 1] });
    expect(steps[2]).toEqual({ at: [], gains: [] });
  });
});

// Four parts on one note, then T1 and T2 alone on another (eerovil/stemmanauhat-cf#115).
const ttbb = () => BasicMIDI.fromArrayBuffer(smf([
  ["T1", [[0, 57, 0, 480], [0, 64, 480, 960]]],
  ["T2", [[1, 57, 0, 480], [1, 64, 480, 960]]],
  ["B1", [[2, 57, 0, 480], [2, 52, 480, 960]]],
  ["B2", [[3, 57, 0, 480], [3, 45, 480, 960]]],
]));

describe("unisons of more than two parts", () => {
  const midi = ttbb();
  const notes = findNotes(midi, partChannels(midi, ["T1", "T2", "B1", "B2"]));
  const velocity = (m: BasicMIDI, ch: number, key: number) => m.tracks.flatMap((t) => t.events)
    .find((e) => e.statusByte === (0x90 | ch) && e.data[0] === key && e.data[1]! > 0)?.data[1];

  it("sound as one part for two, and 2 dB louder for each part more", () => {
    expect([2, 3, 4, 6].map(boostDb)).toEqual([0, 2, 4, 8]);
    expect(boostDb(1)).toBe(0);
  });

  it("are struck louder in the part that sings them, two parts' unison not", () => {
    const louder = boosts(notes, 2, true);
    expect([...louder].map(([n, db]) => [n.part, n.start, db])).toEqual([[2, 0, 4]]);
    const played = withoutNotes(midi, silenced(notes, 2, true).keys(), notes, louder);
    // 4 dB is velocity times 10^(4/40), as the piano's loudness goes with velocity squared.
    expect(velocity(played, 2, 57)).toBe(Math.round(80 * 10 ** 0.1));
    expect(velocity(played, 0, 64)).toBe(80);
    expect(velocity(played, 1, 64)).toBeUndefined();
    expect(velocity(midi, 2, 57)).toBe(80);
  });

  it("count only the parts heard: not your own with it off", () => {
    expect([...boosts(notes, 0, false).values()]).toEqual([2]);
    expect([...boosts(notes, 0, false).keys()].map((n) => n.part)).toEqual([1]);
  });

  it("never strike harder than 127", () => {
    const loud = BasicMIDI.fromArrayBuffer(smf([0, 1, 2, 3, 4, 5].map((ch) => [`P${ch}`, [[ch, 60, 0, 480, 120]]])));
    const n = findNotes(loud, partChannels(loud, ["P0", "P1", "P2", "P3", "P4", "P5"]));
    const played = withoutNotes(loud, silenced(n, 0, true).keys(), n, boosts(n, 0, true));
    expect(velocity(played, 0, 60)).toBe(127);
  });

  it("turn the file player's copy up over them", () => {
    const steps = unisonSteps(notes, silenced(notes, 2, true), 1000, 1, boosts(notes, 2, true));
    expect(steps[2]!.gains[0]).toBeCloseTo(10 ** 0.2, 6);
    expect(steps[0]).toEqual({ at: [0, 500], gains: [0, 1] });
    expect(steps[1]).toEqual({ at: [0, 500], gains: [0, 0] });
  });

  it("turn the sung part that sings them up, through its release", () => {
    const spans = gainSpans(notes, silenced(notes, 2, true), boosts(notes, 2, true));
    expect(spans[2]!.map(([a, b, g]) => [a, b, Number(g.toFixed(3))])).toEqual([[0, 0.5, 1.585]]);
    expect(spans[0]).toEqual([[0, 0.5, 0]]);
  });

  it("leave a sung part as it is that holds another note of its own across them", () => {
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["T1", [[0, 57, 0, 480], [0, 45, 0, 960]]],
      ["T2", [[1, 57, 0, 480]]],
      ["B1", [[2, 57, 0, 480]]],
    ]));
    const n = findNotes(midi, partChannels(midi, ["T1", "T2", "B1"]));
    expect(gainSpans(n, silenced(n, 0, true), boosts(n, 0, true))[0]).toEqual([]);
  });
});

describe("sung unisons", () => {
  // T and B start E3 together twice: on "kis" against "dum", then both on "dum".
  const midi = BasicMIDI.fromArrayBuffer(smf([
    ["T", [[0, 52, 0, 480], [0, 52, 480, 960]]],
    ["B", [[1, 52, 0, 480], [1, 52, 480, 960]]],
    ["A", [[2, 52, 0, 480]]],
  ]));
  const notes = findNotes(midi, partChannels(midi, ["T", "B", "A"]));
  const at = (ns: { unisons: { part: number; start: number }[][] }) => ns.unisons.map((u) => u.map((n) => [n.part, n.start]));

  it("are only the notes sung on the same syllable (eeron-omat-taskit#110)", () => {
    // A sings "kis" with T on the first: they still sing it once; B's "dum" is heard too.
    const words = sameWords(notes, [[[0, 52, "kis"], [0.5, 52, "dum"]], [[0.01, 52, "dum"], [0.5, 52, "dum"]], [[0, 52, "kis"]]]);
    expect(at(words)).toEqual([[[0, 0], [2, 0]], [[0, 0.5], [1, 0.5]]]);
    expect([...silenced(words, 1, true).keys()].map((n) => [n.part, n.start])).toEqual([[2, 0], [0, 0.5]]);
  });

  it("leave a part with no syllable known on the note singing its own", () => {
    // B has no word at 0 s, and T's at 0.5 s is on another key or too far off.
    const words = sameWords(notes, [[[0, 52, "dum"], [0.5, 53, "dum"]], [[0.5, 52, "dum"]], [[0.2, 52, "dum"]]]);
    expect(at(words)).toEqual([]);
  });
});
