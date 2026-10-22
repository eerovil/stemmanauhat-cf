import { BasicMIDI } from "spessasynth_core";
import type { GainSteps } from "./wav";

/**
 * Where parts sing the same note: two or more parts starting the same pitch at
 * the same moment (eerovil/eeron-omat-taskit#76). Played as written, the note
 * sounds once per part, so S1 and S1b in unison were twice as loud as one part.
 * Eero wanted them, together, as loud as one: the loudest of them sings the
 * note and the others are left out of it. "Loudest" is your own part when it is
 * one of them (and sounds), else any of the others, which all play at one level.
 * Past two parts the note grows a little louder, STEP_DB for each part more
 * that is heard on it (eerovil/stemmanauhat-cf#115): a full TTBB unison sounded
 * thin next to the chords around it.
 */
export interface UnisonNote {
  part: number;
  track: number;
  /** The note-on and note-off events' indexes in the track. */
  on: number;
  off: number;
  /** The MIDI key: 60 is middle C. */
  key: number;
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
        const note = { part, track: t, on: i, off: -1, key: e.data[0]!, start: midi.midiTicksToSeconds(e.ticks), end: Infinity };
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

/**
 * What each sung part sings, from the song's words.json (written by sing-song,
 * eerovil/eeron-omat-taskit#110), in the parts' order: for every note it sings,
 * [seconds, MIDI key, syllable], the syllable as sung on that note (a held or
 * repeated one too).
 */
export type Words = [number, number, string][][];

/** Seconds a sung note's start may be off the MIDI's: sing-song stops a part that is off by more. */
const WORD_EPS = 0.05;

/** The syllable a part sings on `n`, from its nearest note in `words` on the same key; undefined when it has none. */
function syllableOf(n: UnisonNote, words: Words): string | undefined {
  let best: [number, number, string] | undefined;
  for (const w of words[n.part] ?? []) {
    const off = Math.abs(w[0] - n.start);
    if (w[1] === n.key && off <= WORD_EPS && (!best || off < Math.abs(best[0] - n.start))) best = w;
  }
  return best?.[2];
}

/**
 * Only the unisons the parts sing on the same syllable, for the sung parts: a
 * note two parts share with different words is sung by each (Eero, #110: the
 * tenor's "kis" fell on the bass's "dum", and only the "dum" was heard). A
 * unison splits into its groups of one syllable; a part with no known syllable
 * there sings its own.
 */
export function sameWords(notes: Notes, words: Words): Notes {
  const unisons: Unison[] = [];
  for (const u of notes.unisons) {
    const groups = new Map<string, Unison>();
    for (const n of u) {
      const syllable = syllableOf(n, words);
      if (syllable !== undefined) groups.set(syllable, [...(groups.get(syllable) ?? []), n]);
    }
    for (const group of groups.values()) if (group.length > 1) unisons.push(group);
  }
  return { parts: notes.parts, unisons };
}

/** dB a unison's note is raised for each part past two heard on it (Eero, #115). */
export const STEP_DB = 2;

/** How many dB louder a unison sounds that `heard` parts sing: none for two, STEP_DB for each more. */
export function boostDb(heard: number): number {
  return STEP_DB * Math.max(0, heard - 2);
}

export const dbToGain = (db: number) => 10 ** (db / 20);

/** Which part sings a unison: yours when it is one of them and sounds, else the first other one. */
export function carrier(unison: Unison, master: number, own: boolean): UnisonNote {
  return unison.find((n) => own && n.part === master) ?? unison.find((n) => n.part !== master)!;
}

/**
 * The notes left out for this part and mix, each with the note that sings it
 * instead: every unison note but the carrier's.
 */
export function silenced(notes: Notes, master: number, own: boolean): Map<UnisonNote, UnisonNote> {
  const out = new Map<UnisonNote, UnisonNote>();
  for (const u of notes.unisons) {
    const keep = carrier(u, master, own);
    for (const n of u) if (n !== keep) out.set(n, keep);
  }
  return out;
}

/**
 * The notes that sing a unison louder, with their dB: the carrier of each unison
 * that more than two parts are heard on. Your own part is not heard with `own` off.
 */
export function boosts(notes: Notes, master: number, own: boolean): Map<UnisonNote, number> {
  const out = new Map<UnisonNote, number>();
  for (const u of notes.unisons) {
    const db = boostDb(u.filter((n) => own || n.part !== master).length);
    if (db > 0) out.set(carrier(u, master, own), db);
  }
  return out;
}

/**
 * A copy of the song without the notes in `drop`, for the piano. With `notes`,
 * every unison note is held until the unison's longest copy ends (Eero, #76:
 * one note, held longest), so the copy that is kept rings as long as any did;
 * never into the part's own next strike of that key. Each note in `louder` is
 * struck harder by its dB: the piano's loudness goes as velocity squared
 * (SoundFont's default velocity curve), capped at 127.
 */
export function withoutNotes(midi: BasicMIDI, drop: Iterable<UnisonNote>, notes?: Notes,
  louder: Map<UnisonNote, number> = new Map()): BasicMIDI {
  const copy = BasicMIDI.copyFrom(midi);
  for (const [n, db] of louder) {
    const on = copy.tracks[n.track]!.events[n.on]!;
    on.data[1] = Math.min(127, Math.round(on.data[1]! * 10 ** (db / 40)));
  }
  if (notes) {
    const key = (n: UnisonNote) => midi.tracks[n.track]!.events[n.on]!.data[0];
    const tick = (t: number, i: number) => midi.tracks[t]!.events[i]!.ticks;
    for (const u of notes.unisons) {
      const last = Math.max(...u.map((n) => (n.off >= 0 ? tick(n.track, n.off) : 0)));
      for (const n of u) {
        if (n.off < 0) continue;
        const list = notes.parts[n.part]!;
        const next = list.slice(list.indexOf(n) + 1).find((m) => m.track === n.track && key(m) === key(n));
        const until = next ? Math.min(last, tick(next.track, next.on)) : last;
        const off = copy.tracks[n.track]!.events[n.off]!;
        off.ticks = Math.max(off.ticks, until);
      }
    }
  }
  const indexes = copy.tracks.map(() => [] as number[]);
  for (const n of drop) {
    indexes[n.track]!.push(n.on);
    if (n.off >= 0) indexes[n.track]!.push(n.off);
  }
  indexes.forEach((list, t) => {
    for (const i of list.sort((a, b) => b - a)) copy.tracks[t]!.deleteEvent(i);
  });
  copy.flush(true);
  return copy;
}

/**
 * Where each sung part is left out or turned up, in seconds, as [start, end,
 * gain]: its silenced notes at 0 (until the note that sings it instead ends),
 * and the notes it sings a unison louder on (`louder`) at that gain; those that
 * follow on without a gap at one gain as one stretch. Starts `lead` early, for
 * the consonant a singer starts before the beat, and ends `tail` late, for the
 * voice's release. A rest between two of them stays as it is (a breath). A part's
 * recording is all its notes in one, so a note sounding at the same time as
 * another of the part's own notes that stays (a chord within the part) is left
 * as it is: that would take the other note with it.
 */
export function gainSpans(notes: Notes, gone: Map<UnisonNote, UnisonNote>,
  louder: Map<UnisonNote, number> = new Map(), lead = 0.05, tail = 0.15): [number, number, number][][] {
  return notes.parts.map((list) => {
    const spans: [number, number, number][] = [];
    let run: [number, number, number] | null = null;
    const kept = list.filter((m) => !gone.has(m));
    const alongside = (n: UnisonNote) => kept.some((m) => m !== n && m.start < n.end - EPS && m.end > n.start + EPS);
    list.forEach((n, i) => {
      const by = gone.get(n);
      const db = louder.get(n);
      if ((!by && db === undefined) || alongside(n)) { run = null; return; }
      const gain = by ? 0 : dbToGain(db!);
      // Held longer than the note that sings it, the voice comes back in for the rest of it;
      // else it stays out (or up) for its release too, up to the part's next note.
      const next = list[i + 1];
      const release = Math.min(n.end + tail, next ? Math.max(n.end, next.start - lead) : Infinity);
      const end = by && n.end > by.end + EPS ? by.end : release;
      const start = Math.max(0, n.start - lead);
      if (run && run[2] === gain && start <= run[1]) run[1] = Math.max(run[1], end);
      else { run = [start, end, gain]; spans.push(run); }
    });
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
 * unison note, so the left-out note's ring is gone too, and above 1 over a
 * note in `louder`.
 */
export function unisonSteps(notes: Notes, gone: Map<UnisonNote, UnisonNote>, sampleRate: number, rate: number,
  louder: Map<UnisonNote, number> = new Map()): GainSteps[] {
  const all = unisonNotes(notes);
  return notes.parts.map((list) => {
    const steps: GainSteps = { at: [], gains: [] };
    for (const n of list) {
      if (!all.has(n)) continue;
      steps.at.push(Math.round((n.start / rate) * sampleRate));
      steps.gains.push(gone.has(n) ? 0 : dbToGain(louder.get(n) ?? 0));
    }
    return steps;
  });
}
