import { expect, test } from "@playwright/test";

test("a part whose file fails is reported, the others play on, and it can be retried", async ({ page }) => {
  await page.route("**/esittely/**/parts/2-Basso.mp3", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/c/public");
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Soita" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Basso");
  await expect(page.getByTestId("time")).not.toHaveText(/^0:00 /, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Tauko" })).toBeVisible();

  // With the file back, a retry brings the part in and the warning goes.
  await page.unroute("**/esittely/**/parts/2-Basso.mp3");
  await alert.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(alert).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll("audio")].every((a) => !a.paused && !a.error)), { timeout: 10_000 }).toBe(true);
});

test("a new layout leaves no old highlights behind", async ({ page }) => {
  await page.goto("/c/public");
  await page.evaluate(() => { localStorage.setItem("stemmanauhat:single-line", "0"); localStorage.setItem("stemmanauhat:zoom", "1"); });
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  const score = page.getByTestId("score");
  await expect(score.locator("svg").first()).toBeVisible();
  // Nothing has played, so nothing should be lit; mark every note as if it were.
  await score.evaluate((el) => el.querySelectorAll("g.vf-stavenote").forEach((n) => n.classList.add("lit-other")));
  await page.getByRole("button", { name: "Suurenna nuottia" }).click();
  // Page lines are laid out again 400 ms after the last zoom click.
  await expect.poll(() => score.locator(".lit-focus, .lit-other").count(), { timeout: 3000 }).toBe(0);
});
