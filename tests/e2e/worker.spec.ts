import { expect, test } from "@playwright/test";
import { fetchIn, PASSPHRASE, signInAs } from "./helpers";

test("song files: signed out, wrong choir, and byte ranges", async ({ page }) => {
  await page.goto("/signin");
  expect((await fetchIn(page, "/files/jm/kokeilu/timing.json")).status).toBe(401);

  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  expect((await fetchIn(page, "/files/jm/kokeilu/timing.json")).status).toBe(200);
  expect((await fetchIn(page, "/files/naiskuoro/kokeilu/timing.json")).status).toBe(403);
  expect((await fetchIn(page, "/files/jm/kokeilu/..%2F..%2Fx")).status).toBe(400);

  const part = await fetchIn(page, "/files/jm/kokeilu/parts/1-Tenori.mp3", { Range: "bytes=0-99" });
  expect(part.status).toBe(206);
  expect(part.range).toMatch(/^bytes 0-99\/\d+$/);
  expect(part.length).toBe(100);
  expect(part.type).toBe("audio/mpeg");

  // Link sessions are not admins.
  expect((await fetchIn(page, "/api/admin")).status).toBe(403);
});

test("an admin adds a member and changing the passphrase signs link users out", async ({ page, browser }) => {
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

  await jm.getByLabel("Uusi salasana: Joensuun Mieslaulajat").fill("uusi-salasana-123");
  await jm.getByRole("button", { name: "Vaihda" }).click();
  await expect(jm.getByText("Salasana vaihdettu")).toBeVisible();
  expect((await fetchIn(linkedPage, "/api/songs?choir=jm")).status).toBe(403);
  await linked.close();

  // Put the seeded passphrase back for any later test.
  await jm.getByLabel("Uusi salasana: Joensuun Mieslaulajat").fill(PASSPHRASE);
  await jm.getByRole("button", { name: "Vaihda" }).click();
  await expect(jm.getByText("Salasana vaihdettu")).toBeVisible();
});

test("a member who is not an admin cannot open the admin page", async ({ page }) => {
  await signInAs(page, "/admin", "laulaja@example.com");
  await expect(page.getByText("ei ole pääsyä")).toBeVisible();
  expect((await fetchIn(page, "/api/admin")).status).toBe(403);
});
