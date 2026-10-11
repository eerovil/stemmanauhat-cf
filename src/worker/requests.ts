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

/** What a singer can say is wrong with a published song (#41); the player shows them in Finnish. */
export const FLAG_PROBLEMS = ["notes", "part", "lyrics", "timing", "sound", "other"] as const;
export const FLAG_MAX = { note: 1000, name: 100, part: 50, bar: 999 } as const;

export interface SongFlag {
  problems: string[];
  bar: number | null;
  note: string | null;
  name: string | null;
  part: string | null;
}

/**
 * A flag as the player sent it (JSON). It needs at least one problem ticked or
 * a note (spec D2). Returns the error to show instead when it is not a flag.
 */
export function parseFlag(body: Record<string, unknown>): SongFlag | { error: string } {
  const problems = body.problems ?? [];
  if (!Array.isArray(problems) || !problems.every((p) => (FLAG_PROBLEMS as readonly unknown[]).includes(p))) {
    return { error: "Tuntematon virheen laji." };
  }
  let bar: number | null = null;
  if (body.bar !== undefined && body.bar !== null && body.bar !== "") {
    if (typeof body.bar !== "number" || !Number.isInteger(body.bar) || body.bar < 1 || body.bar > FLAG_MAX.bar) {
      return { error: "Tahdin numero ei kelpaa." };
    }
    bar = body.bar;
  }
  const text: Record<string, string | null> = {};
  for (const key of ["note", "name", "part"] as const) {
    const value = typeof body[key] === "string" ? (body[key] as string).trim() : "";
    if (value.length > FLAG_MAX[key]) return { error: `Liian pitkä teksti (yli ${FLAG_MAX[key]} merkkiä).` };
    text[key] = value || null;
  }
  // In the fixed order, once each, whatever order they were ticked in.
  const ticked = FLAG_PROBLEMS.filter((p) => problems.includes(p));
  if (!ticked.length && !text.note) return { error: "Valitse mikä on vialla tai kirjoita lisätietoja." };
  return { problems: ticked, bar, note: text.note!, name: text.name!, part: text.part! };
}
