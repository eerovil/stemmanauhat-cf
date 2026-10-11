import { describe, expect, it } from "vitest";
import { BarMap, cutPoints } from "../../src/client/player/split";

describe("cutPoints", () => {
  it("cuts a long bar into pieces of about one 4/4 bar", () => {
    const clean = Array.from({ length: 31 }, (_, i) => i + 1);
    expect(cutPoints(32, clean)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it("takes the clean point nearest to a bar's length when the beats are not clean", () => {
    // Long notes: only beats 3, 7, 9 and 14 are free of a note sounding across.
    expect(cutPoints(18, [3, 7, 9, 14])).toEqual([0, 3, 7, 14]);
  });

  it("leaves no tiny last piece", () => {
    expect(cutPoints(17, Array.from({ length: 16 }, (_, i) => i + 1))).toEqual([0, 4, 8, 12]);
  });

  it("leaves a bar whole when nowhere is clean", () => {
    expect(cutPoints(32, [])).toEqual([0]);
  });
});

describe("BarMap", () => {
  // Bar 0 whole, bar 1 cut at 4 and 8, bar 2 whole.
  const map = new BarMap([[0], [0, 4, 8], [0]]);

  it("finds the piece and the beat in it", () => {
    expect(map.pieces).toBe(5);
    expect(map.toPiece(0, 2.5)).toEqual({ piece: 0, beat: 2.5 });
    expect(map.toPiece(1, 0)).toEqual({ piece: 1, beat: 0 });
    expect(map.toPiece(1, 5.5)).toEqual({ piece: 2, beat: 1.5 });
    expect(map.toPiece(1, 8)).toEqual({ piece: 3, beat: 0 });
    expect(map.toPiece(2, 1)).toEqual({ piece: 4, beat: 1 });
  });

  it("goes back to the song's bar and beat", () => {
    expect(map.fromPiece(2, 1.5)).toEqual({ measure: 1, beat: 5.5 });
    expect(map.fromPiece(4, 1)).toEqual({ measure: 2, beat: 1 });
  });

  it("gives each piece its length; a whole bar keeps its own", () => {
    expect(map.pieceLength(0, 3)).toBe(3);
    expect(map.pieceLength(0, null)).toBeNull();
    expect(map.pieceLength(1, 12)).toBe(4);
    expect(map.pieceLength(3, 12)).toBe(4);
    expect(map.pieceLength(3, null)).toBeNull();
  });
});
