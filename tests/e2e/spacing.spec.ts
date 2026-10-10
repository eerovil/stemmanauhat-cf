import { expect, test } from "@playwright/test";
import { choosePartIfAsked, PASSPHRASE, playAndSeeCursorMove } from "./helpers";

test("the one-line view widens the bars around a crowded one, as the videos do", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Epätasainen" }).click();
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  const score = page.getByTestId("score");

  // "Kaikki": the bar of sixteenths made its neighbours wider, so the speed per
  // beat steps by at most 1.3x (a few percent over is the correction stopping).
  await expect(page.locator(".player.one-line")).toHaveCount(1);
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  expect(Number(await score.getAttribute("data-step"))).toBeLessThanOrEqual(1.3 * 1.05);

  // "Oma" keeps the page layout as it is drawn.
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await expect(score).toHaveAttribute("data-widenings", "0");
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Kaikki" }).click();
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });

  await playAndSeeCursorMove(page);
});
