import { afterEach, describe, expect, it, vi } from "vitest";
import { ListenTimer, SettleTimer, settingValue } from "../../src/client/track";
import { parseEvent } from "../../src/worker/events";

// Usage events (eerovil/eeron-omat-taskit#72).
const VISITOR = "0b6f4c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
const LISTEN = "1c7a5d2f-2e3b-4d4c-8f9a-8b7c6d5e4f3a";
const SETTINGS = { mode: "focus", others: "0.4", rate: "0.85", staves: "all", zoom: "1", sound: "sung" };
const event = (over: Record<string, unknown>) => JSON.stringify({ visitor: VISITOR, choir: "jm", song: "kokeilu", ...over });

describe("parseEvent", () => {
  it("reads the four kinds of event the player sends", () => {
    expect(parseEvent(event({ name: "song_open", part: "Tenori", sung: 1 }))).toMatchObject(
      { name: "song_open", choir: "jm", song: "kokeilu", part: "Tenori", sung: true, value: null });
    expect(parseEvent(event({ name: "sound_choice", value: "sung" }))?.value).toBe("sung");
    expect(parseEvent(event({ name: "setting", setting: "rate", value: "0.85" }))).toMatchObject(
      { setting: "rate", value: "0.85" });
    expect(parseEvent(event({ name: "listen", value: "sung", seconds: 75, listen: LISTEN, settings: SETTINGS })))
      .toMatchObject({ seconds: 75, listen: LISTEN, settings: JSON.stringify(SETTINGS) });
  });
  it("reads the install notice's events (#91), with which notice it was", () => {
    expect(parseEvent(event({ name: "install_shown", value: "ios" }))).toMatchObject({ name: "install_shown", value: "ios" });
    expect(parseEvent(event({ name: "install_dismiss", value: "prompt" }))?.value).toBe("prompt");
    expect(parseEvent(event({ name: "install_shown", value: "<b>" }))?.value).toBeNull();
    expect(parseEvent(event({ name: "install_accept" }))?.name).toBe("install_accept");
    expect(parseEvent(event({ name: "app_open" }))?.name).toBe("app_open");
  });
  it("drops anything else", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent(event({ name: "page_view" }))).toBeNull();
    expect(parseEvent(event({ name: "song_open", visitor: "someone@example.com" }))).toBeNull();
    expect(parseEvent(event({ name: "song_open", choir: "" }))).toBeNull();
    expect(parseEvent(event({ name: "sound_choice", value: "organ" }))).toBeNull();
    expect(parseEvent(event({ name: "setting", setting: "colour", value: "red" }))).toBeNull();
    expect(parseEvent(event({ name: "setting", setting: "rate", value: "<b>" }))).toBeNull();
    expect(parseEvent(event({ name: "song_open", note: "x".repeat(1100) }))).toBeNull();
  });
  it("takes a listen only with its length, its id and all six settings", () => {
    const listen = (over: Record<string, unknown>) =>
      parseEvent(event({ name: "listen", value: "piano", seconds: 10, listen: LISTEN, settings: SETTINGS, ...over }));
    expect(listen({})).not.toBeNull();
    expect(listen({ seconds: 2 })).toBeNull();
    expect(listen({ seconds: 10.5 })).toBeNull();
    expect(listen({ seconds: 99999 })).toBeNull();
    expect(listen({ listen: "1" })).toBeNull();
    expect(listen({ settings: { ...SETTINGS, rate: undefined } })).toBeNull();
    expect(listen({ settings: { ...SETTINGS, extra: "1" } })).toBeNull();
  });
  it("never takes an email from the body", () => {
    expect(parseEvent(event({ name: "song_open", email: "someone@example.com" }))).not.toHaveProperty("email");
  });
});

describe("settingValue", () => {
  it("writes numbers as their shortest decimal", () => {
    expect([settingValue(0.4), settingValue(1), settingValue(0.8500000001), settingValue("own")])
      .toEqual(["0.4", "1", "0.85", "own"]);
  });
});

describe("ListenTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("saves a listen at each full minute and at its end, under one id", () => {
    vi.useFakeTimers();
    let now = 0;
    const saved: [string, number, string][] = [];
    const timer = new ListenTimer<string>((id, seconds, sound) => saved.push([id, seconds, sound]), () => now);
    timer.start("sung");
    for (let i = 0; i < 75; i++) { now += 1000; vi.advanceTimersByTime(1000); }
    timer.stop();
    expect(saved.map(([, s, sound]) => [s, sound])).toEqual([[60, "sung"], [75, "sung"]]);
    expect(new Set(saved.map(([id]) => id)).size).toBe(1);
    expect(timer.running).toBe(false);
  });
  it("does not save a tap on play and pause, and gives each listen its own id", () => {
    let now = 0;
    const saved: string[] = [];
    const timer = new ListenTimer<string>((id) => saved.push(id), () => now);
    timer.start("piano");
    now = 2000;
    timer.stop();
    expect(saved).toEqual([]);
    timer.start("piano");
    now = 6000;
    timer.stop();
    timer.start("piano");
    now = 10000;
    timer.stop();
    expect(saved).toHaveLength(2);
    expect(saved[0]).not.toBe(saved[1]);
  });
});

describe("SettleTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("sends a tap at once and a slider's last value once it settles", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const settle = new SettleTimer();
    settle.note("mode", () => sent.push("mode"));
    expect(sent).toEqual(["mode"]);
    let rate = 0.95;
    for (const next of [0.95, 0.9, 0.85]) { rate = next; settle.note("rate", () => sent.push(`rate ${rate}`), true); vi.advanceTimersByTime(500); }
    expect(sent).toEqual(["mode"]);
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(["mode", "rate 0.85"]);
  });
  it("sends what is still waiting when the page goes", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const settle = new SettleTimer();
    settle.note("zoom", () => sent.push("zoom"), true);
    settle.flush();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["zoom"]);
  });
});
