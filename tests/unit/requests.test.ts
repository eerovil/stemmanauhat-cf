import { describe, expect, it } from "vitest";
import { isPdf, parseFlag, parseRequest, pdfTitle, requestPdfKey } from "../../src/worker/requests";

describe("parseRequest", () => {
  it("takes a song name alone, or a PDF alone, with every other field optional", () => {
    expect(parseRequest({ title: "  Kesäilta " }, false)).toEqual({ title: "Kesäilta", credits: null, note: null, name: null });
    expect(parseRequest({}, true)).toEqual({ title: null, credits: null, note: null, name: null });
    expect(parseRequest({ title: "A", credits: "säv. B", note: "kevääksi", name: "Matti" }, true))
      .toEqual({ title: "A", credits: "säv. B", note: "kevääksi", name: "Matti" });
  });
  it("refuses a request with neither a song name nor a PDF", () => {
    expect(parseRequest({ title: "   ", note: "jotain" }, false)).toEqual({ error: "Kirjoita kappaleen nimi tai liitä nuotti." });
  });
  it("refuses too long text and ignores what is not text", () => {
    expect(parseRequest({ title: "x".repeat(201) }, false)).toHaveProperty("error");
    expect(parseRequest({ title: "A", note: "x".repeat(1001) }, false)).toHaveProperty("error");
    expect(parseRequest({ title: "A", credits: 5 }, false)).toEqual({ title: "A", credits: null, note: null, name: null });
  });
});

describe("isPdf", () => {
  it("checks the file's first bytes, not its name", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.4\n%%EOF"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
});

describe("pdfTitle", () => {
  it("names a request after its PDF's file name, without the .pdf", () => {
    expect(pdfTitle("Ubi Caritas et Amor.pdf")).toBe("Ubi Caritas et Amor");
    expect(pdfTitle(" Iltatähti.PDF ")).toBe("Iltatähti");
    expect(pdfTitle("nuotti")).toBe("nuotti");
    expect(pdfTitle(".pdf")).toBeNull();
    expect(pdfTitle("")).toBeNull();
    expect(pdfTitle(`${"x".repeat(300)}.pdf`)).toBe("x".repeat(200));
  });
});

it("keeps a request's PDF under requests/<choir>/", () => {
  expect(requestPdfKey("jm", 7)).toBe("requests/jm/7.pdf");
});

describe("parseFlag", () => {
  it("takes problems ticked, or a note alone, with the bar optional", () => {
    expect(parseFlag({ problems: ["lyrics", "notes"], bar: 12, part: "Tenori" }))
      .toEqual({ problems: ["notes", "lyrics"], bar: 12, note: null, name: null, part: "Tenori" });
    expect(parseFlag({ note: "  tahdissa 3 kummallinen sointu ", bar: null }))
      .toEqual({ problems: [], bar: null, note: "tahdissa 3 kummallinen sointu", name: null, part: null });
  });
  it("refuses a flag with neither a problem nor a note", () => {
    expect(parseFlag({ problems: [], bar: 4, note: "  " }))
      .toEqual({ error: "Valitse mikä on vialla tai kirjoita lisätietoja." });
  });
  it("refuses unknown problems, a bad bar, and too long text", () => {
    expect(parseFlag({ problems: ["volume"] })).toHaveProperty("error");
    expect(parseFlag({ problems: "notes" })).toHaveProperty("error");
    for (const bar of [0, 1.5, 1000, "3"]) expect(parseFlag({ problems: ["notes"], bar })).toHaveProperty("error");
    expect(parseFlag({ note: "x".repeat(1001) })).toHaveProperty("error");
  });
});
