import { describe, expect, it } from "vitest";
import { startingPart } from "../../src/client/player/part";

describe("startingPart", () => {
  const split = ["S1", "S1b", "S2", "A1", "A2"];
  const plain = ["S1", "S2", "A1", "A2"];
  it("starts on the part chosen for this song first", () => {
    expect(startingPart(split, "S2", "S1b")).toBe(2);
    expect(startingPart(plain, "A1", "S1b")).toBe(2);
  });
  it("else starts on the choir part, the split one when the song has it", () => {
    expect(startingPart(split, null, "S1b")).toBe(1);
    expect(startingPart(split, "T1", "A2")).toBe(4);
  });
  it("falls back from a split part to the unsplit one in a song without it", () => {
    expect(startingPart(plain, null, "S1b")).toBe(0);
    expect(startingPart(["T1", "T2", "B1", "B2"], undefined, "T1b")).toBe(0);
    expect(startingPart(plain, "T1", "A2b")).toBe(3);
  });
  it("asks when neither part is in the song", () => {
    expect(startingPart(plain, null, null)).toBe(-1);
    expect(startingPart(plain, "T1", "T1b")).toBe(-1);
    expect(startingPart(["b", "B"], null, "b")).toBe(0);
    expect(startingPart(["T1", "T2"], null, "b")).toBe(-1);
  });
});
