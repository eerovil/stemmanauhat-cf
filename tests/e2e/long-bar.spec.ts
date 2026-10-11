import { expect, test } from "@playwright/test";
import { choosePartIfAsked, shownScore } from "./helpers";

// A free-rhythm verse written as one bar of 32 quarters (#45) is drawn in pieces
// of about a 4/4 bar, so in "Oma" it wraps over lines instead of being squeezed
// into one. The cursor, the bar number and a tap on a note still go by the song's bars.
test("a very long bar wraps over several lines, and the cursor and taps follow it", async ({ page }) => {
  await page.goto("/c/public/vapaa-rytmi");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  const score = page.getByTestId("score");
  await expect(shownScore(page)).toBeVisible();
  // Bar 1 in eight pieces, then bars 2 and 3.
  await expect(score).toHaveAttribute("data-pieces", "10");

  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });
  await expect(page.locator(".player.one-line")).toHaveCount(0);

  // Bar 1's 33 Tenori notes sit on more than one line, none on top of another.
  const notes = score.locator("svg:not(.highlights) g.vf-stavenote");
  await expect(notes).toHaveCount(33 + 3);
  const boxes = await notes.evaluateAll((els) => els.slice(0, 33).map((el) => el.getBoundingClientRect())
    .map((r) => ({ x: r.left, y: r.top, w: r.width })));
  const lines = new Set(boxes.map((b) => Math.round(b.y / 20)));
  expect(lines.size).toBeGreaterThan(1);
  for (let i = 1; i < boxes.length; i++) {
    const [a, b] = [boxes[i - 1]!, boxes[i]!];
    if (Math.abs(a.y - b.y) < 20) expect(b.x - a.x).toBeGreaterThan(a.w * 0.9);
  }

  // The cursor goes down the lines through bar 1.
  const cursor = page.getByTestId("cursor");
  const cursorTop = () => cursor.evaluate((el) => el.getBoundingClientRect().top);
  await page.locator("input.progress").fill("1");
  await expect(cursor).toHaveAttribute("data-measure", "0");
  const early = await cursorTop();
  await page.locator("input.progress").fill("14");
  await expect(cursor).toHaveAttribute("data-measure", "0");
  await expect.poll(cursorTop).toBeGreaterThan(early + 20);
  await expect(page.locator(".info-meta")).toContainText("Tahti 1 / 3");

  // A tap on Tenori's 21st note (beat 19 of bar 1) moves there: 9.5 s in.
  await notes.nth(20).click();
  await expect(page.getByTestId("time")).toHaveText("0:09");
  await expect(cursor).toHaveAttribute("data-measure", "0");

  // Playing lights the notes and moves the cursor along.
  const before = await cursor.evaluate((el) => (el as HTMLElement).style.transform);
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("time")).not.toHaveText("0:09", { timeout: 10_000 });
  await expect(page.locator(".score .lit-focus").first()).toBeAttached();
  await expect.poll(() => cursor.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before);
  await page.getByRole("button", { name: "Tauko" }).click();

  // After the long bar, bar 2 is bar 2 again.
  await page.locator("input.progress").fill("17");
  await expect(cursor).toHaveAttribute("data-measure", "1");
  await expect(page.locator(".info-meta")).toContainText("Tahti 2 / 3");
});
