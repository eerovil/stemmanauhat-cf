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

  // Each tab is a visit; pages within one count once. The fourth visit shows nothing.
  const other = await browser.newContext({ locale: "fi-FI" });
  for (let visit = 1; visit <= 4; visit++) {
    const tab = await other.newPage();
    await tab.goto("/c/public");
    await offerInstall(tab);
    await expect(tab.getByText(TEXT)).toHaveCount(visit <= 3 ? 1 : 0);
    if (visit === 1) {
      await tab.reload();
      await offerInstall(tab);
      await expect(tab.getByText(TEXT)).toHaveCount(1);
    }
    await tab.close();
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
    const events: string[] = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/events")) events.push(JSON.parse(r.postData() ?? "{}").name); });
    await page.goto("/c/public");
    await offerInstall(page);
    await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
    await expect(page.locator(".install")).toHaveCount(0);
    // An open of the installed app tells it was installed, where iPhones say nothing else.
    await expect.poll(() => events).toContain("app_open");
    await context.close();
  }
});
