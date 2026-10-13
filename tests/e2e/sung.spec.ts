import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, PASSPHRASE, playAndSeeCursorMove, shownScore } from "./helpers";

// A song whose parts are sung MP3s plays them on one Web Audio clock (player/sung.ts) when the
// singer picks "Laulu" in Säädöt; the piano is the default (Eero, 2026-10-13). The seed uploads
// the fixture's two tones.
const SUNG = () => localStorage.setItem("stemmanauhat:settings", JSON.stringify({ sound: "sung" }));

test("the piano is the default; Säädöt's Laulu plays the sung parts, and the choice carries", async ({ page }) => {
  const parts: string[] = [];
  page.on("response", (r) => { if (/\/files\/.*\/parts\/.*\.mp3$/.test(r.url())) parts.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  expect(parts).toEqual([]);
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  const sound = page.getByRole("group", { name: "Ääni" });
  await expect(sound.getByRole("button", { name: "Piano" })).toHaveAttribute("aria-pressed", "true");
  await sound.getByRole("button", { name: "Laulu" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  // REMY's credit stays in the dock while the singing plays, with Säädöt closed too.
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await expect(page.locator(".dock .sung-credit")).toContainText("Ääni: REMY");
  expect(parts.sort()).toEqual([
    "200 /files/public/laulettu/20261009T120000Z/parts/1-Tenori.mp3",
    "200 /files/public/laulettu/20261009T120000Z/parts/2-Basso.mp3",
  ]);
  // The next visit starts sung.
  await page.reload();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
});

test("a piano visit fetches neither the singing code nor the sung MP3s", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (r) => { if (/\/assets\/sung|\/parts\/.*\.mp3$/.test(r.url())) fetched.push(new URL(r.url()).pathname); });
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await page.getByRole("button", { name: "Selvä" }).click();
  await playAndSeeCursorMove(page);
  expect(fetched).toEqual([]);
});

test("with Laulu chosen the song opens on the piano and the singing takes over once loaded", async ({ page }) => {
  await page.addInitScript(SUNG);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/parts\/.*\.mp3$/, async (route) => { await held; await route.continue(); });
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  // The score and the piano are there at once; the dock says the singing is on its way.
  await expect(shownScore(page)).toBeVisible();
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(page.locator(".dock .sung-loading")).toHaveText("Ladataan laulua…");
  release();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await expect(page.locator(".dock .sung-loading")).toHaveCount(0);
  await expect(page.locator(".dock .sung-credit")).toContainText("Ääni: REMY");
});

test("choosing Piano while the singing loads keeps the piano", async ({ page }) => {
  await page.addInitScript(SUNG);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/parts\/.*\.mp3$/, async (route) => { await held; await route.continue(); });
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(page.locator(".dock .sung-loading")).toBeVisible();
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Ääni" }).getByRole("button", { name: "Piano" }).click();
  release();
  await page.waitForTimeout(1500);
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(page.locator(".dock .sung-loading")).toHaveCount(0);
});

test("switching between the piano and the sung parts keeps the place, and the piano plays again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.locator("input.progress").fill("4.5");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Ääni" }).getByRole("button", { name: "Laulu" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  await page.getByRole("group", { name: "Ääni" }).getByRole("button", { name: "Piano" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  // The second piano on the page loads its sound and plays (it once got a detached buffer).
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  await page.getByRole("button", { name: "Tauko" }).click();
  expect(errors).toEqual([]);
});

test("an old row whose piano MP3s are in R2 is not offered as sung, and shows no singing credit", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Iltalaulu" }).click();
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(page.locator(".sung-credit")).toHaveCount(0);
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ääni" })).toHaveCount(0);
});

test("a song with no sung parts has no sound choice", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ääni" })).toHaveCount(0);
});

test("a song with a sung MP3 per part plays those together, and the cursor follows", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await page.getByRole("button", { name: "Selvä" }).click();
  // The same balance rule as the piano's; the parts' gains add up to at most 1.
  await expect(gains(page)).toHaveAttribute("data-gains", "0.862 0.138");
  await playAndSeeCursorMove(page);

  // Seeking and the tempo keep the one clock: the time shown follows.
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.locator("input.progress").fill("4.5");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("button", { name: "Nopeammin" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("105 %");
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  // The song is 8 s: it ends, and the play button comes back.
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("time")).toHaveText("0:08");
});

test("at tempo 70 % the sung parts play slower, the cursor advancing at 0.7 times real time", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Hitaammin" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("70 %");
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  const position = async () => Number(await page.locator("input.progress").inputValue());
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toHaveAttribute("data-sounding", "1", { timeout: 10_000 });
  // The song's clock against the wall clock, over three seconds.
  await expect.poll(position).toBeGreaterThan(0.5);
  const [t0, p0] = [Date.now(), await position()];
  await page.waitForTimeout(3000);
  const [t1, p1] = [Date.now(), await position()];
  const speed = (p1 - p0) / ((t1 - t0) / 1000);
  expect(speed).toBeGreaterThan(0.6);
  expect(speed).toBeLessThan(0.8);
  await page.getByRole("button", { name: "Tauko" }).click();
});

test("a song that lists MP3s it does not have plays the piano", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
});
