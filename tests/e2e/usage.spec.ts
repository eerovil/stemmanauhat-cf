import { expect, test, type Page } from "@playwright/test";
import { choosePartIfAsked, gains, signInAs } from "./helpers";

// Usage events (eerovil/eeron-omat-taskit#72): every listen and who listened, the steps
// towards the singing, and settings changes, counted on the admin page. Other test
// files open the same songs, so this one compares counts before and after.

interface Usage { id: string; people: number; songOpens: number; settingsOpens: number; choseSung: number;
  playedSung: number; playedSungMinute: number }
interface AdminState {
  usage: Usage[];
  settings: { setting: string; changedBy: number }[];
  listens: { email: string | null; admin: boolean; song: string | null; value: string; seconds: number }[];
}

async function adminState(page: Page): Promise<AdminState> {
  const { status, text } = await page.evaluate(async () => {
    const r = await fetch("/api/admin");
    return { status: r.status, text: await r.text() };
  });
  expect(status, (text.match(/(D1_|SQLITE|TypeError|Error:)[^<]{0,400}/g) ?? [text.slice(0, 300)]).join(" | ")).toBe(200);
  return JSON.parse(text) as AdminState;
}
const publicUsage = (state: AdminState) => state.usage.find((u) => u.id === "public")
  ?? { people: 0, songOpens: 0, settingsOpens: 0, choseSung: 0, playedSung: 0, playedSungMinute: 0 };
const changedBy = (state: AdminState, setting: string) => state.settings.find((s) => s.setting === setting)!.changedBy;
const post = (page: Page, body: object) => page.evaluate(async (b) =>
  (await fetch("/api/events", { method: "POST", body: JSON.stringify(b) })).status, body);

test("a singer's way to the singing, their listens and their settings show on the admin page", async ({ page, browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  await expect(admin.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  const before = await adminState(admin);

  // A Google account no other test uses, so every count grows by exactly one. The open list
  // needs no membership: signing in on a choir page refuses the choir but keeps the account.
  await signInAs(page, "/c/jm", "kuuntelija@example.com");
  await expect(page.getByText("kuuntelija@example.com")).toBeVisible();
  await page.goto("/c/public/laulettu");
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await page.getByRole("button", { name: "Säädöt" }).click();
  await page.getByRole("group", { name: "Ääni" }).getByRole("button", { name: "Laulu" }).click();
  await expect(gains(page)).toHaveAttribute("data-player", "sung");
  // Three quick taps on the tempo are one change, sent with the value it ended on.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Hitaammin" }).click();
  await page.getByRole("button", { name: "Sulje säädöt" }).click();
  await page.getByRole("button", { name: "Soita" }).click();
  await expect(page.getByTestId("time")).toHaveText(/0:0[4-9]/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Tauko" }).click();

  // A listen is saved again each minute under one id: the row grows, it does not double.
  const visitor = await page.evaluate(() => localStorage.getItem("stemmanauhat:visitor"));
  expect(visitor).toMatch(/^[0-9a-f-]{36}$/);
  const listen = "2d8b6e3a-3f4c-4e5d-9a0b-9c8d7e6f5a4b";
  const settings = { mode: "focus", others: "0.4", rate: "1", staves: "all", zoom: "1", sound: "sung" };
  const minute = { visitor, choir: "public", song: "laulettu", part: "Tenori", sung: 1, name: "listen", value: "sung",
    listen, settings, email: "someone.else@example.com" };
  expect(await post(page, { ...minute, seconds: 60 })).toBe(204);
  expect(await post(page, { ...minute, seconds: 75 })).toBe(204);
  // Junk and choirs this singer cannot open are dropped, with the same quiet answer.
  expect(await post(page, { visitor, choir: "public", name: "page_view" })).toBe(204);
  expect(await post(page, { visitor, choir: "naiskuoro", song: "jaettu", name: "song_open", sung: 1 })).toBe(204);

  // The tempo change settles after two seconds.
  await expect.poll(async () => changedBy(await adminState(admin), "rate"), { timeout: 10_000 })
    .toBe(changedBy(before, "rate") + 1);
  const after = await adminState(admin);
  const [was, now] = [publicUsage(before), publicUsage(after)];
  for (const key of ["people", "songOpens", "settingsOpens", "choseSung", "playedSung", "playedSungMinute"] as const) {
    expect(now[key], key).toBe(was[key] + 1);
  }
  expect(changedBy(after, "sound")).toBe(changedBy(before, "sound") + 1);
  expect(after.usage.find((u) => u.id === "naiskuoro")).toEqual(before.usage.find((u) => u.id === "naiskuoro"));
  const mine = after.listens.filter((l) => l.email === "kuuntelija@example.com");
  expect(mine.map((l) => [l.song, l.value, l.admin])).toEqual([["laulettu", "sung", false], ["laulettu", "sung", false]]);
  expect(mine.map((l) => l.seconds).sort((a, b) => a - b)).toEqual([expect.any(Number), 75]);
  expect(mine.some((l) => l.seconds >= 3 && l.seconds < 60)).toBe(true);
  expect(after.listens.some((l) => l.email === "someone.else@example.com")).toBe(false);

  // An admin's own visit is kept, but not counted.
  await admin.goto("/c/public/laulettu");
  await choosePartIfAsked(admin, "Tenori");
  await admin.goto("/admin");
  await expect(admin.locator('[data-usage="public"] [data-line="playedSungMinute"]')).toContainText(String(now.playedSungMinute));
  expect(publicUsage(await adminState(admin)).songOpens).toBe(now.songOpens);
  await admin.getByText("Viimeisimmät kuuntelut").click();
  await expect(admin.locator(".latest-listens li").filter({ hasText: "kuuntelija@example.com" }).first())
    .toContainText("Laulettu laulu · Tenori · Laulu");
  await adminContext.close();
});

test("the song list puts the songs most people listened to lately first, by default (#89)", async ({ page, browser }) => {
  // On the open list, as link visitors do: each visitor id is one person.
  await page.goto("/c/public");
  await expect(page.getByRole("link", { name: "Esittelylaulu" })).toBeVisible();
  const listen = (song: string, seconds: number) => ({ visitor: crypto.randomUUID(), choir: "public", song,
    part: "Tenori", sung: 0, name: "listen", value: "piano", listen: crypto.randomUUID(), seconds,
    settings: { mode: "focus", others: "0.4", rate: "1", staves: "all", zoom: "1", sound: "piano" } });
  // Five people for Vapaa rytmi; two for Laulettu laulu (the other test adds one more).
  for (let i = 0; i < 5; i++) expect(await post(page, listen("vapaa-rytmi", 40))).toBe(204);
  expect(await post(page, listen("laulettu", 30))).toBe(204);
  // One person replaying Laulettu laulu is still one person.
  const again = listen("laulettu", 30);
  for (let i = 0; i < 3; i++) expect(await post(page, { ...again, listen: crypto.randomUUID() })).toBe(204);
  // Plays under 30 seconds and an admin's listens don't count.
  for (let i = 0; i < 5; i++) expect(await post(page, listen("esittely", 29))).toBe(204);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  await expect(admin.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  for (let i = 0; i < 5; i++) expect(await post(admin, listen("esittely", 600))).toBe(204);
  await adminContext.close();

  // The list tells only the order: no counts, no names. Pitkä laulu (#104 of eeron-omat-taskit) has no listens.
  const body = await page.evaluate(async () => (await fetch("/api/songs?choir=public")).json() as Promise<{ popular: string[][] }>);
  expect(body.popular.slice(0, 2)).toEqual([["vapaa-rytmi"], ["laulettu"]]);
  expect(body.popular.flat()).not.toContain("esittely");

  await page.reload();
  const order = page.getByRole("group", { name: "Järjestys" });
  await expect(order.getByRole("button", { name: "Suositut" })).toHaveAttribute("aria-pressed", "true");
  const titles = page.locator(".songs .song-title");
  await expect(titles).toHaveText(["Vapaa rytmi", "Laulettu laulu", "Esittelylaulu", "Pitkä laulu"]);
  await order.getByRole("button", { name: "Nimi" }).click();
  await expect(titles).toHaveText(["Esittelylaulu", "Laulettu laulu", "Pitkä laulu", "Vapaa rytmi"]);
  await page.reload();
  await expect(order.getByRole("button", { name: "Nimi" })).toHaveAttribute("aria-pressed", "true");
  await order.getByRole("button", { name: "Suositut" }).click();
  await expect(titles).toHaveText(["Vapaa rytmi", "Laulettu laulu", "Esittelylaulu", "Pitkä laulu"]);
});
