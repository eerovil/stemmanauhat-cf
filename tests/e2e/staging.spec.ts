import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked, fetchIn, PASSPHRASE, playAndSeeCursorMove, signInAs } from "./helpers";

/** Opens a song from the list and plays it, choosing a part if asked. */
async function playSong(page: Page, title: string) {
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await choosePartIfAsked(page, "Tenori");
  const gotIt = page.getByRole("button", { name: "Selvä" });
  if (await gotIt.isVisible()) await gotIt.click();
  await playAndSeeCursorMove(page);
}

/** A song file's status from the server, past the browser's year-long cache. */
async function fileStatus(page: Page, url: string) {
  return page.evaluate(async (u) => (await fetch(u, { cache: "no-store" })).status, url);
}

/** A JSON POST from inside the page, with its cookies. */
async function postIn(page: Page, url: string, body: unknown) {
  return page.evaluate(async ([u, b]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return r.status;
  }, [url, body] as const);
}

test("an admin tries a new song on the test list, then moves it to a choir's list", async ({ page }) => {
  await signInAs(page, "/c/testi", "yllapito@example.com");
  await expect(page.getByRole("heading", { name: "Testilista" })).toBeVisible();
  await expect(page.locator(".staging-hint")).toContainText("Vain ylläpitäjät näkevät tämän listan.");
  await expect(page.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Uusi laulu"]);
  // No setlists, requests or members here.
  await expect(page.getByRole("button", { name: "Uusi setlista" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pyydä stemmanauhaa" })).toHaveCount(0);

  // It plays like any song.
  await playSong(page, "Uusi laulu");
  await page.goto("/c/testi");

  // Moving it: the test list loses it and the choir's list has it, with its files.
  const choices = page.getByLabel("Siirrä kuorolle: Uusi laulu").locator("option");
  await expect(choices).toHaveText(["Siirrä…", "Joensuun Mieslaulajat", "Naiskuoro", "Vapaat laulut"]);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Siirretäänkö Uusi laulu listalle Joensuun Mieslaulajat?");
    void dialog.accept();
  });
  await page.getByLabel("Siirrä kuorolle: Uusi laulu").selectOption({ label: "Joensuun Mieslaulajat" });
  await expect(page.locator(".move-message")).toHaveText("Uusi laulu siirretty listalle Joensuun Mieslaulajat.");
  await expect(page.locator(".songs li .song-title")).toHaveText(["Iltalaulu"]);
  expect(await fileStatus(page, "/files/testi/uusi/20261016T120000Z/timing.json")).toBe(404);
  expect(await fileStatus(page, "/files/jm/uusi/20261016T120000Z/timing.json")).toBe(200);
  await page.goto("/c/jm");
  await expect(page.locator(".songs li .song-title")).toContainText(["Uusi laulu"]);
  await playSong(page, "Uusi laulu");

  // A song the choir has already is replaced by the tried-out version.
  await page.goto("/c/testi");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Siirrä kuorolle: Iltalaulu").selectOption({ label: "Joensuun Mieslaulajat" });
  await expect(page.locator(".move-message")).toHaveText("Iltalaulu siirretty listalle Joensuun Mieslaulajat.");
  await expect(page.locator(".songs li")).toHaveCount(0);
  expect(await fileStatus(page, "/files/jm/iltalaulu/20261016T120000Z/timing.json")).toBe(200);
  expect(await fileStatus(page, "/files/jm/iltalaulu/20261009T120000Z/timing.json")).toBe(404);
  await page.goto("/c/jm");
  await expect(page.locator(".songs li .song-title").filter({ hasText: "Iltalaulu" })).toHaveCount(1);
});

test("only admins open the test list, and songs move only from it", async ({ page, browser }) => {
  const singer = await (await browser.newContext()).newPage();
  await signInAs(singer, "/c/jm", "laulaja@example.com");
  expect((await fetchIn(singer, "/api/songs?choir=testi")).status).toBe(403);
  await singer.goto("/");
  await expect(singer.getByRole("link", { name: "Testilista" })).toHaveCount(0);
  expect(await postIn(singer, "/api/admin/move", { choir: "testi", slug: "kokeilu", to: "jm" })).toBe(403);

  const linked = await (await browser.newContext()).newPage();
  await linked.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  expect((await fetchIn(linked, "/api/songs?choir=testi")).status).toBe(403);

  await signInAs(page, "/c/jm", "yllapito@example.com");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Testilista" })).toBeVisible();
  // Not from a choir, not to the test list, and the test list takes no members.
  expect(await postIn(page, "/api/admin/move", { choir: "jm", slug: "kokeilu", to: "naiskuoro" })).toBe(400);
  expect(await postIn(page, "/api/admin/move", { choir: "testi", slug: "kokeilu", to: "testi" })).toBe(400);
  expect(await postIn(page, "/api/admin/move", { choir: "testi", slug: "ei-ole", to: "jm" })).toBe(400);
  expect(await postIn(page, "/api/admin/members", { choir: "testi", add: "uusi@example.com" })).toBe(400);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Joensuun Mieslaulajat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Testilista" })).toHaveCount(0);
});
