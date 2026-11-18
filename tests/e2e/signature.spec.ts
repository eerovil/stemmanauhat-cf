import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked } from "./helpers";

// The one-line view slides the whole score, so a line's clef, key and time signature
// scrolled away at the start. They stay pinned at the left edge now (player/pinned.ts).
// tests/fixtures/signatures (make-signatures.py) changes them along the way; its bars
// (0-based) and where they start:
//   0  treble 8 / bass clef, one flat, 4/4        (0 s)
//   8  3/4                                        (16 s)
//   12 two sharps (a natural cancels the flat), 4/4 again (22 s)
//   16 three sharps                               (30 s)
//   19 the first staff goes to the bass clef, drawn at the end of this bar, so from bar 21 on (38 s)
const BARS = 24;

/** The glyph shapes of every sign group of a kind under `root`, in document order. */
function shapes(root: ReturnType<Page["locator"]>, kind: "clef" | "keysignature" | "timesignature") {
  return root.locator(`g.vf-${kind}`).evaluateAll((groups) =>
    groups.map((g) => [...g.querySelectorAll("path")].map((p) => p.getAttribute("d")).join(" ")));
}

/**
 * What the pinned signature must show: for each kind, the bar whose own drawing it was
 * copied from (the clef per staff, the others the same bar on both).
 */
async function expectPinned(page: Page, source: { clef: [number, number]; key: number; time: number }) {
  const score = page.getByTestId("score").locator("svg:not(.highlights)");
  const bars = score.locator("g.vf-measure");
  const pinned = page.getByTestId("signature").locator("svg:not([hidden])");
  const wanted = [
    ["clef", [source.clef[0], BARS + source.clef[1]]],
    ["keysignature", [source.key, BARS + source.key]],
    ["timesignature", [source.time, BARS + source.time]],
  ] as const;
  for (const [kind, [first, second]] of wanted) {
    // The bars of a staff's line are listed in order, the second staff's after the first's.
    const own = [...(await shapes(bars.nth(first), kind)).slice(-1), ...(await shapes(bars.nth(second), kind)).slice(-1)];
    expect(own).toHaveLength(2);
    expect(await shapes(pinned, kind), `${kind} from bars ${first + 1} and ${second - BARS + 1}`).toEqual(own);
  }
  // Every sign is really drawn: OSMD also draws invisible (fully transparent) clefs at the end of a bar.
  const fills = await pinned.locator("g path").evaluateAll((paths) => paths.map((p) => p.getAttribute("fill")));
  expect(fills.filter((f) => /^#[0-9a-f]{6}00$/i.test(f ?? ""))).toEqual([]);
  // Each staff has its clef, key and time signature (here, 2 staves).
  for (const kind of ["clef", "keysignature", "timesignature"] as const) {
    expect(await pinned.locator(`g.vf-${kind}`).count(), kind).toBe(2);
  }
}

test("the clef, key and time signature in force stay at the left edge as the line slides", async ({ page }) => {
  await page.goto("/c/public/merkinnat");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  const score = page.getByTestId("score");
  await expect(score).toHaveAttribute("data-widths", /\d/);
  const pinned = page.getByTestId("signature");
  const progress = page.locator("input.progress");
  const clef = score.locator("svg:not(.highlights) g.vf-clef").first();
  const leftOf = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => el.getBoundingClientRect().left);

  // At the start the line's own signs are on screen, so nothing is drawn over them.
  await expect(pinned).toBeHidden();
  const startLeft = await leftOf(clef);

  // Bar 7: the first bar's signs, over the line, in the place they had.
  await progress.fill("12");
  await expect(page.locator(".info-meta")).toContainText("Tahti 7 / 24");
  await expect(pinned).toBeVisible();
  await expectPinned(page, { clef: [0, 0], key: 0, time: 0 });
  expect(Math.abs((await leftOf(pinned.locator("svg:not([hidden]) g.vf-clef").first())) - startLeft)).toBeLessThan(1);
  // ...clear of the marker on the note being sung.
  const cursorLeft = await leftOf(page.getByTestId("cursor"));
  expect(await pinned.locator("svg:not([hidden])").evaluate((el) => el.getBoundingClientRect().right)).toBeLessThan(cursorLeft);

  // Bar 11, after 3/4 began at bar 9: only the time signature changed.
  await progress.fill("19");
  await expect(page.locator(".info-meta")).toContainText("Tahti 11 / 24");
  await expectPinned(page, { clef: [0, 0], key: 0, time: 8 });

  // Bar 15, after bar 13's two sharps and 4/4: the key and time together.
  await progress.fill("26");
  await expect(page.locator(".info-meta")).toContainText("Tahti 15 / 24");
  await expectPinned(page, { clef: [0, 0], key: 12, time: 12 });

  // Bar 20, after bar 17's three sharps alone: the key only.
  await progress.fill("36");
  await expect(page.locator(".info-meta")).toContainText("Tahti 20 / 24");
  await expectPinned(page, { clef: [0, 0], key: 16, time: 12 });

  // Bar 23, after the first staff went to the bass clef at bar 21: the clef of that staff only.
  await progress.fill("42");
  await expect(page.locator(".info-meta")).toContainText("Tahti 23 / 24");
  await expectPinned(page, { clef: [19, 0], key: 16, time: 12 });

  // Back at the start (a repeat or the progress bar): the line's own signs again.
  await progress.fill("0");
  await expect(pinned).toBeHidden();
});

test("the page view draws its own signs on every line, so nothing is pinned", async ({ page }) => {
  await page.goto("/c/public/merkinnat");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(page.getByTestId("score")).toHaveAttribute("data-widths", /\d/);
  await page.locator("input.progress").fill("19");
  await expect(page.getByTestId("signature")).toBeVisible();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await expect(page.getByTestId("signature")).toBeHidden();
  await expect(page.getByTestId("signature").locator("svg")).toHaveCount(0);
});

// Firefox on Android slides the line as picture pieces (slide.ts); the pinned signs are
// their own small drawing over those, so they hold there too.
test.describe("Firefox on Android", () => {
  test.use({ userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0" });

  test("the signs are pinned over the moving picture pieces", async ({ page }) => {
    await page.goto("/c/public/merkinnat");
    await choosePartIfAsked(page, "Tenori");
    await page.getByRole("button", { name: "Selvä" }).click();
    await expect(page.locator(".score-pieces canvas").first()).toBeVisible();
    await page.locator("input.progress").fill("42");
    await expect(page.locator(".info-meta")).toContainText("Tahti 23 / 24");
    await expectPinned(page, { clef: [19, 0], key: 16, time: 12 });
  });
});
