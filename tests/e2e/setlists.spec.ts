import { expect, test, type Page } from "@playwright/test";
import { fetchIn, PASSPHRASE, signInAs } from "./helpers";

/** A JSON POST from inside the page, with its cookies. */
async function postIn(page: Page, url: string, body: unknown) {
  return page.evaluate(async ([u, b]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: (await r.json()) as { id?: number } };
  }, [url, body] as const);
}

test("an admin makes a setlist, and a singer sees only its songs in its order", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "yllapito@example.com");
  // No setlists yet: no dropdown, only the admin's button.
  await expect(page.getByRole("button", { name: "Uusi setlista" })).toBeVisible();
  await expect(page.getByLabel("Setlista")).toHaveCount(0);

  await page.getByRole("button", { name: "Uusi setlista" }).click();
  await page.getByLabel("Setlistan nimi").fill("Kevätkonsertti");
  const edit = page.locator(".setlist-edit");
  await edit.getByRole("checkbox", { name: "Kokeilulaulu" }).click();
  await edit.getByRole("checkbox", { name: "Iltalaulu" }).click();
  await page.getByRole("button", { name: "Siirrä ylös: Iltalaulu" }).click();
  await expect(edit.locator(".picked li")).toHaveText([/Iltalaulu/, /Kokeilulaulu/]);
  await page.getByRole("button", { name: "Tallenna" }).click();

  await expect(page.getByText("Tallennettu.")).toBeVisible();
  await expect(page.getByLabel("Setlista")).toHaveValue(/\d+/);
  await expect(page.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Kokeilulaulu"]);
  await expect(page.locator(".songs .place")).toHaveText(["1.", "2."]);
  await expect(page.getByRole("group", { name: "Järjestys" })).toHaveCount(0);

  // A singer picks it from the dropdown; it stays picked after a reload.
  const singer = await (await browser.newContext()).newPage();
  await signInAs(singer, "/c/jm", "laulaja@example.com");
  await expect(singer.locator(".songs li .song-title")).toHaveText(["Epätasainen", "Iltalaulu", "Kokeilulaulu"]);
  await singer.getByLabel("Setlista").selectOption({ label: "Kevätkonsertti" });
  await expect(singer.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Kokeilulaulu"]);
  await expect(singer.getByRole("button", { name: "Muokkaa" })).toHaveCount(0);
  await expect(singer.getByRole("button", { name: "Uusi setlista" })).toHaveCount(0);
  await singer.reload();
  await expect(singer.locator(".songs li .song-title")).toHaveText(["Iltalaulu", "Kokeilulaulu"]);
  // Search filters inside the setlist, and each song keeps its place.
  await singer.getByLabel("Hae kappaletta").fill("koke");
  await expect(singer.locator(".songs li .song-title")).toHaveText(["Kokeilulaulu"]);
  await expect(singer.locator(".songs .place")).toHaveText(["2."]);
  await singer.getByLabel("Hae kappaletta").fill("");
  await singer.getByLabel("Setlista").selectOption({ label: "Kaikki kappaleet" });
  await expect(singer.locator(".songs li a")).toHaveCount(3);

  // The admin removes a song, then deletes the setlist.
  await page.getByRole("button", { name: "Muokkaa" }).click();
  await edit.getByRole("checkbox", { name: "Iltalaulu" }).click();
  await page.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.locator(".songs li .song-title")).toHaveText(["Kokeilulaulu"]);
  await page.getByRole("button", { name: "Muokkaa" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Poista setlista" }).click();
  await expect(page.getByText("Setlista poistettu.")).toBeVisible();
  await expect(page.getByLabel("Setlista")).toHaveCount(0);
  await expect(page.locator(".songs li a")).toHaveCount(3);
});

test("only an admin may change setlists, and only with songs of that choir", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "yllapito@example.com");
  const made = await postIn(page, "/api/admin/setlists", { choir: "jm", name: "Testi", songs: ["kokeilu"] });
  expect(made.status).toBe(200);
  const id = made.body.id as number;
  expect((await postIn(page, "/api/admin/setlists", { choir: "jm", name: "X", songs: ["esittely"] })).status).toBe(400);
  expect((await postIn(page, "/api/admin/setlists", { choir: "jm", name: "", songs: [] })).status).toBe(400);
  expect((await postIn(page, "/api/admin/setlists", { choir: "nope", name: "X", songs: [] })).status).toBe(400);
  // A setlist of one choir cannot be changed or deleted through another.
  expect((await postIn(page, "/api/admin/setlists", { choir: "public", id, delete: true })).status).toBe(400);
  expect((await postIn(page, "/api/admin/setlists", { choir: "public", id, name: "X", songs: [] })).status).toBe(400);

  const member = await (await browser.newContext()).newPage();
  await signInAs(member, "/c/jm", "laulaja@example.com");
  expect((await postIn(member, "/api/admin/setlists", { choir: "jm", id, delete: true })).status).toBe(403);

  // A browser that came in by link reads the setlists but cannot change them.
  const linked = await (await browser.newContext()).newPage();
  await linked.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  const list = await fetchIn(linked, "/api/songs?choir=jm");
  expect(list.status).toBe(200);
  const songs = await linked.evaluate(async () => ((await (await fetch("/api/songs?choir=jm")).json()) as { setlists: unknown }).setlists);
  expect(songs).toEqual([{ id, name: "Testi", songs: ["kokeilu"] }]);
  expect((await postIn(linked, "/api/admin/setlists", { choir: "jm", id, delete: true })).status).toBe(403);

  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto("/signin");
  expect((await postIn(signedOut, "/api/admin/setlists", { choir: "jm", id, delete: true })).status).toBe(403);

  expect((await postIn(page, "/api/admin/setlists", { choir: "jm", id, delete: true })).status).toBe(200);
});
