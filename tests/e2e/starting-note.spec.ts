import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked, gains } from "./helpers";

// "Ilman omaa" gives the singer their starting pitch (#94): on play, on a seek while playing and
// on resuming after a pause, their part sounds its first note, then goes silent. The fixture's
// notes are quarters at 120 bpm; at tempo 50 % each lasts a second, long enough to see.
const ON = "0.580 0.580";
const OFF = "0.000 1.000";

async function minusAtHalfTempo(page: Page) {
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Miten kuuntelet" }).getByRole("button", { name: "Ilman omaa" }).click();
  for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Hitaammin" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("50 %");
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", OFF);
}

async function seeStartingNote(page: Page) {
  await expect(gains(page)).toHaveAttribute("data-gains", ON);
  await expect(gains(page)).toHaveAttribute("data-gains", OFF, { timeout: 5_000 });
}

for (const [sound, setup] of [
  ["the piano", () => {}],
  ["the sung parts", () => localStorage.setItem("stemmanauhat:settings", JSON.stringify({ sound: "sung" }))],
] as const) {
  test(`in Ilman omaa, ${sound} play the singer's first note, then only the others`, async ({ page }) => {
    await page.addInitScript(setup);
    await page.goto(sound === "the piano" ? "/c/public/esittely" : "/c/public/laulettu");
    await expect(gains(page)).toHaveAttribute("data-player", sound === "the piano" ? "midi" : "sung");
    await minusAtHalfTempo(page);

    await page.getByRole("button", { name: "Soita" }).click();
    await seeStartingNote(page);

    // A seek while playing gives the note from the new place.
    await page.locator("input.progress").fill("4.5");
    await seeStartingNote(page);

    // Pausing turns it off; playing again, at the same place, gives it again.
    await page.getByRole("button", { name: "Tauko" }).click();
    await expect(gains(page)).toHaveAttribute("data-gains", OFF);
    await page.getByRole("button", { name: "Soita" }).click();
    await seeStartingNote(page);
    await page.getByRole("button", { name: "Tauko" }).click();
  });
}
