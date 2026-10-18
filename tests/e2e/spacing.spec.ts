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

  // Bar 5 is a whole-bar rest, drawn mid-bar. Measured from the rest, it looked
  // half as wide as it is and was widened to twice its neighbours (#75). Measured
  // from its left edge, it is no wider per beat than the wider of them.
  const widths = (await score.getAttribute("data-widths"))!.split(" ").map(Number);
  expect(widths[4]!).toBeLessThanOrEqual(Math.max(widths[3]!, widths[5]!) * 1.05);

  // "Oma" keeps the page layout as it is drawn.
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await expect(score).toHaveAttribute("data-widenings", "0");
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Kaikki" }).click();
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });

  await playAndSeeCursorMove(page);
});

test("the score is laid out alike on a phone without Times New Roman (#86)", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  const widthsOn = async () => {
    await page.goto("/c/jm/epatasainen");
    await choosePartIfAsked(page, "Tenori");
    const score = page.getByTestId("score");
    await expect(score).toHaveAttribute("data-widths", /\d/);
    return score.getAttribute("data-widths");
  };
  const here = await widthsOn();
  const lyric = page.locator("[data-testid=score] svg:not(.highlights) text", { hasText: /^laa$/ }).first();
  await expect(lyric).toHaveAttribute("font-family", "Tinos");

  // Android has no Times New Roman and drew OSMD's lyrics in Noto Serif, about
  // 18 % wider; OSMD then widened bars with lyrics up to 2.5 times. The site's
  // own font is the same on every device, so a wider Times changes nothing.
  await page.addInitScript(() => {
    const measure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text: string) {
      const metrics = measure.call(this, text);
      if (!this.font.includes("Times New Roman")) return metrics;
      return new Proxy(metrics, { get: (m, key) => (key === "width" ? m.width * 1.18 : Reflect.get(m, key)) });
    };
  });
  expect(await widthsOn()).toBe(here);
});
