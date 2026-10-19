import { devices, expect, test, type Page } from "@playwright/test";
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

/** Elements on the page that a double tap or a pinch could still zoom: any whose touch-action allows it. */
const zoomable = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("*")]
    .filter((el) => !["pan-x pan-y", "none"].includes(getComputedStyle(el).touchAction))
    .map((el) => el.tagName + (el.className ? "." + String(el.className) : "")));

/** The percentage a −/+ group shows ("Normaali" is the normal tempo, 100 %). */
const percent = async (page: Page, group: string) =>
  Number((await page.getByRole("group", { name: group }).innerText()).match(/(\d+) %/)?.[1] ?? 100);

/** Two quick taps on a stepper button: each one counts, none is taken for a zoom. */
async function tapTwice(page: Page, group: string, button: string) {
  const start = await percent(page, group);
  const target = page.getByRole("group", { name: group }).getByRole("button", { name: button });
  await target.tap();
  const step = (await percent(page, group)) - start;
  expect(step).not.toBe(0);
  await target.tap();
  await expect.poll(() => percent(page, group)).toBe(start + 2 * step);
}

// The page never zooms (Eero, 2026-10-19). Headless Chromium does no zooming of its own, not
// even for a pinch, so these tests check what decides it: the touch-action of every element and
// the viewport tag.
test.describe("on a phone", () => {
  test("neither a double tap nor a pinch zooms, and quick taps on − and + each count (#92)", async ({ page }) => {
    await page.goto("/c/public");
    await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
    expect(await page.locator('meta[name="viewport"]').getAttribute("content"))
      .toMatch(/maximum-scale=1, user-scalable=no/);
    // The song list.
    expect(await zoomable(page)).toEqual([]);

    // The player in "Kaikki", one line: the dock and the score.
    await page.getByRole("link", { name: "Esittelylaulu" }).click();
    await choosePartIfAsked(page, "Tenori");
    await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
    await expect(page.locator(".dock")).toBeVisible();
    expect(await zoomable(page)).toEqual([]);
    // The one-line score keeps its own gestures.
    await expect(page.locator(".score-scroll.single-line")).toHaveCSS("touch-action", "none");

    // Säädöt, and its −/+ buttons for tempo and score size.
    await page.getByRole("button", { name: "Säädöt" }).tap();
    expect(await zoomable(page)).toEqual([]);
    await tapTwice(page, "Tempo", "Nopeammin");
    await tapTwice(page, "Tempo", "Hitaammin");
    await tapTwice(page, "Nuotin koko", "Suurenna nuottia");
    await tapTwice(page, "Nuotin koko", "Pienennä nuottia");

    // The "Oma" page view.
    await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).tap();
    await expect(page.locator(".player.one-line")).toHaveCount(0);
    expect(await zoomable(page)).toEqual([]);
    await page.getByRole("button", { name: "Sulje säädöt" }).tap();
    expect(await zoomable(page)).toEqual([]);
  });
});

// iOS Safari ignores user-scalable=no and zooms on a double tap unless touch-action is none
// (WebKit bug 319664), so on an iPhone the page cancels pinches and the second quick tap itself,
// sending that tap on as a click.
test.describe("on an iPhone", () => {
  test.use({ userAgent: devices["iPhone 14"].userAgent });

  test("a pinch is cancelled, and the second of two quick taps cannot zoom but still counts (#92)", async ({ page }) => {
    await page.addInitScript(() => {
      const cancelled: boolean[] = [];
      (window as unknown as { cancelled: boolean[] }).cancelled = cancelled;
      // Listening on window, so the page's own listener on document has run.
      window.addEventListener("touchend", (event) => cancelled.push(event.defaultPrevented));
    });
    const cancelled = () => page.evaluate(() => (window as unknown as { cancelled: boolean[] }).cancelled.splice(0));
    await page.goto("/c/public/esittely");
    await choosePartIfAsked(page, "Tenori");
    await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
    await page.getByRole("button", { name: "Säädöt" }).tap();
    await cancelled();
    for (const [group, button] of [["Tempo", "Nopeammin"], ["Nuotin koko", "Pienennä nuottia"]] as const) {
      const start = await percent(page, group);
      const target = page.getByRole("group", { name: group }).getByRole("button", { name: button });
      await page.waitForTimeout(400);
      await cancelled();
      await target.tap();
      await target.tap();
      expect(await cancelled()).toEqual([false, true]);
      const twice = await percent(page, group);
      // One more tap, well after, gives the size of one step.
      await page.waitForTimeout(400);
      await target.tap();
      const step = (await percent(page, group)) - twice;
      expect(step).not.toBe(0);
      expect(twice).toBe(start + 2 * step);
    }

    // In "Oma", a quick second tap on a note still moves there: bar 3's third beat is 5 s in.
    await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).tap();
    await page.getByRole("button", { name: "Sulje säädöt" }).tap();
    await page.waitForTimeout(400);
    await cancelled();
    const note = page.getByTestId("score").locator("svg:not(.highlights) g.vf-stavenote").nth(10);
    const box = (await note.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await cancelled()).toEqual([false, true]);
    await expect(page.getByRole("button", { name: "Soita" })).toBeVisible();
    await expect(page.getByTestId("time")).toHaveText("0:05");

    // Safari's pinch events are cancelled.
    expect(await page.evaluate(() => ["gesturestart", "gesturechange"].map((type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }))).toEqual([true, true]);
  });
});
