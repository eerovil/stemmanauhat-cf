import { expect, test } from "@playwright/test";
import { choosePartIfAsked, gains, mixedVoices, PASSPHRASE, playAndSeeCursorMove, shownScore } from "./helpers";

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
  // The fourth line grows the dock: the title and the credit are whole inside it.
  const row = (await page.locator(".dock-row").boundingBox())!;
  for (const line of [page.locator(".info-title"), page.locator(".dock .sung-credit")]) {
    const box = (await line.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(row.y);
    expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height + 0.5);
  }
  expect(parts.sort()).toEqual([
    "200 /files/public/laulettu/20261009T120000Z/parts/1-Tenori.mp3",
    "200 /files/public/laulettu/20261009T120000Z/parts/2-Basso.mp3",
  ]);
  // The next visit starts sung.
  await page.reload();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
});

test("a song whose parts name two voices credits both while the singing plays", async ({ page }) => {
  await page.addInitScript(SUNG);
  await page.route("**/api/songs/public/laulettu", mixedVoices);
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await expect(page.locator(".dock .sung-credit")).toHaveText(
    "Tekoälyn laulama · Ääni: LYSE, UTAU French Resources (valshamr); REMY, UTAU French Resources (Hisa!)");
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
  // The same balance rule as the piano's; the parts' power (squared gains) adds up to at most 1.
  await expect(gains(page)).toHaveAttribute("data-gains", "0.987 0.158");
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

test("the song list marks the songs that can be heard sung, and only those", async ({ page }) => {
  await page.goto("/c/public");
  const row = (title: string) => page.locator(".songs li", { has: page.getByRole("link", { name: title }) });
  await expect(row("Laulettu laulu").getByRole("img", { name: "Laulettu versio" })).toBeVisible();
  await expect(row("Esittelylaulu").locator(".sung-mark")).toHaveCount(0);
  // An old row whose parts are piano MP3s is not marked.
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(row("Iltalaulu")).toBeVisible();
  await expect(row("Iltalaulu").locator(".sung-mark")).toHaveCount(0);
});

// Telling singers a song can be heard sung (#84): a dot on Säädöt, never a card over the score.
// It stays until Laulu has been tried once (Eero, 2026-10-18).
test("a dot on Säädöt and on Laulu stays on every song open until Laulu is tried", async ({ page }) => {
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  const dot = page.getByTestId("sung-dot");
  await page.getByRole("button", { name: "Selvä" }).click();
  for (let open = 1; open <= 4; open++) {
    if (open > 1) await page.reload();
    await expect(gains(page)).toHaveAttribute("data-player", "midi");
    await expect(dot).toBeVisible();
    await page.getByRole("button", { name: "Säädöt" }).click();
    await expect(page.locator(".setting.lit")).toContainText("Ääni");
    await expect(page.getByRole("group", { name: "Ääni" }).getByTestId("sung-dot-choice")).toBeVisible();
    await expect(page.locator(".sung-tip")).toHaveText("Tämän kappaleen voi kuulla myös laulettuna: valitse Laulu.");
    // Nothing plays by itself: the piano stays until Laulu is chosen.
    await expect(gains(page)).toHaveAttribute("data-player", "midi");
    await page.getByRole("button", { name: "Sulje säädöt" }).click();
    await expect(dot).toBeVisible();
  }
  await page.getByRole("button", { name: "Säädöt" }).click();
  const sound = page.getByRole("group", { name: "Ääni" });
  await sound.getByRole("button", { name: "Laulu" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await expect(page.locator(".setting.lit")).toHaveCount(0);
  await expect(sound.getByTestId("sung-dot-choice")).toHaveCount(0);
  // Back on the piano, the dot does not come back: Laulu has been tried.
  await sound.getByRole("button", { name: "Piano" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await page.reload();
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(shownScore(page)).toBeVisible();
  await expect(dot).toHaveCount(0);
});

test("the singing dot never shows on a song without singing, nor to a singer who already sings", async ({ page }) => {
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "midi");
  await expect(page.getByTestId("sung-dot")).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("stemmanauhat:settings", JSON.stringify({ sound: "sung" })));
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  await expect(page.getByTestId("sung-dot")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("stemmanauhat:sung-tried"))).toBe("1");
});

test("Säädöt's closed Lisäasetukset set the singing's balance by pitch and each part's volume, and keep them", async ({ page }) => {
  await page.goto("/c/public/laulettu");
  await page.evaluate(SUNG);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  const selva = page.getByRole("button", { name: "Selvä" });
  if (await selva.count()) await selva.click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  const advanced = page.locator("details.advanced");
  await expect(advanced).not.toHaveAttribute("open");
  await expect(page.getByRole("slider", { name: "Matalat kovempaa" })).toBeHidden();
  await advanced.locator("summary").click();
  const low = page.getByRole("slider", { name: "Matalat kovempaa" });
  await expect(low).toHaveValue("0");
  const middle = page.getByRole("group", { name: "Keskikohta" });
  await expect(middle.getByRole("button", { name: "Hetken" })).toHaveAttribute("aria-pressed", "true");
  await low.fill("8");
  await middle.getByRole("button", { name: "C4" }).click();
  // The bass turned up: its gain in the worklet grows, the tenor's stays.
  const before = (await gains(page).getAttribute("data-gains"))!.split(" ").map(Number);
  await page.getByRole("slider", { name: /Basso.*voimakkuus/ }).fill("1.5");
  await expect(advanced.locator(".others-value").last()).toHaveText("150 %");
  const after = (await gains(page).getAttribute("data-gains"))!.split(" ").map(Number);
  expect(after[0]).toBeCloseTo(before[0]!, 3);
  expect(after[1]).toBeCloseTo(before[1]! * 1.5, 2);
  // All of it is still there on the next visit.
  await page.reload();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  if (await selva.count()) await selva.click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.locator("details.advanced summary").click();
  await expect(page.getByRole("slider", { name: "Matalat kovempaa" })).toHaveValue("8");
  await expect(page.getByRole("group", { name: "Keskikohta" }).getByRole("button", { name: "C4" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: /Basso.*voimakkuus/ })).toHaveValue("1.5");
});

test("a song without singing has Muut stemmat alone in Lisäasetukset, closed until tapped", async ({ page }) => {
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  const selva = page.getByRole("button", { name: "Selvä" });
  if (await selva.count()) await selva.click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  const others = page.getByRole("slider", { name: "Muiden stemmojen voimakkuus" });
  await expect(others).toBeHidden();
  await page.locator("details.advanced summary").click();
  await expect(others).toBeVisible();
  await expect(page.getByRole("slider", { name: "Matalat kovempaa" })).toHaveCount(0);
  await expect(page.getByText("Nämä koskevat vain laulua.")).toHaveCount(0);
});

test("on a short phone Säädöt with Lisäasetukset open scrolls within the screen, top to bottom", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await page.goto("/c/public/laulettu");
  await page.evaluate(SUNG);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  const selva = page.getByRole("button", { name: "Selvä" });
  if (await selva.count()) await selva.click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.locator("details.advanced summary").click();
  const sheet = page.locator(".sheet");
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The last part's slider scrolls into view and works; the first row is there again at the top.
  const last = page.getByRole("slider", { name: /Basso.*voimakkuus/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.fill("0.5");
  await expect(page.locator("details.advanced .others-value").last()).toHaveText("50 %");
  await sheet.evaluate((el) => { el.scrollTop = 0; });
  await expect(page.locator(".segmented.modes")).toBeInViewport();
});
