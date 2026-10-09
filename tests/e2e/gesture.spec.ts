import { expect, test } from "@playwright/test";

/**
 * iPhone/Safari's rule for audio, reproduced in Chromium (the suite's browser
 * lets audio play without a tap): an element may start only while a tap is
 * being handled, and once started that way it may be started again later.
 * Any other play() is refused with NotAllowedError, as WebKit does.
 */
test("every part is started from the tap itself, as iPhones require", async ({ page }) => {
  await page.addInitScript(() => {
    let inTap = false;
    for (const type of ["click", "pointerup", "touchend", "keydown"]) {
      document.addEventListener(type, () => { inTap = true; setTimeout(() => { inTap = false; }, 0); }, true);
    }
    const unlocked = new WeakSet<HTMLMediaElement>();
    const refused: string[] = [];
    (window as unknown as { refused: string[] }).refused = refused;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (inTap) unlocked.add(this);
      if (!unlocked.has(this)) {
        refused.push(this.dataset.part ?? "?");
        return Promise.reject(new DOMException("needs a tap", "NotAllowedError"));
      }
      return play.call(this);
    };
  });
  await page.goto("/c/public");
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect.poll(() => page.evaluate(() =>
    Math.min(...[...document.querySelectorAll("audio")].map((a) => a.currentTime))), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
  expect(await page.evaluate(() => (window as unknown as { refused: string[] }).refused)).toEqual([]);

  // A seek while playing lines the parts up and starts them again, which is
  // allowed now that the tap has started them.
  await page.getByRole("button", { name: "5 sekuntia taaksepäin" }).click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => [...document.querySelectorAll("audio")].every((a) => !a.paused))).toBe(true);
});
