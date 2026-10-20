import { describe, expect, it } from "vitest";
import { credits, hasSungParts, listCredits, sungCredit } from "../../src/client/api";

describe("credits", () => {
  it("names who wrote the song, leaving out what is not known", () => {
    expect(credits({ composer: "A", lyricist: "B", arranger: "C" })).toBe("säv. A · san. B · sov. C");
    expect(credits({ composer: "A", lyricist: null, arranger: " C " })).toBe("säv. A · sov. C");
    expect(credits({ lyricist: "B" })).toBe("san. B");
  });
  it("is empty for a song published without them", () => {
    expect(credits({})).toBe("");
    expect(credits({ composer: null, lyricist: "  ", arranger: null })).toBe("");
  });
});

describe("listCredits", () => {
  it("names the composer and arranger for the song lists, never the lyricist", () => {
    expect(listCredits({ composer: "A", lyricist: "B", arranger: "C" })).toBe("säv. A · sov. C");
    expect(listCredits({ composer: " A ", lyricist: "B" })).toBe("säv. A");
    expect(listCredits({ lyricist: "B", arranger: "C" })).toBe("sov. C");
    expect(listCredits({ lyricist: "B" })).toBe("");
    expect(listCredits({})).toBe("");
  });
});

describe("hasSungParts", () => {
  it("is true only when every part has an MP3 marked sung", () => {
    expect(hasSungParts([{ name: "T", file: "parts/1-T.mp3", sung: true }, { name: "B", file: "parts/2-B.mp3", sung: true }])).toBe(true);
    expect(hasSungParts([{ name: "T", file: "parts/1-T.mp3", sung: true }, { name: "B", file: "parts/2-B.mp3" }])).toBe(false);
    expect(hasSungParts([{ name: "T", file: "parts/1-T.mp3" }])).toBe(false);
    expect(hasSungParts([{ name: "T" }])).toBe(false);
    expect(hasSungParts([])).toBe(false);
  });
});

describe("sungCredit", () => {
  it("credits the voice that sings, REMY when the parts do not name one", () => {
    expect(sungCredit([{ name: "T", file: "a.mp3", sung: true }])).toBe("Tekoälyn laulama · Ääni: REMY, UTAU French Resources (Hisa!)");
    expect(sungCredit([{ name: "S", file: "a.mp3", sung: true, voice: "LYSE" }]))
      .toBe("Tekoälyn laulama · Ääni: LYSE, UTAU French Resources (valshamr)");
  });
  it("credits every voice of a mixed choir once, in the parts' order", () => {
    const mixed = [{ name: "S", voice: "LYSE" }, { name: "A", voice: "LYSE" }, { name: "T", voice: "REMY" }, { name: "B", voice: "REMY" }]
      .map((p) => ({ ...p, file: "a.mp3", sung: true }));
    expect(sungCredit(mixed)).toBe(
      "Tekoälyn laulama · Ääni: LYSE, UTAU French Resources (valshamr); REMY, UTAU French Resources (Hisa!)");
  });
});
