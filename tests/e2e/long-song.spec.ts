import { expect, test } from "@playwright/test";
import { choosePartIfAsked, playAndSeeCursorMove } from "./helpers";

// Rautavaara's "Katedralen" (351 bars, eeron-omat-taskit#104) is wider on one line than
// OSMD's default page limit (32767): OSMD wrapped the rest into more rows, and the player,
// which only scrolls sideways, showed the wrong bars. 300 dense bars do the same.
test("a song wider than OSMD's default limit stays on one line, and the cursor stays on screen", async ({ page }) => {
  await page.goto("/c/public/pitka");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(page.locator(".player.one-line")).toHaveCount(1);
  const score = page.getByTestId("score");
  await expect(score).toHaveAttribute("data-widths", /\d/);

  // Every note sits at the height of bar 1's notes: one row, not several.
  const boxes = await score.locator("svg:not(.highlights) g.vf-stavenote").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.left, y: r.top })));
  expect(boxes).toHaveLength(300 * 17);
  const byX = [...boxes].sort((a, b) => a.x - b.x);
  const span = (list: { y: number }[]) => Math.max(...list.map((b) => b.y)) - Math.min(...list.map((b) => b.y));
  expect(span(boxes)).toBeLessThanOrEqual(span(byX.slice(0, 17)) + 2);
  expect(byX[byX.length - 1]!.x - byX[0]!.x).toBeGreaterThan(32767);

  // Near the end, the cursor is still where the singer looks.
  const cursor = page.getByTestId("cursor");
  await page.locator("input.progress").fill("590");
  await expect(page.locator(".info-meta")).toContainText("Tahti 296 / 300");
  await expect.poll(() => cursor.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);

  await page.locator("input.progress").fill("0");
  await playAndSeeCursorMove(page);
});
