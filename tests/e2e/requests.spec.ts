import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE, signInAs } from "./helpers";

const PDF = "%PDF-1.4\n% synthetic test sheet music\n%%EOF\n";

/** A multipart POST from inside the page, with its cookies. */
async function sendIn(page: Page, fields: Record<string, string>, pdf: string | null, header = true) {
  return page.evaluate(async ([f, p, h]) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.set(k, v);
    if (p !== null) form.set("pdf", new Blob([p], { type: "application/pdf" }), "nuotti.pdf");
    const r = await fetch("/api/requests", { method: "POST", body: form, headers: h ? { "X-Stemmanauhat": "1" } : {} });
    return { status: r.status, body: (await r.json()) as { id?: number; error?: string } };
  }, [fields, pdf, header] as const);
}

async function postIn(page: Page, url: string, body: unknown) {
  return page.evaluate(async ([u, b]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return r.status;
  }, [url, body] as const);
}

async function getIn(page: Page, url: string) {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get("Content-Type"), text: await r.text() };
  }, url);
}

test("a singer asks for a practice track with a PDF, others see it, and an admin marks it done", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  // Neither a name nor a PDF: the form says what it needs.
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("Kirjoita kappaleen nimi tai liitä nuotti.")).toBeVisible();
  // A signed-in singer is not asked for their name.
  await expect(page.getByLabel("Nimesi")).toHaveCount(0);
  await page.getByLabel("Kappaleen nimi").fill("Kesäillan valssi");
  await page.getByLabel("Säveltäjä / sovittaja").fill("säv. Aino Esimerkki");
  await page.getByLabel("Lisätietoja").fill("Kevätkonserttiin");
  await page.getByLabel("Nuotti (PDF, vapaaehtoinen)").setInputFiles(
    { name: "valssi.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("Kiitos! Pyyntö lähetetty.")).toBeVisible();
  const pending = page.locator(".requested li");
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText("Kesäillan valssi");
  await expect(pending).toContainText("säv. Aino Esimerkki · Kevätkonserttiin");

  // Someone who came by link sees it too, and sends one with only a name.
  const linked = await (await browser.newContext()).newPage();
  await linked.goto(`/?user=jm&passphrase=${PASSPHRASE}`);
  await expect(linked.getByRole("heading", { name: "Pyydetyt (1)" })).toBeVisible();
  await linked.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  await linked.getByLabel("Kappaleen nimi").fill("Iltatähti");
  await linked.getByLabel("Nimesi").fill("Matti M.");
  await linked.getByRole("button", { name: "Lähetä" }).click();
  await expect(linked.getByRole("heading", { name: "Pyydetyt (2)" })).toBeVisible();
  // Singers never see who asked.
  await expect(linked.locator(".requests")).not.toContainText("laulaja@example.com");

  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/c/jm", "yllapito@example.com");
  await admin.getByRole("link", { name: "Pyyntöjä: 2" }).click();
  const jm = admin.locator('[data-choir="jm"]');
  await expect(jm.getByRole("heading", { name: "Pyynnöt (2)" })).toBeVisible();
  const valssi = jm.locator(".request-list li", { hasText: "Kesäillan valssi" });
  await expect(valssi).toContainText("laulaja@example.com");
  await expect(jm.locator(".request-list li", { hasText: "Iltatähti" })).toContainText("Matti M.");
  const href = await valssi.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await getIn(admin, href!);
  expect(pdf).toEqual({ status: 200, type: "application/pdf", text: PDF });
  // Only admins get the PDF.
  expect((await getIn(page, href!)).status).toBe(403);

  await valssi.getByRole("button", { name: "Tehty" }).click();
  await expect(jm.getByRole("heading", { name: "Pyynnöt (1)" })).toBeVisible();
  await expect(valssi).toHaveClass(/done/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pyydetyt (1)" })).toBeVisible();
  await expect(page.locator(".requested li")).toContainText("Iltatähti");

  admin.once("dialog", (dialog) => dialog.accept());
  await valssi.getByRole("button", { name: "Poista" }).click();
  await expect(jm.getByText("Pyyntö poistettu.")).toBeVisible();
  expect((await getIn(admin, href!)).status).toBe(404);
  // Leave no request behind for the other tests.
  admin.once("dialog", (dialog) => dialog.accept());
  await jm.locator(".request-list li", { hasText: "Iltatähti" }).getByRole("button", { name: "Poista" }).click();
  await expect(jm.getByText("Ei pyyntöjä.")).toBeVisible();
});

test("requests: who may send them, what they must hold, and who may manage them", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  // A PDF alone is a request.
  const pdfOnly = await sendIn(page, { choir: "jm" }, PDF);
  expect(pdfOnly.status).toBe(200);
  expect((await sendIn(page, { choir: "jm", note: "jotain" }, null)).status).toBe(400);
  expect((await sendIn(page, { choir: "jm", title: "X" }, "<html>not a pdf</html>")).body.error).toBe("Liite ei ole PDF.");
  // Without the custom header (a cross-site form could send this), refused.
  expect((await sendIn(page, { choir: "jm", title: "X" }, null, false)).status).toBe(403);
  // Not their choir, the open list, and no choir at all.
  expect((await sendIn(page, { choir: "naiskuoro", title: "X" }, null)).status).toBe(403);
  expect((await sendIn(page, { choir: "public", title: "X" }, null)).status).toBe(403);
  expect((await sendIn(page, { choir: "nope", title: "X" }, null)).status).toBe(404);
  // The open list shows no request button.
  await page.goto("/c/public");
  await expect(page.locator(".songs li a").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pyydä stemmanauhaa" })).toHaveCount(0);

  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto("/signin");
  expect((await sendIn(signedOut, { choir: "jm", title: "X" }, null)).status).toBe(401);

  // A singer can't mark done or delete; an admin can.
  const id = pdfOnly.body.id!;
  expect(await postIn(page, "/api/admin/requests", { id, delete: true })).toBe(403);
  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  expect(await postIn(admin, "/api/admin/requests", { id: 99999, done: true })).toBe(400);
  expect((await getIn(admin, `/api/admin/requests/${id}/pdf`)).text).toBe(PDF);
  expect(await postIn(admin, "/api/admin/requests", { id, delete: true })).toBe(200);
  expect((await getIn(admin, `/api/admin/requests/${id}/pdf`)).status).toBe(404);
});
