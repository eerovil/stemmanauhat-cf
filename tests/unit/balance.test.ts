import { BasicMIDI } from "spessasynth_core";
import { describe, expect, it } from "vitest";
import { DEFAULT_PIVOT, OCTAVE_DB, pitchCurves, pitchDb, songPivot, type Pivot } from "../../src/client/player/balance";
import { partChannels } from "../../src/client/player/midi";
import { dbToGain, findNotes, type Notes, type UnisonNote } from "../../src/client/player/unison";
import { smf, type N } from "./smf";

const round = (curve: number[]) => curve.map((v) => Number(v.toFixed(4)));
const notesOf = (tracks: [string, N[]][]) => {
  const midi = BasicMIDI.fromArrayBuffer(smf(tracks));
  return findNotes(midi, partChannels(midi, tracks.map(([name]) => name)));
};

describe("the sung parts' balance by pitch", () => {
  it("is off by default, and turns a note up the amount an octave below the middle and down as much above it", () => {
    expect(OCTAVE_DB).toBe(0);
    expect(DEFAULT_PIVOT).toBe("moment");
    expect(pitchDb(48)).toBe(0);
    expect(pitchDb(60, 5)).toBe(0);
    expect(pitchDb(48, 5)).toBe(5);
    expect(pitchDb(72, 3)).toBe(-3);
    expect(pitchDb(48, 3, 48)).toBe(0);
  });

  it("with a fixed middle, moves each part's gain to each note's from just before it, and holds it through rests", () => {
    // B: C3, a rest, C4. T: C4 then C4 again (no change), then G4.
    const notes = notesOf([
      ["B", [[0, 48, 0, 480], [0, 60, 960, 1440]]],
      ["T", [[1, 60, 0, 480], [1, 60, 480, 960], [1, 67, 960, 1440]]],
    ]);
    const curves = pitchCurves(notes, 3, 60);
    expect(round(curves[0]!)).toEqual(round([0, dbToGain(3), 0.95, dbToGain(3), 0.962, 1]));
    expect(round(curves[1]!)).toEqual(round([0, 1, 0.95, 1, 0.962, dbToGain(pitchDb(67, 3))]));
  });

  it("takes the mean of a chord within a part", () => {
    expect(pitchCurves(notesOf([["T", [[0, 48, 0, 480], [0, 72, 0, 480]]]]), 3, 60)[0]).toEqual([0, 1]);
  });

  it("goes to the note held on when the rest of a chord ends", () => {
    // C3 and C5 together; C5 ends at 0.5 s, C3 goes on to 1 s.
    expect(round(pitchCurves(notesOf([["T", [[0, 48, 0, 960], [0, 72, 0, 480]]]]), 3, 60)[0]!))
      .toEqual(round([0, 1, 0.5, 1, 0.512, dbToGain(3)]));
  });

  it("with the moment's middle, the lowest part sounding is loudest, and a part singing alone stays as it is", () => {
    // C3 and C4 together for a beat, then C4 alone.
    const notes = notesOf([["T", [[1, 60, 0, 960]]], ["B", [[0, 48, 0, 480]]]]);
    const [t, b] = pitchCurves(notes, 5, "moment");
    expect(round(t!)).toEqual(round([0, dbToGain(-2.5), 0.5, dbToGain(-2.5), 0.512, 1]));
    expect(round(b!)).toEqual(round([0, dbToGain(2.5)]));
  });

  it("with the song's middle, takes the mean key of all its notes, by how long each sounds", () => {
    const notes = notesOf([["T", [[1, 72, 0, 480]]], ["B", [[0, 48, 0, 960]]]]);
    expect(songPivot(notes)).toBe(56);
    expect(round(pitchCurves(notes, 6, "song")[0]!)).toEqual(round([0, dbToGain(-8)]));
  });

  it("gives the same curves as scanning every note at every start and end, for every middle", () => {
    const notes = randomSong(4, 120, 7);
    for (const pivot of [60, "song", "moment"] as Pivot[]) {
      const fast = pitchCurves(notes, 5, pivot);
      const slow = slowCurves(notes, 5, pivot);
      expect(fast.map((c) => round(c))).toEqual(slow.map((c) => round(c)));
    }
  });

  it("is quick on a long song of many parts, as it runs on every move of the slider", () => {
    const notes = randomSong(8, 3000, 11);
    const began = performance.now();
    pitchCurves(notes, 5, "moment");
    expect(performance.now() - began).toBeLessThan(1000); // the plain version took minutes here
  });
});

/** A made-up song: per part `n` notes in a row, with chords and rests, from a fixed seed. */
function randomSong(parts: number, n: number, seed: number): Notes {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const list: UnisonNote[][] = [];
  for (let p = 0; p < parts; p++) {
    const notes: UnisonNote[] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const start = Math.round(t * 4) / 4;
      const end = start + 0.25 * (1 + Math.floor(rand() * 4));
      const key = 40 + p * 5 + Math.floor(rand() * 12);
      notes.push({ part: p, track: p, on: 0, off: 1, key, start, end });
      if (rand() < 0.1) notes.push({ part: p, track: p, on: 0, off: 1, key: key + 4, start, end: start + 0.25 });
      t = rand() < 0.15 ? end + 0.5 : end;
    }
    list.push(notes);
  }
  return { parts: list, unisons: [] };
}

/** The first, plain version: every note looked at again at each start and end. */
function slowCurves(notes: Notes, octaveDb: number, pivot: Pivot): number[][] {
  const LEAD = 0.05, RAMP = 0.012, EPS = 0.001;
  const all = notes.parts.flat();
  const fixed = pivot === "song" ? songPivot(notes) : pivot;
  const eventsOf = (list: UnisonNote[]) => [...list.map((n) => ({ t: n.start, lead: LEAD })),
    ...list.filter((n) => Number.isFinite(n.end)).map((n) => ({ t: n.end, lead: 0 }))];
  const soundingAt = (list: UnisonNote[], t: number) => list.filter((m) => m.start < t + EPS && m.end > t + EPS);
  return notes.parts.map((list) => {
    const times = (pivot === "moment" ? eventsOf(all) : eventsOf(list)).sort((a, b) => a.t - b.t || b.lead - a.lead);
    const curve: number[] = [];
    let gain: number | null = null;
    let last = -Infinity;
    for (const { t, lead } of times) {
      if (t < last + EPS) continue;
      const sounding = soundingAt(list, t);
      if (!sounding.length) continue;
      last = t;
      let middle = fixed as number;
      if (pivot === "moment") { const now = soundingAt(all, t); middle = now.reduce((a, m) => a + m.key, 0) / now.length; }
      const g = dbToGain(sounding.reduce((a, m) => a + pitchDb(m.key, octaveDb, middle), 0) / sounding.length);
      if (Number(g.toFixed(9)) === (gain === null ? null : Number(gain.toFixed(9)))) continue;
      const at = Math.max(0, t - lead, curve.length ? curve[curve.length - 2]! : 0);
      if (gain !== null) curve.push(at, gain);
      curve.push(gain === null ? at : at + RAMP, g);
      gain = g;
    }
    return curve;
  });
}

