import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, playAndSeeCursorMove } from "./helpers";

// Firefox on Android plays a rendered audio file instead of Web Audio (file-player.ts).
// The browser here is Chromium dressed as Firefox for Android, which takes that path.
test.use({ userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0" });

test("Firefox on Android plays the song as an audio file, slides the score in pieces, and the cursor follows", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  expect(workers.some((u) => u.includes("render-worker"))).toBe(true);
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
  await playAndSeeCursorMove(page, { pieces: true });
  // The pieces exist, and those on screen are shown.
  const pieces = page.locator(".score-tile");
  expect(await pieces.count()).toBeGreaterThan(0);
  const shown = await pieces.evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.display === "block").length);
  expect(shown).toBeGreaterThan(0);
});
