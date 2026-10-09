import { expect, type Page } from "@playwright/test";

export const PASSPHRASE = "testilinkki-jm";

/** Signs in through the fake Google, starting from a page that needs it. */
export async function signInAs(page: Page, path: string, email: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/signin\?/);
  await page.getByRole("link", { name: "Kirjaudu Google-tilillä" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Plays from the start and checks the time and the cursor both move. */
export async function playAndSeeCursorMove(page: Page) {
  const score = page.getByTestId("score");
  await expect(score.locator("svg").first()).toBeVisible();
  const cursor = page.getByTestId("cursor");
  await expect(cursor).toHaveAttribute("data-measure", "0");
  const before = await cursor.evaluate((el) => (el as HTMLElement).style.transform);

  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByRole("button", { name: "Tauko" })).toBeVisible();
  await expect(page.getByTestId("time")).not.toHaveText(/^0:00 /, { timeout: 10_000 });
  await expect(cursor).not.toHaveAttribute("data-measure", "0", { timeout: 10_000 });
  const after = await cursor.evaluate((el) => (el as HTMLElement).style.transform);
  expect(after).not.toBe(before);
  // The sounding notes light up as in the videos: your part full blue, the other lighter.
  await expect(score.locator(".lit-focus").first()).toBeAttached();
  await expect(score.locator(".lit-other").first()).toBeAttached();
  const colours = await score.evaluate((el) => {
    const fill = (selector: string) => {
      const path = el.querySelector(`${selector} path`);
      return path ? getComputedStyle(path).fill : null;
    };
    return { focus: fill(".lit-focus"), other: fill(".lit-other") };
  });
  expect(colours).toEqual({ focus: "rgb(42, 95, 171)", other: "rgb(159, 183, 218)" });
  // The audio itself is moving, not just the page's clock.
  const played = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll("audio")].map((a) => a.currentTime)));
  expect(played).toBeGreaterThan(0.5);
}

/** A fetch from inside the page, so it carries the page's own cookies. */
export async function fetchIn(page: Page, url: string, headers: Record<string, string> = {}) {
  return page.evaluate(async ([u, h]) => {
    const r = await fetch(u, { headers: h, redirect: "manual" });
    const body = await r.arrayBuffer();
    return {
      status: r.status,
      length: body.byteLength,
      range: r.headers.get("Content-Range"),
      type: r.headers.get("Content-Type"),
    };
  }, [url, headers] as const);
}
