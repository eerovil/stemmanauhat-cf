import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, PASSPHRASE, playAndSeeCursorMove } from "./helpers";

// A song whose parts are sung MP3s plays them on one Web Audio clock (player/sung.ts),
// a local test Eero asked for on 2026-10-12. The seed uploads the fixture's two tones.
test("a song with a sung MP3 per part plays those together, and the cursor follows", async ({ page }) => {
  const parts: string[] = [];
  page.on("response", (r) => { if (/\/files\/.*\/parts\/.*\.mp3$/.test(r.url())) parts.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  expect(parts.sort()).toEqual([
    "200 /files/public/laulettu/20261009T120000Z/parts/1-Tenori.mp3",
    "200 /files/public/laulettu/20261009T120000Z/parts/2-Basso.mp3",
  ]);
  await page.getByRole("button", { name: "Selvä" }).click();
  // The same balance rule as the piano's; the parts' gains add up to at most 1.
  await expect(gains(page)).toHaveAttribute("data-gains", "0.862 0.138");
  await playAndSeeCursorMove(page);

  // Seeking and the tempo keep the one clock: the time shown follows.
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.locator("input.progress").fill("4.5");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("button", { name: "Nopeammin" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("105 %");
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  // The song is 8 s: it ends, and the play button comes back.
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("time")).toHaveText("0:08");
});

test("a song that lists MP3s it does not have plays the piano", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
});
