import { expect, test } from "@playwright/test";
import { fetchIn, PASSPHRASE, signInAs } from "./helpers";

test("song files: signed out, wrong choir, and byte ranges", async ({ page }) => {
  await page.goto("/signin");
  expect((await fetchIn(page, "/files/jm/kokeilu/20261009T120000Z/timing.json")).status).toBe(401);

  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  expect((await fetchIn(page, "/files/jm/kokeilu/20261009T120000Z/timing.json")).status).toBe(200);
  expect((await fetchIn(page, "/files/naiskuoro/kokeilu/20261009T120000Z/timing.json")).status).toBe(403);
  expect((await fetchIn(page, "/files/jm/kokeilu/20261009T120000Z/..%2F..%2Fx")).status).toBe(400);

  const midi = await fetchIn(page, "/files/jm/kokeilu/20261009T120000Z/score.mid", { Range: "bytes=0-9" });
  expect(midi.status).toBe(206);
  expect(midi.range).toMatch(/^bytes 0-9\/\d+$/);
  expect(midi.length).toBe(10);
  expect(midi.type).toBe("audio/midi");

  // A republished song is a new address; the old one is gone, not served stale.
  expect((await fetchIn(page, "/files/jm/kokeilu/20250101T000000Z/timing.json")).status).toBe(404);
  // A bad escape in the address is a 400, not a crash.
  expect((await fetchIn(page, "/c/%")).status).toBe(400);

  // Link sessions are not admins.
  expect((await fetchIn(page, "/api/admin")).status).toBe(403);
});

test("the piano is served to anyone, cached for good", async ({ page }) => {
  await page.goto("/signin");
  const piano = await page.request.get("/sound/piano-1.sf3");
  expect(piano.status()).toBe(200);
  expect(piano.headers()["cache-control"]).toContain("immutable");
  expect((await page.request.get("/sound/piano-1.mp3")).status()).toBe(404);
  expect((await page.request.get("/sound/missing-9.sf3")).status()).toBe(404);
});

test("an admin adds a member, and a new link signs old link users out and lets a Google account join", async ({ page, browser }) => {
  const linked = await browser.newContext();
  const linkedPage = await linked.newPage();
  await linkedPage.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  expect((await fetchIn(linkedPage, "/api/songs?choir=jm")).status).toBe(200);

  await signInAs(page, "/admin", "yllapito@example.com");
  await expect(page.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  const jm = page.locator('[data-choir="jm"]');
  await jm.getByLabel("Lisää jäseniä: Joensuun Mieslaulajat").fill("Uusi.Laulaja@Example.com\nei-osoite");
  await jm.getByRole("button", { name: "Lisää" }).click();
  await expect(jm.getByText("uusi.laulaja@example.com")).toBeVisible();

  // The seeded link was set by passphrase, so it works but cannot be shown.
  await expect(jm.getByText("Vanha linkki on käytössä")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await jm.getByRole("button", { name: "Tee uusi linkki" }).click();
  await expect(jm.getByText("Uusi linkki tehty")).toBeVisible();
  const url = await jm.getByLabel("Linkki: Joensuun Mieslaulajat").inputValue();
  expect(url).toMatch(/\/\?user=jm&passphrase=[\w-]{24}$/);
  expect((await fetchIn(linkedPage, "/api/songs?choir=jm")).status).toBe(403);
  await linked.close();

  // The new link opens the songs at once and offers to add a Google account.
  const joiner = await browser.newContext();
  const joinerPage = await joiner.newPage();
  await joinerPage.goto(url);
  await expect(joinerPage).toHaveURL(/\/c\/jm$/);
  await joinerPage.getByRole("link", { name: "Lisää Google-tili" }).click();
  await joinerPage.getByLabel("Email").fill("liittyja@example.com");
  await joinerPage.getByRole("button", { name: "Continue" }).click();
  await expect(joinerPage).toHaveURL(/\/c\/jm$/);
  await expect(joinerPage.getByRole("heading", { name: "Joensuun Mieslaulajat" })).toBeVisible();
  await expect(joinerPage.getByRole("link", { name: "Lisää Google-tili" })).toHaveCount(0);
  await joiner.close();
  await page.reload();
  await expect(jm.getByText("liittyja@example.com")).toBeVisible();

  // Put the seeded passphrase back for any later test.
  const restored = await page.evaluate(async (passphrase) => (await fetch("/api/admin/link", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choir: "jm", passphrase }),
  })).status, PASSPHRASE);
  expect(restored).toBe(200);
});

test("a member who is not an admin cannot open the admin page", async ({ page }) => {
  await signInAs(page, "/admin", "laulaja@example.com");
  await expect(page.getByText("ei ole pääsyä")).toBeVisible();
  expect((await fetchIn(page, "/api/admin")).status).toBe(403);
});
