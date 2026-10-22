import { expect, test } from "@playwright/test";
import { PASSPHRASE } from "./helpers";

// The site in English and Finnish. The other browser tests run with a
// Finnish browser (playwright.config.ts); these run with an English one.
test.use({ locale: "en-US" });

test("an English browser gets the song list in English, with US dates and English sorting", async ({ page }) => {
  await page.route("**/api/songs?choir=jm", async (route) => {
    const data = await (await route.fetch()).json();
    const song = data.songs[0];
    data.songs = [
      { ...song, slug: "z", title: "Zeta", published_at: "2026-09-01T12:00:00Z" },
      { ...song, slug: "a", title: "Äiti", published_at: "2026-08-01T12:00:00Z" },
      { ...song, slug: "b", title: "Alpha", published_at: "2026-10-05T12:00:00Z" },
    ];
    await route.fulfill({ json: data });
  });
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(page).toHaveURL(/\/c\/jm$/);
  await expect(page).toHaveTitle("Stemmanauhat");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("searchbox", { name: "Search for a song" })).toBeVisible();
  await expect(page.getByText("You came in with the choir's link.")).toBeVisible();

  const titles = page.locator(".songs .song-title");
  // English sorts Ä as A (so Äiti before Alpha); Finnish puts it after Z.
  await expect(titles).toHaveText(["Äiti", "Alpha", "Zeta"]);
  const order = page.getByRole("group", { name: "Order" });
  await order.getByRole("button", { name: "Newest" }).click();
  await expect(page.locator(".songs .date")).toHaveText(["10/5/2026", "9/1/2026", "8/1/2026"]);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  // The site's maker and its source code (#119).
  await expect(page.getByText("Made by Eero Vilpponen")).toBeVisible();
  const source = page.getByRole("link", { name: "Source code" });
  await expect(source).toHaveAttribute("href", "https://github.com/eerovil/stemmanauhat-cf");
  await expect(source).toHaveAttribute("target", "_blank");
});

test("the signed-out front page and sign-in page name the maker and link the source code (#119)", async ({ page }) => {
  await page.goto("/?lang=fi");
  await expect(page.getByText("Tekijä: Eero Vilpponen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lähdekoodi" }))
    .toHaveAttribute("href", "https://github.com/eerovil/stemmanauhat-cf");
  await page.goto("/signin?lang=en");
  await expect(page.getByRole("link", { name: "Source code" })).toBeVisible();
});

test("the language can be switched, is remembered on the device, and ?lang= overrides it", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  const languages = page.getByRole("group", { name: "Language" });
  await expect(page.getByRole("searchbox", { name: "Search for a song" })).toBeVisible();

  await languages.getByRole("button", { name: "FI" }).click();
  await expect(page.getByRole("searchbox", { name: "Hae kappaletta" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fi");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Hae kappaletta" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Kieli" }).getByRole("button", { name: "FI" }))
    .toHaveAttribute("aria-pressed", "true");

  await page.goto("/c/jm?lang=en");
  await expect(page.getByRole("searchbox", { name: "Search for a song" })).toBeVisible();
});

test("the player's part question and settings are in English", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose your part" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Which part do you sing?" })).toBeVisible();
  // The song's "Tenori" shows by its place's English name in the voice tree (#107).
  await dialog.getByRole("button", { name: "Tenor", exact: true }).click();
  await expect(page).toHaveTitle("Kokeilulaulu – Stemmanauhat");
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const listen = page.getByRole("group", { name: "How you listen" });
  // On a narrow phone every mode's label has room on both sides, not just barely fitting (#69).
  await page.setViewportSize({ width: 350, height: 780 });
  for (const button of await listen.getByRole("button").all()) {
    const room = await button.evaluate((b) => {
      const text = document.createRange();
      text.selectNodeContents(b);
      return b.clientWidth - text.getBoundingClientRect().width;
    });
    expect(room).toBeGreaterThanOrEqual(12);
  }
  await expect(listen.getByRole("button", { name: "Mine up front" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Your part loud, the others softer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close settings" })).toBeVisible();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.getByText("Other parts", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Volume of the other parts" })).toBeVisible();
  // The player has no language switch: the language is picked on the other pages.
  await expect(page.getByRole("group", { name: "Language" })).toHaveCount(0);
});

test("the server answers in the page's language", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(page).toHaveURL(/\/c\/jm$/);
  const send = (lang: string) => page.evaluate(async (l) => {
    const form = new FormData();
    form.set("choir", "jm");
    const r = await fetch("/api/requests", { method: "POST", body: form, headers: { "X-Stemmanauhat": "1", "X-Lang": l } });
    return { status: r.status, body: (await r.json()) as { error?: string } };
  }, lang);
  expect(await send("en")).toEqual({ status: 400, body: { error: "Give the song's name or attach the music." } });
  expect(await send("fi")).toEqual({ status: 400, body: { error: "Kirjoita kappaleen nimi tai liitä nuotti." } });
});
