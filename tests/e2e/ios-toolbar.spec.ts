import { devices, expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked } from "./helpers";

// Safari on an iPhone (#93). Its bottom toolbar shows and hides as the singer scrolls,
// which to the page is the window getting shorter or taller: the test does the same.
const { defaultBrowserType: _, ...iphone } = devices["iPhone 15"];
// WebKit takes none of Chromium's launch flags.
test.use({ ...iphone, browserName: "webkit", locale: "fi-FI", launchOptions: {} });

const SHOWN = 659;
const HIDDEN = 739;

async function toolbar(page: Page, height: number) {
  await page.setViewportSize({ width: 393, height });
  // Safari's small viewport (`100svh`) is the window with the toolbar shown, whichever
  // way the toolbar is; this browser has no toolbar, so it is set by hand.
  await page.addStyleTag({ content: `.small-viewport { height: ${SHOWN}px !important; }` });
  // Longer than the player waits after a resize.
  await page.waitForTimeout(600);
}

/** The dock's bottom edge against the window's: 0 is pinned to the bottom, fully shown. */
function dockGap(page: Page) {
  return page.evaluate(() => window.innerHeight - document.querySelector(".dock")!.getBoundingClientRect().bottom);
}

/** How far down the one-line view has moved the line. */
function lineDrop(page: Page) {
  return page.locator(".score-scroll .score-wrap").evaluate((el) =>
    Number(/translate3d\([^,]+,\s*([-\d.]+)px/.exec((el as HTMLElement).style.transform)?.[1]));
}

async function open(page: Page) {
  await page.setViewportSize({ width: 393, height: SHOWN });
  await page.goto("/c/public/vapaa-rytmi");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
}

test("one-line view: the toolbar showing and hiding moves neither the line nor the dock", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("time")).not.toHaveText("0:00", { timeout: 10_000 });
  const drop = await lineDrop(page);
  for (const height of [HIDDEN, SHOWN, HIDDEN]) {
    await toolbar(page, height);
    expect(await lineDrop(page)).toBeCloseTo(drop, 1);
    expect(await dockGap(page)).toBe(0);
  }
  // The line still slides with the music.
  const slide = () => page.locator(".score-scroll .score-wrap").evaluate((el) => (el as HTMLElement).style.transform);
  const before = await slide();
  await expect.poll(slide).not.toBe(before);
});

test("page view: the toolbar showing and hiding leaves the page where the singer scrolled it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Suurenna nuottia" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  // The score is taller than the screen, and the singer scrolls down to read ahead.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(SHOWN + 500);
  await page.evaluate(() => window.scrollTo(0, 500));
  for (const height of [HIDDEN, SHOWN]) {
    await toolbar(page, height);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(500);
    expect(await dockGap(page)).toBe(0);
  }
  // The toolbar starts to move while the line shows, and the singer scrolls on before the player looks again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const resized = page.evaluate(() => new Promise((done) => window.addEventListener("resize", done, { once: true })));
  await page.setViewportSize({ width: 393, height: HIDDEN });
  await resized;
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(500);
  await toolbar(page, SHOWN);
  // Playing still brings the line being sung into view.
  await page.getByRole("button", { name: "Soita" }).click();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 }).not.toBe(500);
});
