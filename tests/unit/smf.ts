/** Small MIDI files for the tests. */
/**
 * A note: channel, pitch, start and end in ticks (480 to a beat, 120 bpm: a beat is 0.5 s), and
 * its velocity (80 when not given).
 */
export type N = [number, number, number, number, number?];

/** A format-1 MIDI file with one named track per part, each channel sending to the reverb. */
export function smf(tracks: [string, N[]][]): ArrayBuffer {
  const bytes: number[] = [];
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const vlq = (v: number) => {
    const out = [v & 127];
    while ((v >>= 7)) out.unshift((v & 127) | 128);
    return out;
  };
  bytes.push(..."MThd".split("").map((c) => c.charCodeAt(0)), ...u32(6), 0, 1, 0, tracks.length, 480 >> 8, 480 & 255);
  for (const [name, notes] of tracks) {
    const events: [number, number[]][] = [[0, [0xff, 0x03, name.length, ...name.split("").map((c) => c.charCodeAt(0))]]];
    // Reverb sent, as MuseScore's export does, so the effects are heard.
    for (const ch of new Set(notes.map((n) => n[0]))) events.push([0, [0xb0 | ch, 91, 100]]);
    for (const [ch, key, on, off, velocity = 80] of notes) {
      events.push([on, [0x90 | ch, key, velocity]], [off, [0x80 | ch, key, 0]]);
    }
    events.sort((a, b) => a[0] - b[0] || (a[1][0]! & 0xf0) - (b[1][0]! & 0xf0));
    const body: number[] = [];
    let at = 0;
    for (const [t, data] of events) { body.push(...vlq(t - at), ...data); at = t; }
    body.push(0, 0xff, 0x2f, 0);
    bytes.push(..."MTrk".split("").map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes).buffer;
}
