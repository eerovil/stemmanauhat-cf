import { BasicMIDI } from "spessasynth_core";
import type { GainSteps } from "./wav";

/**
 * Where parts sing the same note: two or more parts starting the same pitch at
 * the same moment (eerovil/eeron-omat-taskit#76). Played as written, the note
 * sounds once per part, so S1 and S1b in unison were twice as loud as one part.
 * Eero wanted them, together, as loud as one: the loudest of them sings the
 * note and the others are left out of it. "Loudest" is your own part when it is
 * one of them (and sounds), else any of the others, which all play at one level.
 */
export interface UnisonNote {
  part: number;
  track: number;
  /** The note-on and note-off events' indexes in the track. */
  on: number;
  off: number;
  /** Seconds. */
  start: number;
  end: number;
}

/** One note several parts start together. */
export type Unison = UnisonNote[];

/** Every part's notes (start-ordered) and the unisons among them. */
export interface Notes {
  parts: UnisonNote[][];
  unisons: Unison[];
}

const NOTE_ON = 0x90;
/** Seconds: notes closer than this (a legato join) do not count as sounding together. */
const EPS = 0.001;
const NOTE_OFF = 0x80;

export function findNotes(midi: BasicMIDI, partChannels: number[][]): Notes {
  const partOf = new Map<number, number>();
  partChannels.forEach((chs, p) => chs.forEach((c) => partOf.set(c, p)));
  const parts: UnisonNote[][] = partChannels.map(() => []);
  midi.tracks.forEach((track, t) => {
    const open = new Map<number, UnisonNote[]>();
    track.events.forEach((e, i) => {
      const kind = e.statusByte & 0xf0;
      if (kind !== NOTE_ON && kind !== NOTE_OFF) return;
      const part = partOf.get(e.statusByte & 0x0f);
      if (part === undefined) return;
      const key = ((e.statusByte & 0x0f) << 8) | e.data[0]!;
      if (kind === NOTE_ON && e.data[1]! > 0) {
        const note = { part, track: t, on: i, off: -1, start: midi.midiTicksToSeconds(e.ticks), end: Infinity };
        open.set(key, [...(open.get(key) ?? []), note]);
        parts[part]!.push(note);
      } else {
        const note = open.get(key)?.shift();
        if (!note) return;
        note.off = i;
        note.end = midi.midiTicksToSeconds(e.ticks);
      }
    });
  });
  const byStart = new Map<string, UnisonNote[]>();
  for (const notes of parts) {
    notes.sort((a, b) => a.start - b.start);
    for (const n of notes) {
      const e = midi.tracks[n.track]!.events[n.on]!;
      const key = `${e.ticks}:${e.data[0]}`;
      const same = byStart.get(key) ?? [];
      // A part sounding one note twice (two voices on a staff) is not a unison.
      if (!same.some((s) => s.part === n.part)) same.push(n);
      byStart.set(key, same);
    }
  }
  return { parts, unisons: [...byStart.values()].filter((u) => u.length > 1) };
}

/** Which part sings a unison: yours when it is one of them and sounds, else the first other one. */
export function carrier(unison: Unison, master: number, own: boolean): UnisonNote {
  return unison.find((n) => own && n.part === master) ?? unison.find((n) => n.part !== master)!;
}

/**
 * The notes left out for this part and mix: every unison note but the carrier's,
 * unless it is held longer than the carrier's (then it would stop too early).
 */
export function silenced(notes: Notes, master: number, own: boolean): Set<UnisonNote> {
  const out = new Set<UnisonNote>();
  for (const u of notes.unisons) {
    const keep = carrier(u, master, own);
    for (const n of u) if (n !== keep && n.end <= keep.end + 1e-6) out.add(n);
  }
  return out;
}

/** A copy of the song without the silenced notes, for the piano. */
export function withoutNotes(midi: BasicMIDI, notes: Set<UnisonNote>): BasicMIDI {
  const copy = BasicMIDI.copyFrom(midi);
  const drop = copy.tracks.map(() => [] as number[]);
  for (const n of notes) {
    drop[n.track]!.push(n.on);
    if (n.off >= 0) drop[n.track]!.push(n.off);
  }
  drop.forEach((indexes, t) => {
    for (const i of indexes.sort((a, b) => b - a)) copy.tracks[t]!.deleteEvent(i);
  });
  copy.flush();
  return copy;
}

/**
 * Where each sung part is left out, in seconds: its silenced notes, those that
 * follow on without a gap as one stretch. Starts `lead` early, for the
 * consonant a singer starts before the beat. A rest between two of them stays
 * heard (the last note's ring, a breath). A part's recording is all its notes
 * in one, so a note sounding at the same time as one of the part's own notes
 * that stays (a chord within the part) is not left out: that would take the
 * other note with it.
 */
export function silentSpans(notes: Notes, gone: Set<UnisonNote>, lead = 0.05): [number, number][][] {
  return notes.parts.map((list) => {
    const spans: [number, number][] = [];
    let run: [number, number] | null = null;
    const kept = list.filter((m) => !gone.has(m));
    const alongside = (n: UnisonNote) => kept.some((m) => m.start < n.end - EPS && m.end > n.start + EPS);
    for (const n of list) {
      if (!gone.has(n) || alongside(n)) { run = null; continue; }
      const start = Math.max(0, n.start - lead);
      if (run && start <= run[1]) run[1] = Math.max(run[1], n.end);
      else { run = [start, n.end]; spans.push(run); }
    }
    return spans;
  });
}

/** Every note that is part of a unison. */
export function unisonNotes(notes: Notes): Set<UnisonNote> {
  return new Set(notes.unisons.flat());
}

/**
 * For the file player, which renders each part's unison notes apart: each
 * part's gain over them, 0 from a silenced note's start to the part's next
 * unison note, so the left-out note's ring is gone too.
 */
export function unisonSteps(notes: Notes, gone: Set<UnisonNote>, sampleRate: number, rate: number): GainSteps[] {
  const all = unisonNotes(notes);
  return notes.parts.map((list) => {
    const steps: GainSteps = { at: [], gains: [] };
    for (const n of list) {
      if (!all.has(n)) continue;
      steps.at.push(Math.round((n.start / rate) * sampleRate));
      steps.gains.push(gone.has(n) ? 0 : 1);
    }
    return steps;
  });
}
