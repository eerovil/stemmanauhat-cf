import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, playAndSeeCursorMove } from "./helpers";

// Firefox on Android plays a rendered audio file instead of Web Audio (file-player.ts).
// The browser here is Chromium dressed as Firefox for Android, which takes that path.
test.use({ userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0" });

test("Firefox on Android plays the song as an audio file, slides it as picture pieces, and the cursor follows", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  expect(workers.some((u) => u.includes("render-worker"))).toBe(true);
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
  await playAndSeeCursorMove(page);
  // The line is picture pieces, each moved by its own browser animation, with the marker in the moving layer.
  await expect(page.locator(".score-pieces canvas").first()).toBeVisible();
  expect(await page.locator(".score-pieces canvas").evaluateAll((els) => els.every((e) => e.getAnimations().length === 1))).toBe(true);
  await expect(page.locator(".movers [data-testid=cursor]")).toHaveCount(1);
});
