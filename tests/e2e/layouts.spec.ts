import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked, PASSPHRASE, withoutSavedWidths } from "./helpers";

/** A request from inside the page, with its session (the test's own request context has none on http). */
function call(page: Page, url: string, method = "GET", body?: unknown): Promise<{ status: number; json: any }> {
  return page.evaluate(async ([u, m, b]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, body] as const);
}

// A long song took half a minute to open on a phone: the one-line view laid the
// whole score out up to three times to even out the bars (#137).

test("bar widths worked out once are saved, and the next opening lays the score out once", async ({ page, browser }) => {
  await withoutSavedWidths(page, "/api/songs/jm/epatasainen");
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/songs/jm/epatasainen/layout") && r.request().method() === "PUT");
  await page.goto("/c/jm/epatasainen");
  await choosePartIfAsked(page, "Tenori");
  const score = page.getByTestId("score");
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  expect((await saved).status()).toBe(200);
  const widths = await score.getAttribute("data-widths");

  // Another singer, another browser: one layout, drawn as wide as the first.
  const other = await browser.newContext({ ...test.info().project.use, baseURL: new URL(page.url()).origin });
  const second = await other.newPage();
  await second.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await second.goto("/c/jm/epatasainen");
  await choosePartIfAsked(second, "Tenori");
  const score2 = second.getByTestId("score");
  await expect(score2).toHaveAttribute("data-layouts", "1");
  await expect(score2).toHaveAttribute("data-widenings", "0");
  expect(await score2.getAttribute("data-widths")).toBe(widths);
  await other.close();
});

test("a wrong saved set is corrected: the bars still come out even", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.goto("/c/jm/epatasainen");
  await choosePartIfAsked(page, "Tenori");
  const score = page.getByTestId("score");
  await expect(score).toHaveAttribute("data-layouts", /\d/);
  const widths = await score.getAttribute("data-widths");
  const song = (await call(page, "/api/songs/jm/epatasainen")).json;
  const [visible, factors] = Object.entries(song.layouts as Record<string, number[]>)[0]!;

  // One bar saved far too wide: it is dropped, not carried into its neighbours by widening
  // from it, so the bars come out just as from the song's own layout.
  const middle = Math.floor(factors.length / 2);
  expect((await call(page, "/api/songs/jm/epatasainen/layout", "PUT",
    { version: song.version, visible, factors: factors.map((f, i) => (i === middle ? 10 : f)) })).status).toBe(200);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  expect(await score.getAttribute("data-widths")).toBe(widths);
  // At most one extra layout for the dropped set, and it is replaced: the next opening is one layout.
  expect(Number(await score.getAttribute("data-layouts"))).toBeLessThanOrEqual(4);
  await expect.poll(async () => (await call(page, "/api/songs/jm/epatasainen")).json.layouts[visible][middle]).toBe(factors[middle]);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(score).toHaveAttribute("data-layouts", "1");
  expect(await score.getAttribute("data-widths")).toBe(widths);

  // Every bar at its natural width: the crowded bar's neighbours are too narrow again.
  const put = await call(page, "/api/songs/jm/epatasainen/layout", "PUT",
    { version: song.version, visible, factors: factors.map(() => 1) });
  expect(put.status).toBe(200);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  expect(Number(await score.getAttribute("data-step"))).toBeLessThanOrEqual(1.3 * 1.05);

  // A set with a bar too many (say, saved before bars were cut differently) is not used at all.
  expect((await call(page, "/api/songs/jm/epatasainen/layout", "PUT",
    { version: song.version, visible, factors: [...factors, 1] })).status).toBe(200);
  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(score).toHaveAttribute("data-widenings", /^[12]$/);
  expect(Number(await score.getAttribute("data-step"))).toBeLessThanOrEqual(1.3 * 1.05);
});

test("a wrong saved set on an even song is replaced, so the next opening is one layout", async ({ page }) => {
  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await page.goto("/c/jm/kokeilu");
  await choosePartIfAsked(page, "Tenori");
  const score = page.getByTestId("score");
  await expect(score).toHaveAttribute("data-layouts", /\d/);
  const widths = await score.getAttribute("data-widths");
  const bars = Number(await score.getAttribute("data-measures"));
  const visible = (await score.getAttribute("data-visible"))!;
  const song = (await call(page, "/api/songs/jm/kokeilu")).json;
  const ones = Array.from({ length: bars }, () => 1);
  expect((await call(page, "/api/songs/jm/kokeilu/layout", "PUT",
    { version: song.version, visible, factors: ones.map((f, i) => (i === 1 ? 10 : f)) })).status).toBe(200);

  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  // The wrong set and then the song's own layout, which needs no widening.
  await expect(score).toHaveAttribute("data-layouts", "2");
  await expect(score).toHaveAttribute("data-widenings", "0");
  expect(await score.getAttribute("data-widths")).toBe(widths);
  await expect.poll(async () => (await call(page, "/api/songs/jm/kokeilu")).json.layouts[visible]).toEqual(ones);

  await page.reload();
  await choosePartIfAsked(page, "Tenori");
  await expect(score).toHaveAttribute("data-layouts", "1");
  expect(await score.getAttribute("data-widths")).toBe(widths);
});

test("the layout route takes only sane widths for the version now published", async ({ page }) => {
  const url = "/api/songs/jm/epatasainen/layout";
  await page.goto("/signin");
  expect((await call(page, url, "PUT", { version: "x", visible: "11", factors: [1] })).status).toBe(401);

  await page.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  const { version } = (await call(page, "/api/songs/jm/epatasainen")).json;
  const put = async (body: unknown) => (await call(page, url, "PUT", body)).status;
  expect(await put({ version: "20250101T000000Z", visible: "11", factors: [1, 1.5] })).toBe(409);
  expect(await put({ version, visible: "12", factors: [1] })).toBe(400);
  expect(await put({ version, visible: "11", factors: [0.5] })).toBe(400);
  expect(await put({ version, visible: "11", factors: [] })).toBe(400);
  expect(await put({ version, visible: "11", factors: ["2"] })).toBe(400);
  expect((await call(page, "/api/songs/naiskuoro/x/layout", "PUT", { version, visible: "11", factors: [1] })).status).toBe(403);
  // The open list: anyone may read it, nobody saves widths for it.
  const open = (await call(page, "/api/songs/public/pitkat-tavut")).json;
  expect((await call(page, "/api/songs/public/pitkat-tavut/layout", "PUT",
    { version: open.version, visible: "11", factors: [1] })).status).toBe(403);
});
