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
