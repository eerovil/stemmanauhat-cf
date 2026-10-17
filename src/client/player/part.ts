/**
 * Which part a singer starts a song on, as an index into the song's parts, or -1 to ask.
 * The part chosen for this song wins; else the one usually sung in this choir. A split part
 * ("S1b", eerovil/stemmanauhat-cf#39) falls back to its unsplit part ("S1") in a song without
 * it. Part names and divisi change from song to song, so never guess further than that.
 */
export function startingPart(names: string[], songPart: string | null | undefined,
  choirPart: string | null | undefined): number {
  const indexOf = (name: string | null | undefined) => (name ? names.indexOf(name) : -1);
  let part = indexOf(songPart);
  if (part < 0) part = indexOf(choirPart);
  if (part < 0 && choirPart && choirPart.length > 1 && choirPart.endsWith("b")) part = indexOf(choirPart.slice(0, -1));
  return part;
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
