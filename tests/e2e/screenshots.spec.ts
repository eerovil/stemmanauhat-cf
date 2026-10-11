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

test("song list sorted newest first", async ({ page }) => {
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
    await route.fulfill({ json: data });
  });
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await expect(page.locator(".songs .song-title").first()).toHaveText("Aamulaulu");
  await page.screenshot({ path: `${dir}/song-list-by-name-phone.png` });
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
