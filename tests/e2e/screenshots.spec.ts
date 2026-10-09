import { expect, test } from "@playwright/test";
import { PASSPHRASE, signInAs } from "./helpers";

// Evidence screenshots for a pull request. Skipped unless SCREENSHOTS_DIR is
// set: ./scripts/run.sh env SCREENSHOTS_DIR=test-results/shots corepack pnpm exec playwright test screenshots
const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "set SCREENSHOTS_DIR to take screenshots");

test("player on a phone, part chosen and playing", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page.getByRole("link", { name: "Kokeilulaulu" })).toBeVisible();
  await page.screenshot({ path: `${dir}/song-list-phone.png` });
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await page.getByRole("button", { name: "Basso" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "1", { timeout: 10_000 });
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.screenshot({ path: `${dir}/player-phone.png` });
});

test("player on a desktop, looping two bars", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Silmukka" }).click();
  // Tap bar 2, then bar 3, of the top staff.
  const measures = page.getByTestId("score").locator("g.vf-measure");
  await measures.nth(1).click();
  await measures.nth(2).click();
  await expect(page.getByText(/Silmukka: tahdit/)).toBeVisible();
  await page.screenshot({ path: `${dir}/player-desktop-loop.png` });
  await context.close();
});

test("refused and admin pages", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "ulkopuolinen@example.com");
  await expect(page.getByText("ei ole pääsyä")).toBeVisible();
  await page.screenshot({ path: `${dir}/refused-phone.png` });

  const admin = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  await expect(admin.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  await admin.screenshot({ path: `${dir}/admin.png`, fullPage: true });
});
