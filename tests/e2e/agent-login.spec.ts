import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { choosePartIfAsked, fetchIn, playAndSeeCursorMove } from "./helpers";

/** AGENT_LOGIN_SECRET in playwright.config.ts. */
const AGENT_KEY = "test-agent-key-not-real";

/** A login link from scripts/agent-login.sh, for this test server (#79). */
function agentLink(origin: string, ...args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-login-"));
  writeFileSync(join(dir, "key"), AGENT_KEY);
  return execFileSync("bash", ["scripts/agent-login.sh", "--local", origin, ...args],
    { env: { ...process.env, STEMMANAUHAT_AGENT_KEY: join(dir, "key") } }).toString().trim();
}

test("an agent's login link opens a choir's song as a singer, and nothing more", async ({ page, baseURL }) => {
  await page.goto(agentLink(baseURL!, "jm", "--next", "/c/jm/kokeilu"));
  await expect(page).toHaveURL(/\/c\/jm\/kokeilu$/);
  await choosePartIfAsked(page, "Tenori");
  await page.getByRole("button", { name: "Selvä" }).click();
  await playAndSeeCursorMove(page);

  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ choirs: { id: string }[] }>);
  expect(me).toMatchObject({ email: null, agent: true, admin: false });
  expect(me.choirs.map((c) => c.id)).toContain("jm");

  expect((await fetchIn(page, "/api/songs?choir=naiskuoro")).status).toBe(403);
  expect((await fetchIn(page, "/api/songs?choir=testi")).status).toBe(403);
  expect((await fetchIn(page, "/api/admin")).status).toBe(403);
  const sent = await page.evaluate(async () =>
    (await fetch("/api/requests", { method: "POST", body: new FormData() })).status);
  expect(sent).toBe(403);
});
