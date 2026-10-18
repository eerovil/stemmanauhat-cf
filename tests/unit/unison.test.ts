import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";
import { findNotes, silenced, silentSpans, unisonSteps, withoutNotes } from "../../src/client/player/unison";

/** A note: channel, pitch, start and end in ticks (480 to a beat, 120 bpm: a beat is 0.5 s). */
type N = [number, number, number, number];

/** A format-1 MIDI file with one named track per part. */
function smf(tracks: [string, N[]][]): ArrayBuffer {
  const bytes: number[] = [];
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const vlq = (v: number) => {
    const out = [v & 127];
    while ((v >>= 7)) out.unshift((v & 127) | 128);
    return out;
  };
  bytes.push(..."MThd".split("").map((c) => c.charCodeAt(0)), ...u32(6), 0, 1, 0, tracks.length, 480 >> 8, 480 & 255);
  for (const [name, notes] of tracks) {
    const events: [number, number[]][] = [[0, [0xff, 0x03, name.length, ...name.split("").map((c) => c.charCodeAt(0))]]];
    for (const [ch, key, on, off] of notes) {
      events.push([on, [0x90 | ch, key, 80]], [off, [0x80 | ch, key, 0]]);
    }
    events.sort((a, b) => a[0] - b[0] || (a[1][0]! & 0xf0) - (b[1][0]! & 0xf0));
    const body: number[] = [];
    let at = 0;
    for (const [t, data] of events) { body.push(...vlq(t - at), ...data); at = t; }
    body.push(0, 0xff, 0x2f, 0);
    bytes.push(..."MTrk".split("").map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes).buffer;
}

// S1 and S1b start together on C4, part, and meet again on E4, which S1b holds longer.
const song = () => BasicMIDI.fromArrayBuffer(smf([
  ["S1", [[0, 60, 0, 480], [0, 62, 480, 960], [0, 64, 960, 1440]]],
  ["S1b", [[1, 60, 0, 480], [1, 65, 480, 960], [1, 64, 960, 1920]]],
  ["A", [[2, 48, 0, 1920]]],
]));

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
    expect([...gone].map((n) => [n.part, n.start])).toEqual([[0, 0], [0, 1]]);
    const played = withoutNotes(midi, gone);
    expect(keys(played, 0)).toEqual([62]);
    expect(keys(played, 1)).toEqual([60, 65, 64]);
    expect(keys(midi, 0)).toEqual([60, 62, 64]);
  });

  it("keep a note held longer than the one that sings it", () => {
    // S1 sings; S1b's E4 outlasts it, so S1b keeps that one and drops only C4.
    expect([...silenced(notes, 0, true)].map((n) => [n.part, n.start])).toEqual([[1, 0]]);
  });

  it("go to another part when yours is silent or not one of them", () => {
    expect([...silenced(notes, 1, false)].map((n) => [n.part, n.start])).toEqual([[1, 0]]);
    expect([...silenced(notes, 2, true)].map((n) => [n.part, n.start])).toEqual([[1, 0]]);
  });

  it("leave a sung part out from a little before the note to its end", () => {
    const spans = silentSpans(notes, silenced(notes, 1, true));
    expect(spans[0]).toEqual([[0, 0.5], [0.95, 1.5]]);
    expect(spans[1]).toEqual([]);
    expect(spans[2]).toEqual([]);
  });

  it("leave a rest between two left-out notes heard, and join notes that follow on", () => {
    // S1b doubles S1 on C4, rests, doubles it on E4, then straight on with F4.
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["S1", [[0, 60, 0, 480], [0, 64, 1920, 2400], [0, 65, 2400, 2880]]],
      ["S1b", [[1, 60, 0, 480], [1, 64, 1920, 2400], [1, 65, 2400, 2880]]],
    ]));
    const notes = findNotes(midi, partChannels(midi, ["S1", "S1b"]));
    const spans = silentSpans(notes, silenced(notes, 0, true));
    expect(spans[1]).toEqual([[0, 0.5], [1.95, 3]]);
  });

  it("set the file player's gains at each part's unison notes", () => {
    const steps = unisonSteps(notes, silenced(notes, 1, true), 1000, 2);
    expect(steps[0]).toEqual({ at: [0, 500], gains: [0, 0] });
    expect(steps[1]).toEqual({ at: [0, 500], gains: [1, 1] });
    expect(steps[2]).toEqual({ at: [], gains: [] });
  });
});
