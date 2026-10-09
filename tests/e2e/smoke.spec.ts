import { expect, test } from "@playwright/test";
import { fetchIn, PASSPHRASE, playAndSeeCursorMove, signInAs } from "./helpers";

test("a member signs in with Google, plays a song, and the cursor follows", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page).toHaveURL(/\/c\/jm$/);
  await expect(page.getByRole("heading", { name: "Joensuun Mieslaulajat" })).toBeVisible();

  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await expect(page.getByRole("heading", { name: "Kokeilulaulu" })).toBeVisible();

  // Your part loud, the others at today's video level; switching part swaps them.
  const tenori = page.getByRole("button", { name: "Tenori" });
  const basso = page.getByRole("button", { name: "Basso" });
  await expect(tenori).toHaveAttribute("data-gain", "1.000");
  await expect(basso).toHaveAttribute("data-gain", "0.080");
  await basso.click();
  await expect(basso).toHaveAttribute("data-gain", "1.000");
  await expect(tenori).toHaveAttribute("data-gain", "0.080");
  await page.getByRole("button", { name: "Vain oma" }).click();
  await expect(tenori).toHaveAttribute("data-gain", "0.000");

  await playAndSeeCursorMove(page);

  // Once playing, the gains are the real ones (gain node × element volume), and
  // switching part still gives your part full volume and the others the video level.
  await page.getByRole("button", { name: "Vain oma" }).click();
  await tenori.click();
  await expect(tenori).toHaveAttribute("data-gain", "1.000");
  await expect(basso).toHaveAttribute("data-gain", "0.080");
  const volumes = await page.evaluate(() => [...document.querySelectorAll("audio")].map((a) => a.volume));
  expect(volumes).toEqual([1, 1]);

  // The part and the song are remembered for next time.
  await page.goto("/c/jm");
  await expect(page.getByRole("link", { name: "Jatka siitä: Kokeilulaulu" })).toBeVisible();
});

test("the old passphrase link gets in without a Google account", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(page).toHaveURL(/\/c\/jm$/);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await playAndSeeCursorMove(page);
});

test("a wrong passphrase lands on sign-in", async ({ page }) => {
  await page.goto("/?user=jm&passphrase=vaara-salasana");
  await expect(page).toHaveURL(/\/signin\?next=%2Fc%2Fjm/);
  await expect(page.getByRole("link", { name: "Kirjaudu Google-tilillä" })).toBeVisible();
});

test("a Google account not on the list is refused", async ({ page }) => {
  const statuses: number[] = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/c/jm") statuses.push(r.status()); });
  await signInAs(page, "/c/jm", "ulkopuolinen@example.com");
  await expect(page.getByText("ulkopuolinen@example.com")).toBeVisible();
  await expect(page.getByText("ei ole pääsyä tähän kuoroon")).toBeVisible();
  expect(statuses).toContain(403);
  expect((await fetchIn(page, "/files/jm/kokeilu/20261009T120000Z/score.musicxml")).status).toBe(403);
});

test("the public demo opens without signing in", async ({ page }) => {
  await page.goto("/c/public");
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
});
