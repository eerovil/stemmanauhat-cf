import { expect, test } from "@playwright/test";

/**
 * iPhone/Safari's rule for audio, reproduced in Chromium (the suite's browser
 * lets audio start without a tap): an audio context may be resumed only while a
 * tap is being handled. Any other resume() is refused, as WebKit does.
 */
test("the sound is started from the tap itself, as iPhones require", async ({ page }) => {
  await page.addInitScript(() => {
    let inTap = false;
    for (const type of ["click", "pointerup", "touchend", "keydown"]) {
      document.addEventListener(type, () => { inTap = true; setTimeout(() => { inTap = false; }, 0); }, true);
    }
    const refused: string[] = [];
    (window as unknown as { refused: string[] }).refused = refused;
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (!inTap && this.state !== "running") {
        refused.push("resume");
        return Promise.reject(new DOMException("needs a tap", "NotAllowedError"));
      }
      return resume.call(this);
    };
  });
  await page.goto("/c/public");
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { refused: string[] }).refused)).toEqual([]);
});

test("a song whose MIDI fails to load says so and offers a retry", async ({ page }) => {
  await page.route("**/esittely/**/score.mid", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/c/public");
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Kappaleen lataus epäonnistui");
  await page.unroute("**/esittely/**/score.mid");
  await alert.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
});
