import { readFileSync } from "node:fs";
import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { partChannels } from "../../src/client/player/midi";

const file = readFileSync("tests/fixtures/two-part/score.mid");
const midi = () => BasicMIDI.fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

describe("partChannels", () => {
  it("finds each part's channels by its track's name", () => {
    expect(partChannels(midi(), ["Basso", "Tenori"])).toEqual([[1], [0]]);
  });
  it("falls back to track order when the names differ", () => {
    expect(partChannels(midi(), ["T", "B"])).toEqual([[0], [1]]);
  });
  it("gives an unmatched part only a track no other part claimed by name", () => {
    // Tracks are Tenori, Basso: "X" must not take Basso, which "Basso" already has.
    expect(partChannels(midi(), ["X", "Basso"])).toEqual([[0], [1]]);
    expect(partChannels(midi(), ["Basso", "X"])).toEqual([[1], [0]]);
  });
  it("leaves a part silent when there are more parts than tracks", () => {
    expect(partChannels(midi(), ["Tenori", "Basso", "Extra"])).toEqual([[0], [1], []]);
  });
});
