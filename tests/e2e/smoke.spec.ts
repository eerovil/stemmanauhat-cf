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

  // Hiding the other part's staff leaves only yours; yours cannot be hidden.
  const staffNotes = () => page.getByTestId("score").locator("g.vf-stavenote").count();
  const before = await staffNotes();
  await page.getByRole("button", { name: "Viivastot" }).click();
  const staves = page.getByRole("group", { name: "Näytettävät viivastot" });
  await expect(staves.getByLabel("Tenori")).toBeDisabled();
  await staves.getByLabel("Basso").uncheck();
  await expect.poll(staffNotes).toBe(before / 2);
  // The cursor band still sits over a note of the staff left showing.
  const band = await page.getByTestId("cursor").boundingBox();
  const note = await page.getByTestId("score").locator("g.vf-stavenote").first().boundingBox();
  expect(band!.y).toBeLessThanOrEqual(note!.y + note!.height);
  expect(band!.y + band!.height).toBeGreaterThanOrEqual(note!.y);
  await staves.getByLabel("Basso").check();
  await expect.poll(staffNotes).toBe(before);

  // Zoom makes the score bigger, and the size is remembered.
  const height = async () => (await page.getByTestId("score").locator("svg").first().boundingBox())!.height;
  const small = await height();
  await page.getByRole("button", { name: "Suurenna nuottia" }).click();
  await expect.poll(height).toBeGreaterThan(small);
  expect(await page.evaluate(() => localStorage.getItem("stemmanauhat:zoom"))).toBe("1.15");

  // The one-line view puts the whole score on one line that scrolls with the music.
  await page.getByRole("button", { name: "Vieritys" }).click();
  const scroller = page.getByTestId("score-scroll");
  const lineWidth = () => page.getByTestId("score").evaluate((el) => el.getBoundingClientRect().width);
  await expect.poll(async () => (await lineWidth()) > (await scroller.evaluate((el) => el.clientWidth))).toBe(true);
  await page.getByRole("button", { name: "Soita" }).click();
  const shift = () => scroller.evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().left
    - el.getBoundingClientRect().left);
  await expect.poll(shift, { timeout: 10_000 }).toBeLessThan(0);
  await page.getByRole("button", { name: "Tauko" }).click();
  expect(await page.evaluate(() => localStorage.getItem("stemmanauhat:single-line"))).toBe("1");

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
