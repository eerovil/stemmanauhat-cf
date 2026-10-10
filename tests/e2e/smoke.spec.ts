import { expect, test } from "@playwright/test";
import { choosePartIfAsked, fetchIn, gains, PASSPHRASE, playAndSeeCursorMove, signInAs } from "./helpers";

test("a member signs in with Google, plays a song, and the cursor follows", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page).toHaveURL(/\/c\/jm$/);
  await expect(page.getByRole("heading", { name: "Joensuun Mieslaulajat" })).toBeVisible();
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();

  // The first time, the singer is asked for their part rather than given the first one.
  const dialog = page.getByRole("dialog", { name: "Valitse oma stemma" });
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tenori", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".info-title")).toHaveText("Kokeilulaulu");
  await expect(page.getByRole("button", { name: "Vaihda oma stemma" })).toContainText("Tenori");

  // A one-time hint explains tapping and dragging the score.
  const hint = page.getByRole("note");
  await expect(hint).toContainText("Napauta nuottia: soita");
  await expect(hint).toContainText("Vedä nuottia sivulle: siirry");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(hint).toHaveCount(0);

  // Your part loud and the others quieter; the four ways of listening.
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("button", { name: "Sulje säädöt" })).toBeVisible();
  const listen = page.getByRole("group", { name: "Miten kuuntelet" });
  await listen.getByRole("button", { name: "Ilman omaa" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "0.000 1.000");
  await listen.getByRole("button", { name: "Tasan" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "0.580 0.580");
  await listen.getByRole("button", { name: "Vain oma" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.000");
  await listen.getByRole("button", { name: "Oma esillä" }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "1.000 0.160");

  // A tap outside the panel (here on the score) closes it, without starting playback.
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });
  await expect(page.locator(".dock-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible();

  // Changing part goes through the same picker.
  await page.getByRole("button", { name: "Vaihda oma stemma" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Basso", exact: true }).click();
  await expect(gains(page)).toHaveAttribute("data-gains", "0.160 1.000");
  await page.getByRole("button", { name: "Vaihda oma stemma" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tenori", exact: true }).click();

  await playAndSeeCursorMove(page);

  // The bar number, not just seconds: "Tahti 3 / 4 · 0:04 / 0:08".
  await page.getByRole("button", { name: "Tauko" }).click();
  await page.locator("input.progress").fill("4.5");
  await expect(page.locator(".info-meta")).toContainText("Tahti 3 / 4");
  await expect(page.locator(".info-meta")).toContainText("/ 0:08");

  // "Kaikki": one line sliding sideways; the page never scrolls; your note stays in view.
  const scroller = page.getByTestId("score-scroll");
  await page.getByRole("button", { name: "Soita" }).click();
  const shift = () => scroller.evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().left
    - el.getBoundingClientRect().left);
  await expect.poll(shift, { timeout: 10_000 }).toBeLessThan(0);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  const view = (await scroller.boundingBox())!;
  const mine = (await page.getByTestId("score").locator(".lit-focus").first().boundingBox())!;
  expect(mine.y).toBeGreaterThanOrEqual(view.y);
  expect(mine.y + mine.height).toBeLessThanOrEqual(view.y + view.height);
  await page.getByRole("button", { name: "Tauko" }).click();

  // Only the height changing (a phone's address bar, a short window): the notes keep
  // their size and the line stays where it was.
  const notehead = () => page.getByTestId("score").locator("g.vf-notehead").first()
    .evaluate((el) => el.getBoundingClientRect().height);
  const headBefore = await notehead();
  const shiftBefore = await shift();
  await page.setViewportSize({ width: 412, height: 360 });
  await page.waitForTimeout(600);
  expect(Math.abs((await notehead()) - headBefore)).toBeLessThan(0.5);
  expect(Math.abs((await shift()) - shiftBefore)).toBeLessThan(1);
  await page.setViewportSize({ width: 412, height: 839 });
  await page.waitForTimeout(600);

  // Dragging the line sideways moves through the song: left is forward, right is back.
  const position = async () => Number(await page.locator("input.progress").inputValue());
  await page.locator("input.progress").fill("1");
  const line = (await scroller.boundingBox())!;
  const drag = async (from: number, by: number) => {
    const y = line.y + line.height / 2;
    await page.mouse.move(line.x + from, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(line.x + from + (by * i) / 8, y);
    await page.mouse.up();
  };
  const start = await position();
  await drag(250, -120);
  const forward = await position();
  expect(forward).toBeGreaterThan(start + 0.5);
  await drag(100, 60);
  expect(await position()).toBeLessThan(forward - 0.2);

  // A tap on the score plays, and another pauses.
  await scroller.click();
  await expect(page.getByRole("button", { name: "Tauko" })).toBeVisible();
  await scroller.click();
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible();

  // "Oma": your staff alone, in page lines, the page no longer a single line.
  const staffNotes = () => page.getByTestId("score").locator("svg:not(.highlights) g.vf-stavenote").count();
  const before = await staffNotes();
  const noteSize = () => page.getByTestId("score").locator("g.vf-notehead").first()
    .evaluate((el) => el.getBoundingClientRect().width);
  const lineNote = await noteSize();
  await page.getByRole("button", { name: "Säädöt" }).click();
  const staves = page.getByRole("group", { name: "Viivastot" });
  await staves.getByRole("button", { name: "Oma" }).click();
  await expect.poll(staffNotes).toBe(before / 2);
  await expect(page.locator(".player.one-line")).toHaveCount(0);
  // The staff keeps its size when the other staves go.
  await expect.poll(async () => Math.abs((await noteSize()) - lineNote)).toBeLessThan(1);
  // And when the song opens straight in "Oma".
  await page.reload();
  await expect.poll(staffNotes).toBe(before / 2);
  await expect.poll(async () => Math.abs((await noteSize()) - lineNote)).toBeLessThan(1);

  // In "Oma" a tap on a note moves there and leaves the sound paused: bar 3's third beat is 5 s in.
  await page.getByTestId("score").locator("svg:not(.highlights) g.vf-stavenote").nth(10).click();
  await expect(page.getByTestId("time")).toHaveText("0:05");
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "2");
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible();

  // Zooming in "Oma" never makes the page wider than the screen, not even before the lines re-wrap.
  // (A phone widens its layout to fit wide content, so measure against the screen itself.)
  const widest = () => page.evaluate(() => Math.max(innerWidth,
    document.querySelector(".sheet")!.getBoundingClientRect().width) - visualViewport!.width);
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("button", { name: "Suurenna nuottia" }).click();
  expect(await widest()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Pienennä nuottia" }).click();
  expect(await widest()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Sulje säädöt" }).click();

  // Turned sideways in "Oma", then back to "Kaikki": the notes keep their size.
  await page.setViewportSize({ width: 839, height: 412 });
  await page.waitForTimeout(1000);
  const turnedNote = await noteSize();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await staves.getByRole("button", { name: "Kaikki" }).click();
  await expect.poll(staffNotes).toBe(before);
  await expect(page.locator(".player.one-line")).toHaveCount(1);
  await expect.poll(async () => Math.abs((await noteSize()) - turnedNote)).toBeLessThan(1);
  await page.setViewportSize({ width: 412, height: 839 });
  await page.waitForTimeout(1000);

  // Zoom makes the score bigger, and the size is remembered.
  const height = async () => (await page.getByTestId("score").locator("svg").first().boundingBox())!.height;
  const small = await height();
  await page.getByRole("button", { name: "Suurenna nuottia" }).click();
  await expect.poll(height).toBeGreaterThan(small);
  expect(await page.evaluate(() => localStorage.getItem("stemmanauhat:zoom"))).toBe("1.15");

  // The tempo, the listening choice and the note size follow the singer to the next song.
  await page.getByRole("button", { name: "Nopeammin" }).click();
  await page.getByRole("group", { name: "Miten kuuntelet" }).getByRole("button", { name: "Ilman omaa" }).click();
  await page.reload();
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("105 %");
  await expect(page.getByRole("group", { name: "Miten kuuntelet" }).getByRole("button", { name: "Ilman omaa" }))
    .toHaveAttribute("aria-pressed", "true");
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("group", { name: "Tempo" })).toContainText("105 %");
  await expect(page.getByRole("group", { name: "Miten kuuntelet" }).getByRole("button", { name: "Ilman omaa" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Nuotin koko" })).toContainText("115 %");

  // The song is remembered on the choir's list.
  await page.goto("/c/jm");
  await expect(page.getByRole("link", { name: "Jatka siitä: Kokeilulaulu" })).toBeVisible();
});

test("the song list sorts by name or newest first, and remembers the choice", async ({ page }) => {
  await page.route("**/api/songs?choir=jm", async (route) => {
    const data = await (await route.fetch()).json();
    const song = data.songs[0];
    data.songs = [
      { ...song, slug: "b", title: "Bassojen laulu", published_at: "2026-09-01T12:00:00Z" },
      { ...song, slug: "a", title: "Aamulaulu", published_at: "2026-08-01T12:00:00Z" },
      { ...song, slug: "c", title: "Iltalaulu", published_at: "2026-10-05T12:00:00Z" },
    ];
    await route.fulfill({ json: data });
  });
  await signInAs(page, "/c/jm", "laulaja@example.com");
  const titles = page.locator(".songs li a");
  await expect(titles).toHaveText(["Aamulaulu", "Bassojen laulu", "Iltalaulu"]);
  await expect(page.locator(".songs .date")).toHaveCount(0);

  const order = page.getByRole("group", { name: "Järjestys" });
  await order.getByRole("button", { name: "Uusimmat" }).click();
  await expect(titles).toHaveText(["Iltalaulu", "Bassojen laulu", "Aamulaulu"]);
  await expect(page.locator(".songs .date")).toHaveText(["5.10.2026", "1.9.2026", "1.8.2026"]);

  await page.reload();
  await expect(order.getByRole("button", { name: "Uusimmat" })).toHaveAttribute("aria-pressed", "true");
  await expect(titles).toHaveText(["Iltalaulu", "Bassojen laulu", "Aamulaulu"]);
  await order.getByRole("button", { name: "Nimi" }).click();
  await expect(titles).toHaveText(["Aamulaulu", "Bassojen laulu", "Iltalaulu"]);
});

test("the old passphrase link gets in without a Google account", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(page).toHaveURL(/\/c\/jm$/);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(page, "Tenori");
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

test("a signed-out visitor finds the open songs on the front page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vapaat laulut" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kirjaudu Google-tilillä" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kokeilulaulu" })).toHaveCount(0);
  await page.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(page).toHaveURL(/\/c\/public\/esittely$/);
  await expect(page.getByTestId("score").locator("svg").first()).toBeVisible();
});
