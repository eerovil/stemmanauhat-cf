import { describe, expect, it } from "vitest";
import { credits, listCredits } from "../../src/client/api";

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
