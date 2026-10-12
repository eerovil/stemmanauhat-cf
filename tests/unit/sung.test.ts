import { afterEach, describe, expect, it, vi } from "vitest";
import { SungPlayer } from "../../src/client/player/sung";

/** A stand-in for Web Audio: a clock the test moves, and source nodes that remember their start. */
class FakeParam { constructor(public value: number) {} }
class FakeNode {
  connected: FakeNode[] = [];
  connect(node: FakeNode): FakeNode { this.connected.push(node); return node; }
  disconnect(): void { this.connected = []; }
}
class FakeGain extends FakeNode { gain = new FakeParam(1); }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(0); knee = new FakeParam(0); ratio = new FakeParam(1); attack = new FakeParam(0); release = new FakeParam(0);
}
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  level = 0;
  getFloatTimeDomainData(out: Float32Array): void { out.fill(this.level); }
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started: { when: number; offset: number } | null = null;
  stopped = false;
  start(when: number, offset: number): void { this.started = { when, offset }; }
  stop(): void { this.stopped = true; }
}
class FakeContext {
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  analyser = new FakeAnalyser();
  createGain(): FakeGain { const g = new FakeGain(); this.gains.push(g); return g; }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(); }
  createAnalyser(): FakeAnalyser { return this.analyser; }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  async decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }> { return { duration: new DataView(data).getUint8(0) }; }
  async resume(): Promise<void> { this.state = "running"; }
  async close(): Promise<void> { this.state = "closed"; }
  /** The sources started by the latest play or seek. */
  get live(): FakeSource[] { return this.sources.filter((s) => !s.stopped); }
}

/** A player over parts of 8 and 6 "seconds" (the fake decoder reads the first byte). */
async function player(context = new FakeContext()) {
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, arrayBuffer: async () => new Uint8Array([url.includes("1-") ? 8 : 6]).buffer }));
  const p = await SungPlayer.create(["/x/parts/1-T.mp3", "/x/parts/2-B.mp3"], () => {}, context as unknown as AudioContext);
  return { p, context };
}

afterEach(() => vi.unstubAllGlobals());

describe("SungPlayer", () => {
  it("decodes every part on the one context and starts them all at the same context time", async () => {
    const { p, context } = await player();
    expect(p.duration).toBe(8);
    context.currentTime = 10;
    await p.play();
    expect(context.state).toBe("running");
    expect(context.live).toHaveLength(2);
    const [a, b] = context.live;
    expect(a!.started).toEqual(b!.started);
    expect(a!.started!.when).toBeGreaterThan(10);
    expect(a!.started!.offset).toBe(0);
    expect(p.playing).toBe(true);
    expect(p.running).toBe(true);
  });

  it("tells the time from the context clock, from the start offset, at the tempo", async () => {
    const { p, context } = await player();
    expect(p.time()).toBe(0);
    await p.play();
    const started = context.live[0]!.started!.when;
    context.currentTime = started + 2;
    expect(p.time()).toBeCloseTo(2);
    p.setRate(1.5);
    context.currentTime = started + 4;
    // 2 s at 100 %, then 2 s at 150 %.
    expect(p.time()).toBeCloseTo(5);
    expect(context.live.every((s) => s.playbackRate.value === 1.5)).toBe(true);
    context.currentTime = started + 100;
    expect(p.time()).toBe(8);
  });

  it("pauses where it is and plays on from there", async () => {
    const { p, context } = await player();
    await p.play();
    context.currentTime = context.live[0]!.started!.when + 3;
    p.pause();
    expect(p.playing).toBe(false);
    expect(p.running).toBe(false);
    expect(context.live).toHaveLength(0);
    expect(p.time()).toBeCloseTo(3);
    context.currentTime += 5;
    expect(p.time()).toBeCloseTo(3);
    await p.play();
    expect(context.live.map((s) => s.started!.offset)).toEqual([3, 3]);
  });

  it("seeks by starting every part again together at the new place, playing or paused", async () => {
    const { p, context } = await player();
    p.seek(2.5);
    expect(p.time()).toBe(2.5);
    expect(context.live).toHaveLength(0);
    await p.play();
    expect(context.live.map((s) => s.started!.offset)).toEqual([2.5, 2.5]);
    p.seek(7);
    expect(context.live).toHaveLength(2);
    expect(context.live.map((s) => s.started!.offset)).toEqual([7, 6]);
    expect(context.live.map((s) => s.started!.when)).toEqual([context.live[0]!.started!.when, context.live[0]!.started!.when]);
    p.seek(-1);
    expect(p.time()).toBe(0);
  });

  it("mixes with the piano's rule, scaled so the parts never add up to more than 1", async () => {
    const { p, context } = await player();
    expect(p.levels().map((g) => Number(g.toFixed(3)))).toEqual([1, 0.16]);
    const total = () => p.effectiveLevels().reduce((a, b) => a + b, 0);
    expect(total()).toBeCloseTo(1);
    expect(p.effectiveLevels()[0]! / p.effectiveLevels()[1]!).toBeCloseTo(1 / 0.16);
    p.setMaster(1);
    expect(p.levels().map((g) => Number(g.toFixed(3)))).toEqual([0.16, 1]);
    p.setOthers(1);
    expect(p.levels()[0]).toBeCloseTo(p.levels()[1]!);
    expect(total()).toBeCloseTo(1);
    p.setOwn(false);
    expect(p.effectiveLevels()[1]).toBe(0);
    expect(total()).toBeLessThanOrEqual(1);
    // The guard after the mix never has to work: its threshold is the players' ceiling.
    expect(context.gains.length).toBe(3);
  });

  it("reports the end once the longest part has played out, and not when a part is stopped by a seek", async () => {
    const { p, context } = await player();
    const ended = vi.fn();
    p.onEnded = ended;
    await p.play();
    p.seek(1);
    expect(ended).not.toHaveBeenCalled();
    const longest = context.live.find((s) => s.buffer!.duration === 8)!;
    const shorter = context.live.find((s) => s.buffer!.duration === 6)!;
    expect(shorter.onended).toBeNull();
    longest.onended!();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(false);
    expect(p.time()).toBe(8);
  });

  it("hears sound through its meter, and closes the context when destroyed", async () => {
    const { p, context } = await player();
    expect(p.sounding()).toBe(false);
    context.analyser.level = 0.2;
    expect(p.sounding()).toBe(true);
    await p.play();
    p.destroy();
    expect(context.live).toHaveLength(0);
    expect(context.state).toBe("closed");
  });

  it("refuses a part that does not load", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    await expect(SungPlayer.create(["/x/parts/1-T.mp3"], () => {}, new FakeContext() as unknown as AudioContext))
      .rejects.toThrow("HTTP 404");
  });
});
