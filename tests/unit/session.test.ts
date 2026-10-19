import { describe, expect, it } from "vitest";
import { allowSilentMode } from "../../src/client/player/session";

describe("allowSilentMode", () => {
  it("asks Safari to play through the silent switch", () => {
    const nav = { audioSession: { type: "auto" } } as unknown as Navigator;
    allowSilentMode(nav);
    expect((nav as unknown as { audioSession: { type: string } }).audioSession.type).toBe("playback");
  });

  it("leaves browsers without an audio session alone", () => {
    expect(() => allowSilentMode({} as Navigator)).not.toThrow();
  });
});
