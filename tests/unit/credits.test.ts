import { describe, expect, it } from "vitest";
import { credits } from "../../src/client/api";

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
