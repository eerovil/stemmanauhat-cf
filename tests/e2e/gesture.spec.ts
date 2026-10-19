import { expect, test } from "@playwright/test";
import { choosePartIfAsked } from "./helpers";

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
  await choosePartIfAsked(page, "Tenori");
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

/** Elements on the page that a double tap could still zoom: any whose touch-action is not set. */
const zoomable = (page: import("@playwright/test").Page) => page.evaluate(() =>
  [...document.querySelectorAll("*")]
    .filter((el) => !["manipulation", "none"].includes(getComputedStyle(el).touchAction))
    .map((el) => el.tagName + (el.className ? "." + String(el.className) : "")));

test.describe("on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test("a double tap zooms nowhere, and quick taps on − and + each count (#92)", async ({ page }) => {
    await page.goto("/c/public");
    await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
    expect(await zoomable(page)).toEqual([]);

    await page.getByRole("link", { name: "Esittelylaulu" }).click();
    await choosePartIfAsked(page, "Tenori");
    await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
    expect(await zoomable(page)).toEqual([]);
    // The one-line score keeps its own gestures.
    await expect(page.locator(".score-scroll.single-line")).toHaveCSS("touch-action", "none");

    await page.getByRole("button", { name: "Säädöt" }).click();
    expect(await zoomable(page)).toEqual([]);
    const faster = page.getByRole("button", { name: "Nopeammin" });
    await faster.tap();
    await faster.tap();
    await expect(page.getByRole("group", { name: "Tempo" })).toContainText("110 %");

    await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
    await expect(page.locator(".player.one-line")).toHaveCount(0);
    expect(await zoomable(page)).toEqual([]);
  });
});
