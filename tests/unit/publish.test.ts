import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script without types
import { publishPlan, versionFor } from "../../scripts/publish-songs.mjs";

const manifest = {
  slug: "kokeilu", title: "Kokeilijan 'laulu'", duration: 8,
  parts: [{ name: "Tenori", file: "parts/1-Tenori.mp3" }, { name: "Basso", file: "parts/2-Basso.mp3" }],
};
const date = new Date("2026-10-10T12:34:56.789Z");

describe("publishPlan", () => {
  it("puts a version in song-app's format under the choir and slug", () => {
    expect(versionFor(date)).toBe("20261010T123456Z");
    const plan = publishPlan(manifest, "public", date);
    expect(plan.prefix).toBe("songs/public/kokeilu/20261010T123456Z/");
    expect(plan.files).toEqual(["score.musicxml", "score.mid", "timing.json", "manifest.json",
      "parts/1-Tenori.mp3", "parts/2-Basso.mp3"]);
    expect(plan.r2Manifest).toMatchObject({ choir: "public", version: "20261010T123456Z", midi: "score.mid" });
  });
  it("upserts the row with quotes escaped and moves the song from another choir, but not from public", () => {
    const { sql } = publishPlan(manifest, "jm", date);
    expect(sql).toContain("'Kokeilijan ''laulu'''");
    expect(sql).toContain("ON CONFLICT (choir, slug) DO UPDATE");
    expect(sql).toContain("'2026-10-10T12:34:56Z'");
    expect(sql).toContain("DELETE FROM songs WHERE slug = 'kokeilu' AND choir NOT IN ('jm', 'public');");
  });
  it("leaves the choirs' copies alone when publishing to public", () => {
    expect(publishPlan(manifest, "public", date).sql).not.toContain("DELETE");
  });
  it("refuses an unknown choir and a broken manifest", () => {
    expect(() => publishPlan(manifest, "kaikki", date)).toThrow(/unknown choir/);
    expect(() => publishPlan({ ...manifest, parts: [] }, "public", date)).toThrow(/bad manifest/);
    expect(() => publishPlan({ ...manifest, slug: "a/b" }, "public", date)).toThrow(/bad manifest/);
  });
});
