import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked, PASSPHRASE, signInAs } from "./helpers";

const FLAGS = "/api/songs/jm/kokeilu/flags";

/** A POST from inside the page, with its cookies. */
async function postIn(page: Page, url: string, body: unknown, type = "application/json") {
  return page.evaluate(async ([u, b, t]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": t }, body: JSON.stringify(b) });
    return { status: r.status, body: (await r.json()) as { id?: number; error?: string } };
  }, [url, body, type] as const);
}

async function getIn<T>(page: Page, url: string): Promise<T> {
  return page.evaluate(async (u) => (await fetch(u)).json(), url) as Promise<T>;
}

test("a singer flags a bar of a song, others see it in the player, and an admin marks it done", async ({ page, browser }) => {
  await signInAs(page, "/c/jm/kokeilu", "laulaja@example.com");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).toHaveAttribute("data-measure", "1", { timeout: 10_000 });
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("button", { name: "Ilmoita virheestä" }).click();
  // Flagging stops the music, and starts from the bar the singer is on.
  await expect(page.getByRole("button", { name: "Soita" })).toBeVisible();
  const form = page.getByRole("dialog", { name: "Ilmoita virheestä" });
  const bar = Number(await form.getByLabel("Tahti").inputValue());
  expect(bar).toBeGreaterThanOrEqual(2);
  // Nothing said: the form says what it needs.
  await form.getByRole("button", { name: "Lähetä" }).click();
  await expect(form.getByText("Valitse mikä on vialla tai kirjoita lisätietoja.")).toBeVisible();
  // A signed-in singer is not asked for their name.
  await expect(form.getByLabel("Nimesi")).toHaveCount(0);
  await form.getByText("Väärä nuotti").click();
  await form.getByText("Sanat").click();
  await form.getByLabel("Lisätietoja").fill("Tenorin toinen nuotti kuulostaa väärältä");
  await form.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("Kiitos! Ilmoitus lähetetty.")).toBeVisible();
  await expect(form).toHaveCount(0);

  // Someone who came by link sees it in the song's settings, without who sent it.
  const linked = await (await browser.newContext()).newPage();
  await linked.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  // The song list's requests are for new tracks only.
  await expect(linked.locator(".requested")).toHaveCount(0);
  await linked.getByRole("link", { name: "Kokeilulaulu" }).click();
  await choosePartIfAsked(linked, "Basso");
  await linked.getByRole("button", { name: "Säädöt" }).click();
  const shown = linked.getByRole("list", { name: "Ilmoitetut virheet" });
  await expect(shown).toHaveText(`Ilmoitettu virhe: Tahti ${bar} · Väärä nuotti, Sanat · Tenorin toinen nuotti kuulostaa väärältä`);
  await expect(shown).not.toContainText("laulaja@example.com");

  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/c/jm", "yllapito@example.com");
  await admin.getByRole("link", { name: "Pyyntöjä: 1" }).click();
  const jm = admin.locator('[data-choir="jm"]');
  await expect(jm.getByRole("heading", { name: "Pyynnöt (1)" })).toBeVisible();
  const row = jm.locator(".request-list li", { hasText: "Kokeilulaulu" });
  await expect(row).toContainText("Virhe:");
  await expect(row).toContainText(`tahti ${bar} · Väärä nuotti, Sanat · stemma Tenori`);
  await expect(row).toContainText("laulaja@example.com");
  await expect(row.getByRole("link", { name: "Kokeilulaulu" })).toHaveAttribute("href", "/c/jm/kokeilu");
  await row.getByRole("button", { name: "Tehty" }).click();
  await expect(jm.getByRole("heading", { name: "Pyynnöt (0)" })).toBeVisible();
  // Done: it leaves the player.
  await linked.reload();
  await linked.getByRole("button", { name: "Säädöt" }).click();
  await expect(linked.getByRole("list", { name: "Ilmoitetut virheet" })).toHaveCount(0);

  admin.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Poista" }).click();
  await expect(jm.getByText("Virheilmoitus poistettu.")).toBeVisible();
  await expect(jm.getByText("Ei pyyntöjä.")).toBeVisible();
});

test("flags: who may send them and what they must hold", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  expect((await postIn(page, FLAGS, { note: "jotain" })).status).toBe(200);
  expect((await postIn(page, FLAGS, { problems: [] })).status).toBe(400);
  expect((await postIn(page, FLAGS, { problems: ["volume"] })).status).toBe(400);
  // Not JSON (a cross-site form could send this): refused.
  expect((await postIn(page, FLAGS, { note: "x" }, "text/plain")).status).toBe(415);
  // Not their choir, the open list, a song that is not there.
  expect((await postIn(page, "/api/songs/naiskuoro/kokeilu/flags", { note: "x" })).status).toBe(403);
  expect((await postIn(page, "/api/songs/public/esittely/flags", { note: "x" })).status).toBe(403);
  expect((await postIn(page, "/api/songs/jm/eiole/flags", { note: "x" })).status).toBe(404);
  // The open list's player has no flag button.
  await page.goto("/c/public/esittely");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Säädöt" }).click();
  await expect(page.getByRole("group", { name: "Viivastot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ilmoita virheestä" })).toHaveCount(0);

  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto("/signin");
  expect((await postIn(signedOut, FLAGS, { note: "x" })).status).toBe(401);

  // The song list leaves the flag out of its requests but counts it for the admin.
  const list = await getIn<{ requests: unknown[]; openFlags: number }>(page, "/api/songs?choir=jm");
  expect(list.requests).toEqual([]);
  expect(list.openFlags).toBe(1);

  // Leave no flag behind for the other tests.
  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  const song = await getIn<{ flags: { id: number }[] }>(admin, "/api/songs/jm/kokeilu");
  for (const f of song.flags) expect((await postIn(admin, "/api/admin/requests", { id: f.id, delete: true })).status).toBe(200);
});
