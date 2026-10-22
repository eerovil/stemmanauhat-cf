import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { DEFAULT_PIVOT, OCTAVE_DB, pitchCurves, pitchDb, songPivot } from "../../src/client/player/balance";
import { partChannels } from "../../src/client/player/midi";
import { dbToGain, findNotes } from "../../src/client/player/unison";
import { smf, type N } from "./smf";

const round = (curve: number[]) => curve.map((v) => Number(v.toFixed(4)));
const notesOf = (tracks: [string, N[]][]) => {
  const midi = BasicMIDI.fromArrayBuffer(smf(tracks));
  return findNotes(midi, partChannels(midi, tracks.map(([name]) => name)));
};

describe("the sung parts' balance by pitch", () => {
  it("turns a note up 5 dB an octave below the middle and down as much above it, by default the moment's middle", () => {
    expect(OCTAVE_DB).toBe(5);
    expect(DEFAULT_PIVOT).toBe("moment");
    expect(pitchDb(60)).toBe(0);
    expect(pitchDb(48)).toBe(5);
    expect(pitchDb(72, 3)).toBe(-3);
    expect(pitchDb(48, 3, 48)).toBe(0);
  });

  it("with a fixed middle, moves each part's gain to each note's from just before it, and holds it through rests", () => {
    // B: C3, a rest, C4. T: C4 then C4 again (no change), then G4.
    const notes = notesOf([
      ["B", [[0, 48, 0, 480], [0, 60, 960, 1440]]],
      ["T", [[1, 60, 0, 480], [1, 60, 480, 960], [1, 67, 960, 1440]]],
    ]);
    const curves = pitchCurves(notes, 3, 60);
    expect(round(curves[0]!)).toEqual(round([0, dbToGain(3), 0.95, dbToGain(3), 0.962, 1]));
    expect(round(curves[1]!)).toEqual(round([0, 1, 0.95, 1, 0.962, dbToGain(pitchDb(67, 3))]));
  });

  it("takes the mean of a chord within a part", () => {
    expect(pitchCurves(notesOf([["T", [[0, 48, 0, 480], [0, 72, 0, 480]]]]), 3, 60)[0]).toEqual([0, 1]);
  });

  it("goes to the note held on when the rest of a chord ends", () => {
    // C3 and C5 together; C5 ends at 0.5 s, C3 goes on to 1 s.
    expect(round(pitchCurves(notesOf([["T", [[0, 48, 0, 960], [0, 72, 0, 480]]]]), 3, 60)[0]!))
      .toEqual(round([0, 1, 0.5, 1, 0.512, dbToGain(3)]));
  });

  it("with the moment's middle, the lowest part sounding is loudest, and a part singing alone stays as it is", () => {
    // C3 and C4 together for a beat, then C4 alone.
    const notes = notesOf([["T", [[1, 60, 0, 960]]], ["B", [[0, 48, 0, 480]]]]);
    const [t, b] = pitchCurves(notes, 5, "moment");
    expect(round(t!)).toEqual(round([0, dbToGain(-2.5), 0.5, dbToGain(-2.5), 0.512, 1]));
    expect(round(b!)).toEqual(round([0, dbToGain(2.5)]));
  });

  it("with the song's middle, takes the mean key of all its notes, by how long each sounds", () => {
    const notes = notesOf([["T", [[1, 72, 0, 480]]], ["B", [[0, 48, 0, 960]]]]);
    expect(songPivot(notes)).toBe(56);
    expect(round(pitchCurves(notes, 6, "song")[0]!)).toEqual(round([0, dbToGain(-8)]));
  });
});
