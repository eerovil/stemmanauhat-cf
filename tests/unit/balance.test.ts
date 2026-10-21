import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { OCTAVE_DB, pitchCurves, pitchDb } from "../../src/client/player/balance";
import { partChannels } from "../../src/client/player/midi";
import { dbToGain, findNotes } from "../../src/client/player/unison";
import { smf } from "./smf";

const round = (curve: number[]) => curve.map((v) => Number(v.toFixed(4)));

describe("the sung parts' balance by pitch", () => {
  it("turns a note up 3 dB an octave below middle C and down as much above it", () => {
    expect(OCTAVE_DB).toBe(3);
    expect(pitchDb(60)).toBe(0);
    expect(pitchDb(48)).toBe(3);
    expect(pitchDb(40)).toBeCloseTo(5);   // a bass's low E
    expect(pitchDb(72)).toBe(-3);         // a soprano's high C
  });

  it("moves each part's gain to each note's from just before it, and holds it through rests", () => {
    // B: C3, a rest, C4. T: C4 then C4 again (no change), then G4.
    const midi = BasicMIDI.fromArrayBuffer(smf([
      ["B", [[0, 48, 0, 480], [0, 60, 960, 1440]]],
      ["T", [[1, 60, 0, 480], [1, 60, 480, 960], [1, 67, 960, 1440]]],
    ]));
    const curves = pitchCurves(findNotes(midi, partChannels(midi, ["B", "T"])));
    expect(round(curves[0]!)).toEqual(round([0, dbToGain(3), 0.95, dbToGain(3), 0.962, 1]));
    expect(round(curves[1]!)).toEqual(round([0, 1, 0.95, 1, 0.962, dbToGain(pitchDb(67))]));
  });

  it("takes the mean of a chord within a part", () => {
    const midi = BasicMIDI.fromArrayBuffer(smf([["T", [[0, 48, 0, 480], [0, 72, 0, 480]]]]));
    expect(pitchCurves(findNotes(midi, partChannels(midi, ["T"])))[0]).toEqual([0, 1]);
  });
});
