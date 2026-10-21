/**
 * A place in the voice tree (#107, the `voices` table): group, voice, divided part, its upper or
 * lower half. Each place lists every name it goes by ("Basso 2", "Bass 2", "B2").
 */
export interface Voice {
  id: string;
  parent: string | null;
  /** What the player shows for every part at this place, whatever the song calls it. */
  fi: string;
  en: string;
  names: string[];
}

/** How deep the tree goes: Miehet › Basso › Basso 2 › Upper bass 2. */
const MAX_DEPTH = 4;

/** Names are the same when they differ only in letter case and spaces. */
const norm = (name: string) => name.toLowerCase().replace(/\s+/g, "");

/**
 * Where a part name sits in the tree, as the ids from the top down ("Basso 2" → men, B, B2), or
 * null for a name not in it ("Tenori solo"), which then matches only itself. A split part ("S1b",
 * "Tenorib", eerovil/stemmanauhat-cf#39) sits just below the name without its "b". A row deeper
 * than four levels, or whose parents are missing or loop, is left out.
 */
export function placeOf(name: string, voices: Voice[]): string[] | null {
  const key = norm(name);
  // The first row with this name whose place is whole: a row too deep or cut off is left out.
  const at = (k: string) => voices.filter((v) => v.names.some((n) => norm(n) === k))
    .map((v) => pathOf(v, voices)).find((path) => path !== null) ?? null;
  const path = at(key);
  if (path) return path;
  const above = key.length > 1 && key.endsWith("b") ? at(key.slice(0, -1)) : null;
  if (above && above.length < MAX_DEPTH) return [...above, `${above.at(-1)}+b`];
  return null;
}

function pathOf(voice: Voice, voices: Voice[]): string[] | null {
  const path = [voice.id];
  for (let v = voice; v.parent !== null;) {
    const up = voices.find((u) => u.id === v.parent);
    if (!up || path.length >= MAX_DEPTH || path.includes(up.id)) return null;
    path.unshift(up.id);
    v = up;
  }
  return path;
}

/**
 * The name to show for a part: its place's own name in the tree, in the site's language
 * ("B2", "Bass 2" and "Basso 2" all show as "Basso 2"), or the song's own name for a part the
 * tree doesn't name ("Tenori solo", a split "T1b").
 */
export function partLabel(name: string, voices: Voice[], lang: "fi" | "en"): string {
  const id = placeOf(name, voices)?.at(-1);
  const voice = voices.find((v) => v.id === id);
  return voice ? voice[lang] : name;
}

const samePlace = (a: string[] | null, b: string[] | null) =>
  a !== null && b !== null && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Which part a singer starts a song on, as an index into the song's parts, or -1 to ask.
 * The part chosen for this song wins; else the one usually sung in this choir, or failing that
 * the nearest place above it in the voice tree that the song has: "Basso 2" starts on "Basso" or
 * "Bass" in a song not divided, and on "Miehet" in one for men and women. It never moves down or
 * sideways: "Basso" in a song with "Basso 1" and "Basso 2" asks, as we can't know which one.
 */
export function startingPart(names: string[], songPart: string | null | undefined,
  choirPart: string | null | undefined, voices: Voice[] = []): number {
  const places = names.map((n) => placeOf(n, voices));
  const exact = (name: string | null | undefined) => (name ? names.indexOf(name) : -1);
  const at = (place: string[] | null) => places.findIndex((p) => samePlace(p, place));
  let part = exact(songPart);
  if (part < 0 && songPart) part = at(placeOf(songPart, voices));
  if (part < 0) part = exact(choirPart);
  const path = choirPart ? placeOf(choirPart, voices) : null;
  for (let depth = path?.length ?? 0; part < 0 && depth > 0; depth--) part = at(path!.slice(0, depth));
  // A split name the tree doesn't know ("Xb") still falls back to "X", as before the tree.
  if (part < 0 && !path && choirPart && choirPart.length > 1 && choirPart.endsWith("b")) part = exact(choirPart.slice(0, -1));
  return part;
}

/**
 * Whether picking `picked` keeps `remembered` as the choir's part: it does when `picked` is a
 * place above it ("Basso" when the singer sings "Basso 2"), so the next divided song starts on
 * "Basso 2" again.
 */
export function keepChoirPart(remembered: string | null | undefined, picked: string, voices: Voice[] = []): boolean {
  const mine = remembered ? placeOf(remembered, voices) : null;
  const theirs = placeOf(picked, voices);
  return mine !== null && theirs !== null && theirs.length < mine.length && samePlace(mine.slice(0, theirs.length), theirs);
}

/** Where a part is drawn: musescore-choir-plugins#420 puts the parts of a big song back on the
 * staves its page prints them on, two to a staff. `staff` is the MusicXML part, `voices` its notes'
 * voice numbers there. A part without them has a staff of its own, the one at its own index. */
export interface Placed {
  staff?: number;
  voices?: number[];
}

/** The MusicXML part (OSMD instrument) this part is drawn on. */
export function staffOf(parts: Placed[], part: number): number {
  return parts[part]?.staff ?? part;
}

/** How many staves the score draws: fewer than the parts when some share one. */
export function staffCount(parts: Placed[]): number {
  return parts.reduce((most, _p, i) => Math.max(most, staffOf(parts, i) + 1), 0);
}

/** The singer's own notes: their staff, and on a shared one only their voices. */
export interface Focus {
  staff: number;
  voices?: number[];
}

export function focusOf(parts: Placed[], part: number): Focus {
  return { staff: staffOf(parts, part), voices: parts[part]?.voices };
}

/** Which staves to draw, by MusicXML part: every one, or only the singer's own. */
export function visibleStaves(parts: Placed[], part: number, all: boolean): boolean[] {
  const own = staffOf(parts, part);
  return Array.from({ length: staffCount(parts) }, (_v, i) => all || i === own);
}
