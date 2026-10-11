/** A singer's request for a new practice track (#38): checking what the form sent. */

export const REQUEST_MAX = { title: 200, credits: 200, note: 1000, name: 100 } as const;
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export interface SongRequest {
  title: string | null;
  credits: string | null;
  note: string | null;
  name: string | null;
}

/** A PDF starts with `%PDF-`, whatever the browser said its type was. */
export function isPdf(bytes: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => bytes[i] === byte);
}

/**
 * The form's text fields, trimmed, with empty ones as null. Every field is
 * optional, but a request needs a song name or a PDF (Eero, #38).
 * Returns the error to show instead when it is not a request.
 */
export function parseRequest(fields: Record<string, unknown>, hasPdf: boolean): SongRequest | { error: string } {
  const out: Record<string, string | null> = {};
  for (const [key, max] of Object.entries(REQUEST_MAX)) {
    const value = typeof fields[key] === "string" ? (fields[key] as string).trim() : "";
    if (value.length > max) return { error: `Liian pitkä teksti (yli ${max} merkkiä).` };
    out[key] = value || null;
  }
  if (!out.title && !hasPdf) return { error: "Kirjoita kappaleen nimi tai liitä nuotti." };
  return out as unknown as SongRequest;
}

export function requestPdfKey(choir: string, id: number): string {
  return `requests/${choir}/${id}.pdf`;
}
