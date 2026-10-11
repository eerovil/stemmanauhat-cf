import { describe, expect, it } from "vitest";
import { isPdf, parseRequest, requestPdfKey } from "../../src/worker/requests";

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

it("keeps a request's PDF under requests/<choir>/", () => {
  expect(requestPdfKey("jm", 7)).toBe("requests/jm/7.pdf");
});
