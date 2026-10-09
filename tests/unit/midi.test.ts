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
});
