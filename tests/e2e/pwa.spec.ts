import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

test.use({ serviceWorkers: "allow" });

const SHELL = ["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/icon.svg",
  "/manifest.webmanifest", "/offline"];

async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

async function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths.sort();
  });
}

test("Chromium can install the site as an app", async ({ page, context, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#2a5fab");

  const cdp = await context.newCDPSession(page);
  const processed = await cdp.send("Page.getAppManifest");
  const origin = new URL(page.url()).origin;
  expect(processed.errors ?? []).toEqual([]);
  expect(processed.manifest?.name).toBe("Stemmanauhat");
  expect(processed.manifest?.display).toMatch(/standalone/i);
  expect(processed.manifest?.startUrl).toBe(`${origin}/`);
  expect(processed.manifest?.scope).toBe(`${origin}/`);

  for (const icon of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const response = await request.get(icon);
    expect(response.status(), icon).toBe(200);
    expect(response.headers()["content-type"], icon).toContain("image/png");
  }
  await controlled(page);
  // Chrome's own check behind its "Install app" offer.
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  expect(context.serviceWorkers().map((w) => w.url())).toContain(`${origin}/sw.js`);
});

test("the service worker keeps songs out of its cache and the player still plays", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await controlled(page);
  await page.getByRole("link", { name: "Kokeilulaulu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Basso", exact: true }).click();
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("cursor")).not.toHaveAttribute("data-measure", "0", { timeout: 10_000 });
  await page.getByRole("button", { name: "Tauko" }).click();

  // Only the public shell files: no page, API answer, song file or piano.
  expect(await cachedPaths(page)).toEqual(SHELL);
});

test("without a network a page shows the offline page, and comes back", async ({ page, context }) => {
  await page.goto("/c/public");
  await controlled(page);
  await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ei verkkoyhteyttä" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/c/public");

  await context.setOffline(false);
  await page.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
});
