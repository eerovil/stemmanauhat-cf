/**
 * The one-line view's pinned signature: the clef, key and time signature in force
 * stay at the left edge as the line slides, the way every printed line starts with
 * them. A bar that changes one of them also draws the change in the line itself;
 * the pinned copy swaps to the new set as that bar reaches the edge.
 *
 * Everything here is in the drawing's own units (the score's SVG user units, which
 * OSMD lays out at 10 per staff space), so a zoom only scales it.
 */
export type Kind = "clef" | "key" | "time";
export const KINDS: Kind[] = ["clef", "key", "time"];

/** The line's first bar starts its clef here, so the pinned copy lies exactly over it. */
export const LEFT = 25;
/** Space before a key and a time signature, as VexFlow spaces them after the piece before. */
const GAP: Record<Kind, number> = { clef: 0, key: 11, time: 16.5 };
/** Clear room kept between the pinned signature and the music passing under it. */
const RIGHT = 8;

/**
 * Where each kind starts and how wide the whole pinned signature is, given the widest
 * piece of each kind (0 where no staff has one). Staves share a column per kind, so
 * the signs line up down the line even when a clef is wider than another.
 */
export function columns(widths: Record<Kind, number>): { x: Record<Kind, number>; width: number } {
  const x: Record<Kind, number> = { clef: LEFT, key: LEFT, time: LEFT };
  let edge = LEFT;
  let first = true;
  for (const kind of KINDS) {
    if (widths[kind] <= 0) continue;
    x[kind] = first ? LEFT : edge + GAP[kind];
    edge = x[kind] + widths[kind];
    first = false;
  }
  return { x, width: edge + RIGHT };
}

/** A set of signs: `end` is where the bar's own drawing of them ends, `width` how wide the pinned copy is. */
export interface Stamp {
  end: number;
  width: number;
}

/**
 * Which set is pinned when the line is scrolled by `offset` (all in pixels): the last
 * whose own drawing in the line has slid fully under the pinned set it replaces, so
 * the change is seen once going by, then stays. The first always applies. `stamps` is
 * in line order.
 */
export function stampAt(stamps: Stamp[], offset: number): number {
  for (let i = stamps.length - 1; i > 0; i--) {
    if (stamps[i]!.end - offset <= stamps[i - 1]!.width) return i;
  }
  return 0;
}
