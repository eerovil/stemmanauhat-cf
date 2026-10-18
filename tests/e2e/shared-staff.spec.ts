import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, signInAs } from "./helpers";

// A song of more than five parts is published with parts sharing a staff
// (musescore-choir-plugins#420): here the two-part song with Tenori as voice 1 and
// Basso as voice 2 of one staff. The mix still has a part each; the score has one staff.
test("two parts on one staff: both play, and only the singer's voice is lit as theirs", async ({ page }) => {
  await signInAs(page, "/c/naiskuoro/jaettu", "laulaja2@example.com");
  await choosePartIfAsked(page, "Basso");
  const hint = page.getByRole("button", { name: "Selvä" });
  if (await hint.count()) await hint.click();
  await expect(gains(page)).toHaveAttribute("data-gains", "0.160 1.000");

  const score = page.getByTestId("score");
  const notes = () => score.locator("svg:not(.highlights) g.vf-stavenote").count();
  await expect.poll(notes).toBeGreaterThan(0);
  const all = await notes();

  // Bar 1 beat 1: Tenori sings E4, Basso E3. The lit Basso note is the lower one.
  await page.getByRole("button", { name: "Soita" }).click();
  const lit = (kind: string) => page.locator(`.score .${kind}, .movers .${kind}`).first();
  await expect(lit("lit-focus")).toBeAttached({ timeout: 10_000 });
  await expect(lit("lit-other")).toBeAttached();
  await page.getByRole("button", { name: "Tauko" }).click();
  const focus = (await lit("lit-focus").boundingBox())!;
  const other = (await lit("lit-other").boundingBox())!;
  expect(focus.y).toBeGreaterThan(other.y);

  // "Oma" shows the singer's staff, which is the shared one: nothing is hidden.
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await expect(page.locator(".player.one-line")).toHaveCount(0);
  await expect.poll(notes).toBe(all);
});

// Here Basso sings bar 2 with Tenori (eerovil/eeron-omat-taskit#76). The piano plays such a
// note once, in your part: the song is loaded again without the other's copy whenever your
// part changes, and playback must carry on from where it was.
test("changing part while a unison song plays keeps playing from the same place", async ({ page }) => {
  await signInAs(page, "/c/naiskuoro/jaettu", "laulaja2@example.com");
  await choosePartIfAsked(page, "Basso");
  const hint = page.getByRole("button", { name: "Selvä" });
  if (await hint.count()) await hint.click();
  await page.getByRole("button", { name: "Soita" }).click();
  const pause = page.getByRole("button", { name: "Tauko" });
  await expect(pause).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  const time = page.getByTestId("time");
  await expect(time).toHaveText("0:01", { timeout: 10_000 });

  await page.getByRole("button", { name: "Vaihda oma stemma" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tenori", exact: true }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
  await expect(pause).toBeVisible();
  await expect(time).toHaveText("0:03", { timeout: 10_000 });
  await expect(pause).toHaveAttribute("data-sounding", "1");
});
