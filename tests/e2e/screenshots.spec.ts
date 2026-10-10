import { expect, test } from "@playwright/test";
import { choosePartIfAsked, PASSPHRASE, signInAs } from "./helpers";

// Evidence screenshots for a pull request. Skipped unless SCREENSHOTS_DIR is
// set: ./scripts/run.sh env SCREENSHOTS_DIR=test-results/shots corepack pnpm exec playwright test screenshots
const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "set SCREENSHOTS_DIR to take screenshots");

test("player on a phone: first visit, playing, settings, own staff", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page.getByRole("link", { name: "Kokeilulaulu" })).toBeVisible();
  await page.screenshot({ path: `${dir}/song-list-phone.png` });
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${dir}/player-asks-part-phone.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Basso", exact: true }).click();
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "2", { timeout: 10_000 });
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.screenshot({ path: `${dir}/player-phone.png` });
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.screenshot({ path: `${dir}/player-settings-phone.png` });
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/player-own-staff-phone.png` });
});

test("player on a desktop, entered by the old link", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "1", { timeout: 10_000 });
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.screenshot({ path: `${dir}/player-desktop.png` });
  await context.close();
});

test("front page for a signed-out visitor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
  await page.screenshot({ path: `${dir}/front-page-phone.png` });
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
