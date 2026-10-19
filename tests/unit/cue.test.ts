import { afterEach, describe, expect, it, vi } from "vitest";
import { cueNote, onlyBetween, StartingNote } from "../../src/client/player/cue";
import type { UnisonNote } from "../../src/client/player/unison";

const note = (start: number, end: number): UnisonNote => ({ part: 0, track: 0, on: 0, off: 0, start, end });

// Quarter notes at 120 bpm, a rest from 1.0 to 2.0, then a chord whose top note is held longer.
const part = [note(0, 0.5), note(0.5, 1), note(2, 2.5), note(2, 3)];

describe("the singer's starting note", () => {
  it("is the note starting where playback starts", () => {
    expect(cueNote(part, 0)).toEqual({ start: 0, end: 0.5 });
    expect(cueNote(part, 0.5)).toEqual({ start: 0.5, end: 1 });
  });

  it("is the next one to start, from the middle of a note or a rest", () => {
    expect(cueNote(part, 0.2)).toEqual({ start: 0.5, end: 1 });
    expect(cueNote(part, 1.2)).toEqual({ start: 2, end: 3 });
  });

  it("counts a note starting a hair before the place", () => {
    expect(cueNote(part, 0.505)).toEqual({ start: 0.5, end: 1 });
  });

  it("is none after the part's last note, or without notes", () => {
    expect(cueNote(part, 2.5)).toBeNull();
    expect(cueNote(undefined, 0)).toBeNull();
  });

  it("gets a short length when its end is missing", () => {
    expect(cueNote([note(1, Infinity)], 0)).toEqual({ start: 1, end: 2 });
  });
});

describe("a sung part singing only its starting note", () => {
  it("is silent before and after it, keeping its own silences between", () => {
    expect(onlyBetween([10, 20, 50, 70, 90, 95], 15, 60, 100)).toEqual([0, 15, 15, 20, 50, 60, 60, 100]);
  });

  it("adds nothing at the song's very start or end", () => {
    expect(onlyBetween([], 0, 100, 100)).toEqual([]);
  });
});

describe("the starting note's timer", () => {
  afterEach(() => { vi.useRealTimers(); });

  /** A clock in seconds that the fake timers move. */
  const setup = (endShift = 0) => {
    vi.useFakeTimers();
    const start = Date.now();
    const changes: boolean[] = [];
    const starting: StartingNote = new StartingNote(() => (Date.now() - start) / 1000, () => changes.push(starting.on), endShift);
    return { starting, changes };
  };

  it("turns the part on, then off when the note has played", () => {
    const { starting, changes } = setup();
    starting.start(part, 0.2);
    expect(starting.cue).toEqual({ start: 0.5, end: 1 });
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(790);
    expect(starting.on).toBe(true);
    vi.advanceTimersByTime(20);
    expect(changes).toEqual([true, false]);
  });

  it("lasts longer at a slower tempo, also when changed mid-note", () => {
    const { starting } = setup();
    starting.setRate(0.5);
    starting.start(part, 0);
    vi.advanceTimersByTime(500);
    // Half the note played; at 1.0 the rest takes 0.25 s.
    starting.setRate(1);
    vi.advanceTimersByTime(240);
    expect(starting.on).toBe(true);
    vi.advanceTimersByTime(10);
    expect(starting.on).toBe(false);
  });

  it("ends on time when the tempo goes up just before the note's end", () => {
    const { starting } = setup();
    starting.start(part, 0);
    vi.advanceTimersByTime(400);
    // 0.1 s of the note left; at 1.5 that is under 0.07 s, not the 0.1 s timed before.
    starting.setRate(1.5);
    vi.advanceTimersByTime(60);
    expect(starting.on).toBe(true);
    vi.advanceTimersByTime(10);
    expect(starting.on).toBe(false);
  });

  it("ends early or late by its shift", () => {
    const { starting } = setup(-0.1);
    starting.start(part, 0);
    vi.advanceTimersByTime(410);
    expect(starting.on).toBe(false);
  });

  it("changes nothing when there is no note to play, and stops on demand", () => {
    const { starting, changes } = setup();
    starting.start(part, 2.5);
    expect(changes).toEqual([]);
    starting.start(part, 0);
    starting.stop();
    starting.stop();
    expect(changes).toEqual([true, false]);
    starting.start(part, 0);
    starting.start(part, 2.5);
    expect(changes).toEqual([true, false, true, false]);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true, false, true, false]);
  });
});
