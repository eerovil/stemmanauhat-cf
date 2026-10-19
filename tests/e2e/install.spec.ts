import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

// The song list's notice that the site can be installed as an app (#91): the browser's own
// install prompt where there is one, a how-to on iPhones, never in the installed app, and
// gone for good once dismissed or installed.

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
  + "Version/18.0 Mobile/15E148 Safari/604.1";
const TEXT = "Asenna Stemmanauhat puhelimeesi sovellukseksi";
const IOS_TEXT = "napauta Jaa ja valitse Lisää Koti-valikkoon";

/** Offers the page an install prompt as Chrome would; `outcome` is what the singer picks in it. */
async function offerInstall(page: Page, outcome: "accepted" | "dismissed" = "accepted") {
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.evaluate((outcome) => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { (window as unknown as { prompted: boolean }).prompted = true; },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

/** The usage events the page sends, as name and choir. */
function recordEvents(page: Page): { name: string; choir: string }[] {
  const events: { name: string; choir: string }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/events")) return;
    const { name, choir } = JSON.parse(r.postData() ?? "{}");
    events.push({ name, choir });
  });
  return events;
}

async function usage(page: Page): Promise<{ sawInstall: number; installed: number }> {
  const data = await page.evaluate(async () => (await fetch("/api/admin")).json()) as
    { usage: { id: string; sawInstall: number; installed: number }[] };
  const row = data.usage.find((u) => u.id === "public");
  return { sawInstall: row?.sawInstall ?? 0, installed: row?.installed ?? 0 };
}

test("Chrome's install prompt: the notice opens it, and once installed it is gone; the admin page counts both", async ({ page, browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  await expect(admin.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  const before = await usage(admin);

  // A Google account no other test uses, so each count grows by exactly one.
  await signInAs(page, "/c/jm", "asentaja@example.com");
  await expect(page.getByText("asentaja@example.com")).toBeVisible();
  await page.goto("/c/public");
  await expect(page.getByRole("searchbox")).toBeVisible();
  // No prompt from the browser, no notice.
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await offerInstall(page);
  const notice = page.locator(".install");
  await expect(notice).toContainText(TEXT);
  await notice.getByRole("button", { name: "Asenna" }).click();
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);

  // Installed: not again, even when the browser offers it again.
  await page.reload();
  await offerInstall(page);
  await expect(page.getByText(TEXT)).toHaveCount(0);

  await expect.poll(async () => usage(admin)).toEqual({ sawInstall: before.sawInstall + 1, installed: before.installed + 1 });
  await adminContext.close();
});

test("dismissed, the notice never comes back; nor after a few visits", async ({ browser }) => {
  const context = await browser.newContext({ locale: "fi-FI" });
  const page = await context.newPage();
  await page.goto("/c/public");
  await offerInstall(page);
  await page.locator(".install").getByRole("button", { name: "Ei nyt" }).click();
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await page.reload();
  await offerInstall(page);
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await context.close();

  // Three showings at most, whether by reloading, coming back from a song or a new tab.
  const other = await browser.newContext({ locale: "fi-FI" });
  const tab = await other.newPage();
  await tab.goto("/c/public");
  await offerInstall(tab);
  await expect(tab.getByText(TEXT)).toHaveCount(1);
  await tab.reload();
  await offerInstall(tab);
  await expect(tab.getByText(TEXT)).toHaveCount(1);
  await tab.getByRole("link", { name: "Esittelylaulu" }).click();
  await expect(tab).toHaveURL(/\/c\/public\/esittely/);
  await tab.goBack();
  await offerInstall(tab);
  await expect(tab.getByText(TEXT)).toHaveCount(1);
  for (const page of [tab, await other.newPage()]) {
    await (page === tab ? page.reload() : page.goto("/c/public"));
    await offerInstall(page);
    await expect(page.getByText(TEXT)).toHaveCount(0);
  }
  await other.close();
});

test("an iPhone is told how: Share, then Add to Home Screen", async ({ browser }) => {
  const context = await browser.newContext({ locale: "fi-FI", userAgent: IPHONE, viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/c/public");
  const notice = page.locator(".install");
  await expect(notice).toContainText(IOS_TEXT);
  await expect(notice.getByRole("button", { name: "Asenna" })).toHaveCount(0);
  await notice.getByRole("button", { name: "Selvä" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await expect(page.getByText(IOS_TEXT)).toHaveCount(0);
  await context.close();
});

test("the installed app never shows the notice", async ({ browser }) => {
  for (const standalone of [
    // iPhone's home screen app…
    () => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }),
    // …and Chrome's installed app.
    () => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => (query === "(display-mode: standalone)"
        ? { ...real(query), matches: true, media: query } as MediaQueryList : real(query));
    },
  ]) {
    const context = await browser.newContext({ locale: "fi-FI", userAgent: IPHONE });
    await context.addInitScript(standalone);
    const page = await context.newPage();
    const events = recordEvents(page);
    // The installed app starts on the front page; a song opened from there, with no song
    // list on the way, counts as using the app.
    await page.goto("/");
    await page.getByRole("link", { name: "Esittelylaulu" }).click();
    await expect(page).toHaveURL(/\/c\/public\/esittely/);
    await expect.poll(() => events).toContainEqual({ name: "app_open", choir: "public" });
    await page.goto("/c/public");
    await offerInstall(page);
    await expect(page.getByRole("link", { name: /^Esittelylaulu/ })).toBeVisible();
    await expect(page.locator(".install")).toHaveCount(0);
    // Once per visit for each choir.
    expect(events.filter((e) => e.name === "app_open")).toHaveLength(1);
    await context.close();
  }
});

test("an install from the browser's own menu is counted too", async ({ page, browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  await expect(admin.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  const before = await usage(admin);

  await signInAs(page, "/c/jm", "valikkoasentaja@example.com");
  await expect(page.getByText("valikkoasentaja@example.com")).toBeVisible();
  await page.goto("/c/public");
  await offerInstall(page);
  await expect(page.locator(".install")).toBeVisible();
  // Installed from Chrome's menu, not the card's button.
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.locator(".install")).toHaveCount(0);
  await expect.poll(async () => usage(admin)).toEqual({ sawInstall: before.sawInstall + 1, installed: before.installed + 1 });
  await adminContext.close();
});

test("each choir's list counts its own showing, also in one tab", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  const events = recordEvents(page);
  await offerInstall(page);
  await expect(page.locator(".install")).toBeVisible();
  await page.goto("/c/public");
  await offerInstall(page);
  await expect(page.locator(".install")).toBeVisible();
  await expect.poll(() => events.filter((e) => e.name === "install_shown").map((e) => e.choir)).toEqual(["jm", "public"]);
});
