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
  // A PDF alone is a request, named after its file (#77); a typed name wins.
  const pdfOnly = await sendIn(page, { choir: "jm" }, PDF);
  expect(pdfOnly.status).toBe(200);
  const named = await sendIn(page, { choir: "jm", title: "Kesäilta" }, PDF);
  expect(named.status).toBe(200);
  const titles = await page.evaluate(async () =>
    ((await (await fetch("/api/songs?choir=jm")).json()) as { requests: { title: string | null }[] }).requests
      .map((r) => r.title));
  expect(titles).toEqual(expect.arrayContaining(["nuotti", "Kesäilta"]));
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
  expect(await postIn(admin, "/api/admin/requests", { id: named.body.id, delete: true })).toBe(200);
});

test("the request form names the song after the PDF and says when it is too big (#77)", async ({ page }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  const file = page.getByLabel("Nuotti (PDF, vapaaehtoinen)");
  const name = page.getByLabel("Kappaleen nimi");
  await file.setInputFiles({ name: "Ubi Caritas et Amor.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await expect(name).toHaveValue("Ubi Caritas et Amor");
  // Another file replaces a name a file gave; a name typed in stays.
  await file.setInputFiles({ name: "Iltatähti.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await expect(name).toHaveValue("Iltatähti");
  await name.fill("Kesäilta");
  await file.setInputFiles({ name: "toinen.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await expect(name).toHaveValue("Kesäilta");

  // One file is listed too, and can be removed.
  await expect(page.locator(".pdf-list .pdf-name")).toHaveText(["toinen"]);
  await page.getByRole("button", { name: "Poista toinen" }).click();
  await expect(page.locator(".pdf-list")).toHaveCount(0);
  await expect(file).toHaveValue("");

  // A name typed for one file belongs to no file once several are chosen and
  // all but one are removed: that one names it again.
  await file.setInputFiles([
    { name: "Aamu.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) },
    { name: "Ilta.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) }]);
  await expect(name).toHaveCount(0);
  await page.getByRole("button", { name: "Poista Aamu" }).click();
  await expect(name).toHaveValue("Ilta");

  // Over 20 MB: said at once, nothing sent.
  let sent = 0;
  await page.route("/api/requests", (route) => { sent++; return route.fulfill({ status: 413, body: "<html>413</html>" }); });
  await file.setInputFiles({ name: "iso.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("PDF on liian suuri (yli 20 Mt).")).toBeVisible();
  expect(sent).toBe(0);
  // A 413 from the proxy in front reads the same, not "HTTP 413".
  await file.setInputFiles({ name: "valssi.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect.poll(() => sent).toBe(1);
  await expect(page.getByText("PDF on liian suuri (yli 20 Mt).")).toBeVisible();
  await expect(page.getByText("HTTP 413")).toHaveCount(0);
});

test("several PDFs at once: one request each, named after its file, with the note copied (#77)", async ({ page, browser }) => {
  await signInAs(page, "/c/jm", "laulaja@example.com");
  await page.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  const file = page.getByLabel("Nuotti (PDF, vapaaehtoinen)");
  const pdf = (name: string, size?: number) =>
    ({ name, mimeType: "application/pdf", buffer: size ? Buffer.alloc(size) : Buffer.from(PDF) });

  // More than ten: refused, none kept.
  await file.setInputFiles(Array.from({ length: 11 }, (_, i) => pdf(`laulu ${i + 1}.pdf`)));
  await expect(page.getByText("Enintään 10 nuottia kerrallaan.")).toBeVisible();
  await expect(page.locator(".pdf-list")).toHaveCount(0);

  // Several: the name and composer fields go, the files are listed, one can be removed.
  await file.setInputFiles([pdf("Aamulaulu.pdf"), pdf("Iltalaulu.pdf"), pdf("Väärä.pdf"),
    pdf("Liian iso.pdf", 20 * 1024 * 1024 + 1)]);
  await expect(page.getByLabel("Kappaleen nimi")).toHaveCount(0);
  await expect(page.getByLabel("Säveltäjä / sovittaja")).toHaveCount(0);
  await expect(page.locator(".pdf-list li")).toHaveCount(4);
  await page.getByRole("button", { name: "Poista Väärä" }).click();
  await expect(page.locator(".pdf-list .pdf-name")).toHaveText(["Aamulaulu", "Iltalaulu", "Liian iso"]);
  await page.getByLabel("Lisätietoja").fill("Syyskonserttiin");

  // The too-big one stays behind with its reason; the others are sent.
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByText("2/3 lähetetty.", { exact: false })).toBeVisible();
  await expect(page.locator(".pdf-list li")).toHaveCount(1);
  await expect(page.locator(".pdf-list li")).toContainText("Liian iso");
  await expect(page.locator(".pdf-list li")).toContainText("PDF on liian suuri (yli 20 Mt).");
  // Down to one file, the form is the single-song one again.
  await expect(page.getByLabel("Kappaleen nimi")).toHaveValue("Liian iso");
  await page.getByRole("button", { name: "Peru", exact: true }).click();
  const pending = page.locator(".requested li");
  await expect(pending).toHaveCount(2);
  await expect(pending.filter({ hasText: "Aamulaulu" })).toContainText("Syyskonserttiin");
  await expect(pending.filter({ hasText: "Iltalaulu" })).toContainText("Syyskonserttiin");

  // Sending two that both go closes the form. While they go up, nothing in the
  // form can be cancelled or changed, so no batch carries on unseen.
  await page.getByRole("button", { name: "Pyydä stemmanauhaa" }).click();
  await file.setInputFiles([pdf("Kolmas.pdf"), pdf("Neljäs.pdf")]);
  await page.getByLabel("Lisätietoja").fill("Joulukonserttiin");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("/api/requests", async (route) => { await held; await route.continue(); });
  await page.getByRole("button", { name: "Lähetä" }).click();
  await expect(page.getByRole("button", { name: "Peru", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Lähetä" })).toBeDisabled();
  await expect(file).toBeDisabled();
  await expect(page.getByRole("button", { name: "Poista Kolmas" })).toBeDisabled();
  // Nor the note, which goes the same to every song in the batch.
  await expect(page.getByLabel("Lisätietoja")).toBeDisabled();
  release();
  await expect(page.getByText("Kiitos! 2 pyyntöä lähetetty.")).toBeVisible();
  await page.unroute("/api/requests");
  await expect(pending).toHaveCount(4);
  await expect(pending.filter({ hasText: "Kolmas" })).toContainText("Joulukonserttiin");
  await expect(pending.filter({ hasText: "Neljäs" })).toContainText("Joulukonserttiin");

  // Leave no request behind for the other tests.
  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, "/admin", "yllapito@example.com");
  for (const title of ["Aamulaulu", "Iltalaulu", "Kolmas", "Neljäs"]) {
    admin.once("dialog", (dialog) => dialog.accept());
    const row = admin.locator('[data-choir="jm"] .request-list li', { hasText: title });
    await row.getByRole("button", { name: "Poista" }).click();
    await expect(row).toHaveCount(0);
  }
});
