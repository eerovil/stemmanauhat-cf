/**
 * Saved bar widths for the one-line view (#137): see migrations/0010_song_layouts.sql.
 * A wrong set does no lasting harm: the player checks the bars after laying them out
 * and widens again if they are uneven, as it did before any were saved.
 */

/** The most bars a saved set may have; Katedralen, the longest song, has 351. */
export const MAX_BARS = 5000;
/** The widest factor accepted; a bar is never widened anywhere near this much. */
export const MAX_FACTOR = 50;

export interface Layout {
  version: string;
  visible: string;
  factors: number[];
}

/** A layout sent by the player, or why it is refused. */
export function parseLayout(body: unknown): Layout | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "bad JSON" };
  const { version, visible, factors } = body as Record<string, unknown>;
  if (typeof version !== "string" || version === "") return { error: "version" };
  if (typeof visible !== "string" || !/^[01]{1,64}$/.test(visible)) return { error: "visible" };
  if (!Array.isArray(factors) || factors.length === 0 || factors.length > MAX_BARS
    || !factors.every((f) => typeof f === "number" && Number.isFinite(f) && f >= 1 && f <= MAX_FACTOR)) {
    return { error: "factors" };
  }
  return { version, visible, factors };
}

/** The saved rows as the song info carries them: `{ "<visible>": [factors] }`; a broken row is left out. */
export function layoutMap(rows: { visible: string; factors: string }[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const row of rows) {
    try {
      const factors: unknown = JSON.parse(row.factors);
      if (Array.isArray(factors) && factors.every((f) => typeof f === "number")) out[row.visible] = factors;
    } catch {
      // Left out: the player then lays the score out as before.
    }
  }
  return out;
}
