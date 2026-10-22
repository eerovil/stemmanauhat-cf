import { afterEach, describe, expect, it, vi } from "vitest";
import { SUNG_GAIN, SungPlayer, loadNotes } from "../../src/client/player/sung";
import { smf } from "./smf";
import type { FromWorklet, ToWorklet } from "../../src/client/player/sung-worklet";

/** A stand-in for Web Audio: a clock the test moves, and a worklet node that records what it is told. */
class FakeParam { constructor(public value: number) {} }
class FakeNode {
  gain = new FakeParam(1);
  next: FakeNode | null = null;
  connect(node: FakeNode): FakeNode { this.next = node; return node; }
  disconnect(): void {}
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(0); knee = new FakeParam(0); ratio = new FakeParam(1); attack = new FakeParam(0); release = new FakeParam(0);
}
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  level = 0;
  getFloatTimeDomainData(out: Float32Array): void { out.fill(this.level); }
}
class FakePort {
  sent: ToWorklet[] = [];
  transferred: Transferable[][] = [];
  onmessage: ((event: { data: FromWorklet }) => void) | null = null;
  postMessage(m: ToWorklet, transfer: Transferable[] = []): void { this.sent.push(m); this.transferred.push(transfer); }
  /** What the worklet says back. */
  reply(m: FromWorklet): void { this.onmessage?.({ data: m }); }
}
class FakeWorkletNode extends FakeNode {
  port = new FakePort();
  constructor(public context: FakeContext, public name: string, public options: unknown) { super(); context.node = this; }
}
class FakeBuffer {
  constructor(public duration: number, public sampleRate: number) {}
  getChannelData(): Float32Array { return new Float32Array(Math.round(this.duration * this.sampleRate)); }
}
class FakeContext {
  currentTime = 0;
  sampleRate = 1000;
  state: "suspended" | "running" | "closed" = "suspended";
  destination = new FakeNode();
  analyser = new FakeAnalyser();
  node: FakeWorkletNode | null = null;
  modules: string[] = [];
  audioWorklet = { addModule: async (url: string) => { this.modules.push(url); } };
  createGain(): FakeNode { return new FakeNode(); }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(); }
  createAnalyser(): FakeAnalyser { return this.analyser; }
  async decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> { return new FakeBuffer(new DataView(data).getUint8(0), this.sampleRate); }
  async resume(): Promise<void> { this.state = "running"; }
  async close(): Promise<void> { this.state = "closed"; }
}

/** A player over parts of 8 and 6 seconds at 1000 frames a second (the fake decoder reads the first byte). */
async function player() {
  const context = new FakeContext();
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, arrayBuffer: async () => new Uint8Array([url.includes("1-") ? 8 : 6]).buffer }));
  const p = await SungPlayer.create(["/x/parts/1-T.mp3", "/x/parts/2-B.mp3"], () => {}, context as unknown as AudioContext);
  const port = context.node!.port;
  const last = () => port.sent.at(-1);
  return { p, context, port, last };
}

afterEach(() => vi.unstubAllGlobals());

describe("SungPlayer", () => {
  it("decodes every part on the one context and hands them all to one worklet", async () => {
    const { p, context, port } = await player();
    expect(p.duration).toBe(8);
    expect(context.modules).toHaveLength(1);
    expect(context.node!.name).toBe("sung-parts");
    const load = port.sent[0] as { type: "load"; parts: Float32Array[] };
    expect(load.type).toBe("load");
    expect(load.parts.map((part) => part.length)).toEqual([8000, 6000]);
    expect(port.transferred[0]).toHaveLength(2);
  });

  it("plays from the tap, and tells the time from the worklet's reports, interpolated at the tempo", async () => {
    const { p, context, port, last } = await player();
    expect(p.time()).toBe(0);
    context.currentTime = 10;
    await p.play();
    expect(context.state).toBe("running");
    expect(last()).toEqual({ type: "play", frames: 0 });
    expect(p.playing).toBe(true);
    expect(p.running).toBe(true);
    context.currentTime = 12;
    expect(p.time()).toBeCloseTo(2);
    port.reply({ type: "position", frames: 2100, at: 12 });
    context.currentTime = 12.5;
    expect(p.time()).toBeCloseTo(2.6);
    p.setRate(0.5);
    expect(last()).toEqual({ type: "rate", rate: 0.5 });
    context.currentTime = 14.5;
    // 2.6 s reached, then 2 s at half speed.
    expect(p.time()).toBeCloseTo(3.6);
    port.reply({ type: "position", frames: 3700, at: 14.5 });
    context.currentTime = 15.5;
    expect(p.time()).toBeCloseTo(4.2);
    context.currentTime = 100;
    expect(p.time()).toBe(8);
  });

  it("pauses where it is, ignores a late report, and plays on from there", async () => {
    const { p, context, port, last } = await player();
    await p.play();
    context.currentTime = 3;
    p.pause();
    expect(last()).toEqual({ type: "pause" });
    expect(p.playing).toBe(false);
    expect(p.running).toBe(false);
    expect(p.time()).toBeCloseTo(3);
    port.reply({ type: "position", frames: 3200, at: 3.2 });
    context.currentTime = 8;
    expect(p.time()).toBeCloseTo(3);
    await p.play();
    expect(last()).toEqual({ type: "play", frames: 3000 });
    context.currentTime = 9;
    expect(p.time()).toBeCloseTo(4);
  });

  it("seeks the one position, playing or paused, within the song", async () => {
    const { p, port, last } = await player();
    p.seek(2.5);
    expect(p.time()).toBe(2.5);
    expect(last()).toEqual({ type: "seek", frames: 2500 });
    await p.play();
    expect(last()).toEqual({ type: "play", frames: 2500 });
    p.seek(7);
    expect(last()).toEqual({ type: "seek", frames: 7000 });
    expect(p.time()).toBeCloseTo(7);
    p.seek(-1);
    expect(p.time()).toBe(0);
    p.seek(99);
    expect(p.time()).toBe(8);
    expect(port.sent.filter((m) => m.type === "seek")).toHaveLength(4);
  });

  it("mixes with the piano's rule, scaled so the parts' power never adds up to more than 1, in the worklet", async () => {
    const { p, port } = await player();
    const gains = () => (port.sent.filter((m) => m.type === "gains").at(-1) as { gains: number[] }).gains;
    expect(p.levels().map((g) => Number(g.toFixed(3)))).toEqual([1, 0.16]);
    const total = () => p.effectiveLevels().reduce((a, b) => a + b * b, 0);
    expect(total()).toBeCloseTo(1);
    expect(p.effectiveLevels()[0]! / p.effectiveLevels()[1]!).toBeCloseTo(1 / 0.16);
    expect(gains()).toEqual(p.effectiveLevels());
    p.setMaster(1);
    expect(p.levels().map((g) => Number(g.toFixed(3)))).toEqual([0.16, 1]);
    p.setOthers(1);
    expect(p.levels()[0]).toBeCloseTo(p.levels()[1]!);
    expect(total()).toBeLessThanOrEqual(1);
    p.setOwn(false);
    expect(p.effectiveLevels()[1]).toBe(0);
    expect(total()).toBeLessThanOrEqual(1);
    expect(gains()).toEqual(p.effectiveLevels());
  });

  it("keeps a song with many parts about as loud as one with few", async () => {
    const context = new FakeContext();
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([6]).buffer }));
    const urls = Array.from({ length: 8 }, (_, i) => `/x/parts/${i + 1}-P.mp3`);
    const p = await SungPlayer.create(urls, () => {}, context as unknown as AudioContext);
    const power = () => p.effectiveLevels().reduce((a, b) => a + b * b, 0);
    expect(p.effectiveLevels()[0]).toBeGreaterThan(0.9);    // your own part: was 0.47 with eight parts
    expect(power()).toBeCloseTo(1);
    p.setOthers(1);                                          // all eight parts alike
    const g = p.effectiveLevels();
    expect(g.every((x) => Math.abs(x - g[0]!) < 1e-9)).toBe(true);
    expect(g[0]!).toBeGreaterThan(2 / 8);                    // was 1/8 each
    expect(power()).toBeLessThanOrEqual(1);
  });

  it("sends each part's gain by pitch to the worklet in frames, with the song's notes, and again on a new balance", async () => {
    const { p, port } = await player();
    const note = (part: number, key: number, start: number) => ({ part, track: part, on: 0, off: 1, key, start, end: start + 1 });
    p.setUnisons({ parts: [[note(0, 60, 0)], [note(1, 48, 0), note(1, 60, 2)]], unisons: [] });
    const curves = () => (port.sent.filter((m) => m.type === "curves").at(-1) as { curves: number[][] }).curves;
    // Off by default: no curves at all.
    expect(curves()).toEqual([]);
    // At 5 dB with the moment's middle: C3 and C4 together meet at F#3, ±2.5 dB; C4 alone stays.
    p.setBalance(5, "moment");
    expect(curves()[0]![1]).toBeCloseTo(10 ** (-2.5 / 20));
    expect(curves()[1]!.filter((_, i) => i % 2 === 0)).toEqual([0, 1950, 1962]);
    expect(curves()[1]![1]).toBeCloseTo(10 ** (2.5 / 20));
    p.setBalance(3, 60);
    expect(curves()[0]).toEqual([0, 1]);
    expect(curves()[1]![1]).toBeCloseTo(10 ** (3 / 20));
  });

  it("turns each part by its own volume after the mix, leaving the others as they were", async () => {
    const { p, port } = await player();
    const before = p.effectiveLevels();
    p.setVolumes([1, 1.5]);
    expect(p.effectiveLevels()[0]).toBeCloseTo(before[0]!);
    expect(p.effectiveLevels()[1]).toBeCloseTo(before[1]! * 1.5);
    expect((port.sent.filter((m) => m.type === "gains").at(-1) as { gains: number[] }).gains).toEqual(p.effectiveLevels());
  });

  it("lifts the mix by SUNG_GAIN into the limiter, which holds the peaks under the ceiling", async () => {
    const { context } = await player();
    const boost = context.node!.next!;
    expect(boost.gain.value).toBeCloseTo(SUNG_GAIN);
    expect(SUNG_GAIN).toBeGreaterThan(1.9);
    const limiter = boost.next as FakeCompressor;
    expect(limiter.threshold.value).toBeLessThan(0);
    expect(limiter.next).toBe(context.analyser);
  });

  it("reports the end when the worklet says the song has played out, only while playing", async () => {
    const { p, port } = await player();
    const ended = vi.fn();
    p.onEnded = ended;
    port.reply({ type: "ended", frames: 8000 });
    expect(ended).not.toHaveBeenCalled();
    await p.play();
    port.reply({ type: "ended", frames: 8000 });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(false);
    expect(p.time()).toBe(8);
  });

  it("hears sound through its meter, and closes the context when destroyed", async () => {
    const { p, context, last } = await player();
    expect(p.sounding()).toBe(false);
    context.analyser.level = 0.2;
    expect(p.sounding()).toBe(true);
    await p.play();
    p.destroy();
    expect(last()).toEqual({ type: "pause" });
    expect(context.state).toBe("closed");
  });

  it("refuses a part that does not load", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    await expect(SungPlayer.create(["/x/parts/1-T.mp3"], () => {}, new FakeContext() as unknown as AudioContext))
      .rejects.toThrow("HTTP 404");
  });
});

describe("loadNotes", () => {
  // T and B start E3 together, T on "kis" and B on "dum".
  const midi = smf([["T", [[0, 52, 0, 480]]], ["B", [[1, 52, 0, 480]]]]);
  const serve = (words: unknown) => vi.stubGlobal("fetch", async (url: string) => (url.endsWith(".mid")
    ? { ok: true, arrayBuffer: async () => midi }
    : words === undefined ? { ok: false, status: 404 } : { ok: true, json: async () => words }));
  const kis = { parts: [[[0, 52, "kis"]], [[0, 52, "dum"]]] };

  it("keeps a shared note sung by both parts where words.json gives them different syllables (eeron-omat-taskit#110)", async () => {
    serve(kis);
    expect((await loadNotes("/x/score.mid", ["T", "B"], "/x/words.json"))!.unisons).toEqual([]);
  });

  it("merges it as before for a song with no words.json, or one that does not fit its parts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const words of [undefined, { parts: kis.parts.slice(1) }, { parts: [[["kis"]], []] }]) {
      serve(words);
      expect((await loadNotes("/x/score.mid", ["T", "B"], "/x/words.json"))!.unisons).toHaveLength(1);
    }
  });
});
