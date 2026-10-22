import { expect, test } from "@playwright/test";
import { choosePartIfAsked, mixedVoices, PASSPHRASE, signInAs } from "./helpers";

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
  await expect(page.getByRole("note")).toBeVisible();
  await page.screenshot({ path: `${dir}/player-hint-phone.png` });
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
  // Turned sideways in "Kaikki": the notes stay the size they were upright.
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Kaikki" }).click();
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });
  await page.setViewportSize({ width: 839, height: 412 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/player-sideways-phone.png` });
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

test("a split-part singer (Tenorib) starts on Tenori without being asked", async ({ page }) => {
  await page.goto("/c/public");
  await page.evaluate(() => localStorage.setItem("stemmanauhat:public:part", "Tenorib"));
  await page.goto("/c/public/esittely");
  await expect(page.getByRole("button", { name: "Vaihda oma stemma" })).toContainText("Tenori");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/split-part-fallback-phone.png` });
});

test("parts show by their place's own name: a song naming them T1 and Bass 2 (#107)", async ({ page }) => {
  await page.route("**/api/songs/public/esittely", async (route) => {
    const data = await (await route.fetch()).json();
    data.parts = [{ name: "T1" }, { name: "Bass 2" }];
    await route.fulfill({ json: data });
  });
  await page.goto("/c/public/esittely");
  await expect(page.getByRole("dialog", { name: "Valitse oma stemma" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/part-names-picker-phone.png` });
  await page.evaluate(() => localStorage.setItem("stemmanauhat:public:part", "Basso 2"));
  await page.reload();
  await expect(page.locator(".own-name")).toHaveText("Basso 2");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/part-names-dock-phone.png` });
});

test("song list sorted popular lately and newest first", async ({ page }) => {
  await page.route("**/api/songs?choir=jm", async (route) => {
    const data = await (await route.fetch()).json();
    const song = data.songs[0];
    data.songs = [
      ["Aamulaulu", "2026-08-01"], ["Bassojen laulu", "2026-09-01"], ["Iltalaulu", "2026-10-05"],
      ["Joulun kellot", "2025-12-01"], ["Kotimaani", "2026-10-08"], ["Suvivirsi", "2026-05-20"],
    ].map(([title, day], i) => ({ ...song, slug: `s${i}`, title, published_at: `${day}T12:00:00Z`,
      // Rows with no credits and with credits too long for one line, to show they keep one height.
      ...(i % 3 === 1 ? { composer: null, lyricist: null, arranger: null } : {}),
      ...(i === 2 ? { composer: "Aino Esimerkki-Hyvinpitkänimi", arranger: "Sulo Sovittaja-Pitkänimi" } : {}) }));
    data.popular = [["s5"], ["s2"], ["s4"]];
    await route.fulfill({ json: data });
  });
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page.locator(".songs .song-title").first()).toHaveText("Suvivirsi");
  await page.screenshot({ path: `${dir}/song-list-popular-phone.png` });
  await page.getByRole("group", { name: "Järjestys" }).getByRole("button", { name: "Uusimmat" }).click();
  await expect(page.locator(".songs .song-title").first()).toHaveText("Kotimaani");
  await page.screenshot({ path: `${dir}/song-list-newest-phone.png` });
});

test("setlists: an admin editing one, and a singer's list with it picked", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "yllapito@example.com");
  await page.getByRole("button", { name: "Uusi setlista" }).click();
  await page.getByLabel("Setlistan nimi").fill("Kevätkonsertti 2027");
  const edit = page.locator(".setlist-edit");
  await edit.getByRole("checkbox", { name: "Kokeilulaulu" }).click();
  await edit.getByRole("checkbox", { name: "Iltalaulu" }).click();
  await page.getByRole("button", { name: "Siirrä ylös: Iltalaulu" }).click();
  await expect(edit.locator(".picked li")).toHaveText([/Iltalaulu/, /Kokeilulaulu/]);
  await page.screenshot({ path: `${dir}/setlist-edit-phone.png` });
  await page.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Kokeilulaulu"]);

  const singer = await (await browser.newContext()).newPage();
  await signInAs(singer, "/c/jm", "laulaja@example.com");
  await singer.getByLabel("Setlista").selectOption({ label: "Kevätkonsertti 2027" });
  await expect(singer.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Kokeilulaulu"]);
  await singer.screenshot({ path: `${dir}/setlist-picked-phone.png` });
  // A search with the setlist picked also lists the songs outside it (#49).
  await singer.getByLabel("Hae kappaletta").fill("i");
  await expect(singer.locator(".songs.others .song-title")).toHaveText(["Epätasainen"]);
  await singer.screenshot({ path: `${dir}/setlist-search-others-phone.png` });

  await page.getByRole("button", { name: "Muokkaa" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Poista setlista" }).click();
  await expect(page.getByLabel("Setlista")).toHaveCount(0);
});

test("requests: a singer filling in the form, the choir's pending list, and the admin's list", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  await page.getByLabel("Kappaleen nimi").fill("Kesäillan valssi");
  await page.getByLabel("Säveltäjä / sovittaja").fill("säv. Aino Esimerkki, sov. Sulo Sovittaja");
  await page.getByLabel("Lisätietoja").fill("Kevätkonserttiin, tenoreille oma stemma");
  await page.getByLabel("Nuotti (PDF, vapaaehtoinen)").setInputFiles(
    { name: "kesaillan-valssi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.screenshot({ path: `${dir}/request-form-phone.png` });
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("Kiitos! Pyyntö lähetetty.")).toBeVisible();

  const linked = await (await browser.newContext()).newPage();
  await linked.goto("/?user=jm&passphrase=testilinkki-jm");
  await linked.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  await linked.getByLabel("Kappaleen nimi").fill("Iltatähti");
  await linked.getByLabel("Nimesi").fill("Matti M.");
  await linked.getByRole("button", { name: "Lähetä" }).click();
  await expect(linked.getByRole("heading", { name: "Pyydetyt (2)" })).toBeVisible();
  await linked.locator(".requests").scrollIntoViewIfNeeded();
  await linked.screenshot({ path: `${dir}/request-pending-phone.png`, fullPage: true });

  const admin = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  const jm = admin.locator('[data-choir="jm"]');
  await expect(jm.getByRole("heading", { name: "Pyynnöt (2)" })).toBeVisible();
  await jm.locator(".request-list li", { hasText: "Iltatähti" }).getByRole("button", { name: "Tehty" }).click();
  await expect(jm.getByRole("heading", { name: "Pyynnöt (1)" })).toBeVisible();
  await jm.screenshot({ path: `${dir}/request-admin.png` });
  for (const title of ["Kesäillan valssi", "Iltatähti"]) {
    admin.once("dialog", (dialog) => dialog.accept());
    await jm.locator(".request-list li", { hasText: title }).getByRole("button", { name: "Poista" }).click();
    await expect(jm.locator(".request-list li", { hasText: title })).toHaveCount(0);
  }
});

test("flags: a singer filling in the form, the flag in the player, and the admin's list", async ({ page, browser }) => {
  await signInAs(page, "/c/jm/kokeilu", "laulaja@example.com");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "2", { timeout: 10_000 });
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("button", { name: "Ilmoita virheestä" })).toBeVisible();
  await page.screenshot({ path: `${dir}/flag-button-phone.png` });
  await page.getByRole("button", { name: "Ilmoita virheestä" }).click();
  const form = page.getByRole("dialog", { name: "Ilmoita virheestä" });
  await form.getByText("Väärä nuotti").click();
  await form.getByLabel("Lisätietoja").fill("Tenorin toinen nuotti kuulostaa väärältä");
  await page.screenshot({ path: `${dir}/flag-form-phone.png` });
  await form.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("Kiitos! Ilmoitus lähetetty.")).toBeVisible();
  await page.screenshot({ path: `${dir}/flag-sent-phone.png` });

  const linked = await (await browser.newContext()).newPage();
  await linked.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await linked.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(linked, "Basso");
  await linked.getByRole("button", { name: "Selvä" }).click();
  await linked.getByRole("button", { name: "Säädöt" }).click();
  await expect(linked.getByRole("list", { name: "Ilmoitetut virheet" })).toContainText("Väärä nuotti");
  await linked.screenshot({ path: `${dir}/flag-shown-phone.png` });

  const admin = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  const jm = admin.locator('[data-choir="jm"]');
  const row = jm.locator(".request-list li", { hasText: "Kokeilulaulu" });
  await expect(row).toContainText("Väärä nuotti");
  await jm.screenshot({ path: `${dir}/flag-admin.png` });
  admin.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Poista" }).click();
  await expect(row).toHaveCount(0);
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

test("choir link: the join offer and the admin's link", async ({ page, browser }) => {
  const linked = await browser.newContext();
  const linkedPage = await linked.newPage();
  await linkedPage.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(linkedPage.getByRole("link", { name: "Lisää Google-tili" })).toBeVisible();
  await expect(linkedPage.getByRole("link", { name: "Kokeilulaulu" })).toBeVisible();
  await linkedPage.screenshot({ path: `${dir}/join-offer-phone.png` });
  await linked.close();

  await signInAs(page, "/admin", "yllapito@example.com");
  const jm = page.locator('[data-choir="jm"]');
  page.once("dialog", (dialog) => dialog.accept());
  await jm.getByRole("button", { name: "Tee uusi linkki" }).click();
  await expect(jm.getByLabel("Linkki: Joensuun Mieslaulajat")).toHaveValue(/passphrase=/);
  await page.screenshot({ path: `${dir}/admin-link-phone.png`, fullPage: true });
  await page.evaluate(async (passphrase) => fetch("/api/admin/link", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choir: "jm", passphrase }),
  }), PASSPHRASE);
});

test.describe("installed app", () => {
  test.use({ serviceWorkers: "allow" });

  test("the offline page", async ({ page, context }) => {
    await page.goto("/c/public");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Ei verkkoyhteyttä" })).toBeVisible();
    await expect(page.locator("img")).toHaveJSProperty("complete", true);
    await page.screenshot({ path: `${dir}/offline-phone.png` });
    await context.setOffline(false);
  });
});

test("one-line view with a crowded bar: its neighbours widened", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 500 } });
  const page = await context.newPage();
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Epätasainen" }).click();
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(page.locator(".player.one-line")).toHaveCount(1);
  await expect(page.getByTestId("score")).toHaveAttribute("data-step", /\d/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/one-line-crowded-bar-desktop.png` });
  await context.close();
});

test("song list, back from a song while the server is still answering (#43)", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(page, "Basso");
  await page.screenshot({ path: `${dir}/back-1-in-song-phone.png` });
  await page.route("**/api/songs?choir=jm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.getByRole("link", { name: "Takaisin lauluihin" }).click();
  await expect(page.getByRole("link", { name: "Jatka siitä: Kokeilulaulu" })).toBeVisible();
  await expect(page.locator(".songs li a")).toHaveCount(3);
  await page.screenshot({ path: `${dir}/back-2-list-before-answer-phone.png` });
});

test("own staff on a phone: a very long bar wraps over several lines (#45)", async ({ page }) => {
  await page.goto("/c/public/vapaa-rytmi");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Viivastot" }).getByRole("button", { name: "Oma" }).click();
  await page.locator(".backdrop").click({ position: { x: 100, y: 100 } });
  await page.locator("input.progress").fill("9.5");
  await expect(page.locator(".info-meta")).toContainText("Tahti 1 / 3");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/long-bar-own-staff-phone.png` });
});

test("the test list, as an admin sees it (#73)", async ({ page }) => {
  await signInAs(page, "/c/testi", "yllapito@example.com");
  await expect(page.getByLabel("Siirrä kuorolle: Uusi laulu")).toBeVisible();
  await page.screenshot({ path: `${dir}/test-list-phone.png` });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Testilista" })).toBeVisible();
  await page.screenshot({ path: `${dir}/home-admin-phone.png` });
});

test("requests (#77): the song named after the PDF, a PDF too big, and the list showing the name", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.goto("/c/jm?lang=en");
  await page.getByRole("button", { name: "Request a practice track" }).click();
  const file = page.getByLabel("Music (PDF, optional)");
  await file.setInputFiles(
    { name: "Ubi Caritas et Amor.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await expect(page.getByLabel("Song name")).toHaveValue("Ubi Caritas et Amor");
  await page.screenshot({ path: `${dir}/request-named-from-pdf-phone.png` });
  await file.setInputFiles(
    { name: "Iso nuotti.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The PDF is too large (over 20 MB).")).toBeVisible();
  await page.screenshot({ path: `${dir}/request-pdf-too-big-phone.png` });
  await file.setInputFiles(
    { name: "Ubi Caritas et Amor.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".requested li")).toContainText("Ubi Caritas et Amor");
  await page.locator(".requests").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/request-listed-by-pdf-name-phone.png`, fullPage: true });

  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  admin.once("dialog", (dialog) => dialog.accept());
  const ubi = admin.locator('[data-choir="jm"] .request-list li', { hasText: "Ubi Caritas et Amor" });
  await ubi.getByRole("button", { name: "Poista" }).click();
  await expect(ubi).toHaveCount(0);
});

test("requests (#77): several PDFs at once", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.goto("/c/jm?lang=en");
  await page.getByRole("button", { name: "Request a practice track" }).click();
  await page.getByLabel("Music (PDF, optional)").setInputFiles(["Ubi Caritas et Amor", "Kesäillan valssi", "Iltatähti"]
    .map((name) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") })));
  await page.getByLabel("Notes").fill("For the Christmas concert");
  await page.screenshot({ path: `${dir}/request-several-pdfs-phone.png` });
});

test("usage: the admin's card of who found the singing and which settings they use", async ({ page, browser }) => {
  // Made-up visitors on the open list: a dozen people, fewer at each step towards the singing.
  await page.goto("/c/public");
  await page.evaluate(async () => {
    const send = (body: object) => fetch("/api/events", { method: "POST", body: JSON.stringify(body) });
    const base = { choir: "public", song: "laulettu", part: "Tenori", sung: 1 };
    const settings = (over: object) => ({ mode: "focus", others: "0.4", rate: "1", staves: "all", zoom: "1", sound: "piano", ...over });
    for (let i = 0; i < 12; i++) {
      const visitor = crypto.randomUUID();
      await send({ ...base, visitor, name: "song_open" });
      if (i < 7) await send({ ...base, visitor, name: "settings_open" });
      if (i < 3) await send({ ...base, visitor, name: "setting", setting: "rate", value: "0.85" });
      if (i < 4) await send({ ...base, visitor, name: "sound_choice", value: "sung" });
      if (i < 4) await send({ ...base, visitor, name: "setting", setting: "sound", value: "sung" });
      if (i < 3) await send({ ...base, visitor, name: "listen", value: "sung", seconds: i ? 45 : 130, listen: crypto.randomUUID(), settings: settings({ sound: "sung", rate: i < 2 ? "0.85" : "1" }) });
      await send({ ...base, visitor, name: "listen", value: "piano", seconds: 60 + i * 20, listen: crypto.randomUUID(), settings: settings({ staves: i % 3 ? "all" : "own" }) });
    }
  });
  const admin = await (await browser.newContext({ viewport: { width: 1000, height: 1100 } })).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  const card = admin.locator(".card.usage");
  await expect(card.locator('[data-usage="public"]')).toBeVisible();
  await card.getByText("Asetukset (30 pv)").click();
  await card.getByText("Viimeisimmät kuuntelut").click();
  await card.screenshot({ path: `${dir}/usage-admin.png` });
});

test("player on a phone: the dot that says a song can be heard sung (#84)", async ({ page }) => {
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(page.getByTestId("sung-dot")).toBeVisible();
  await page.screenshot({ path: `${dir}/player-sung-dot-phone.png` });
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.locator(".sung-tip")).toBeVisible();
  await page.screenshot({ path: `${dir}/player-sung-dot-settings-phone.png` });
});

test("player on a phone: a mixed choir's song credits both singing voices (#102)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("stemmanauhat:settings", JSON.stringify({ sound: "sung" })));
  await page.route("**/api/songs/public/laulettu", mixedVoices);
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await expect(page.locator(".dock .sung-credit")).toContainText("LYSE");
  await page.screenshot({ path: `${dir}/player-two-voices-phone.png` });
});

test("song list: the notice to install the site as an app, on Android and on an iPhone (#91)", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"),
    { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) })));
  await expect(page.locator(".install")).toBeVisible();
  await page.screenshot({ path: `${dir}/song-list-install-android.png` });

  const iphone = await browser.newContext({ locale: "fi-FI", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
      + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const phone = await iphone.newPage();
  await phone.goto("/c/public");
  await expect(phone.locator(".install")).toBeVisible();
  await phone.screenshot({ path: `${dir}/song-list-install-iphone.png` });
  await iphone.close();
});

test("Säädöt's Lisäasetukset open on a sung song (#117)", async ({ page }) => {
  await page.goto("/c/public/laulettu");
  await page.evaluate(() => localStorage.setItem("stemmanauhat:settings", JSON.stringify({ sound: "sung" })));
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(page.locator(".dock")).toHaveAttribute("data-player", "sung");
  const selva = page.getByRole("button", { name: "Selvä" });
  if (await selva.count()) await selva.click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.screenshot({ path: `${dir}/advanced-closed-phone.png` });
  await page.locator("details.advanced summary").click();
  await page.getByRole("slider", { name: /Basso.*voimakkuus/ }).fill("1.3");
  await page.locator("details.advanced").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/advanced-open-phone.png` });
  await page.locator(".sheet").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: `${dir}/advanced-open-bottom-phone.png` });
});
