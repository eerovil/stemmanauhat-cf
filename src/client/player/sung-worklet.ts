import { PartStretcher } from "./stretch";

/**
 * The sung player's audio worklet: every part's samples live here, read at one
 * position by PartStretcher, mixed and stretched off the main thread. Loaded by
 * sung.ts through Vite's `?worker&url`, which bundles this file on its own (a
 * worklet is a module without the page's imports).
 */
export type ToWorklet =
  | { type: "load"; parts: Float32Array[] }
  | { type: "gains"; gains: number[] }
  | { type: "spans"; spans: number[][] }
  | { type: "curves"; curves: number[][] }
  | { type: "play"; frames: number }
  | { type: "pause" }
  | { type: "seek"; frames: number }
  | { type: "rate"; rate: number };

/** `at` is the worklet's clock (the context's currentTime) when the position was read. */
export type FromWorklet =
  | { type: "position"; frames: number; at: number }
  | { type: "ended"; frames: number };

/** How often the position goes to the page: every 8 blocks, 23 ms at 44.1 kHz. */
const REPORT_EVERY = 8;

// The worklet globals, which the page's DOM typings do not have.
declare const currentTime: number;
declare const registerProcessor: (name: string, processor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

class SungProcessor extends AudioWorkletProcessor {
  private stretcher: PartStretcher | null = null;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ToWorklet>) => this.receive(event.data);
  }

  private receive(m: ToWorklet): void {
    if (m.type === "load") { this.stretcher = new PartStretcher(m.parts); return; }
    const s = this.stretcher;
    if (!s) return;
    if (m.type === "gains") s.setGains(m.gains);
    else if (m.type === "spans") s.setSpans(m.spans);
    else if (m.type === "curves") s.setCurves(m.curves);
    else if (m.type === "play") { s.start(m.frames); this.report(); }
    else if (m.type === "pause") s.pause();
    else if (m.type === "seek") { const wasPlaying = s.playing; s.start(m.frames); s.playing = wasPlaying; this.report(); }
    else if (m.type === "rate") { s.setRate(m.rate); this.report(); }
  }

  private report(): void {
    const m: FromWorklet = { type: "position", frames: this.stretcher!.position(), at: currentTime };
    this.port.postMessage(m);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    const s = this.stretcher;
    if (!out || !s || !s.playing) return true;
    if (!s.render(out)) {
      const m: FromWorklet = { type: "ended", frames: s.length };
      this.port.postMessage(m);
      return true;
    }
    if (++this.blocks % REPORT_EVERY === 0) this.report();
    return true;
  }
}

registerProcessor("sung-parts", SungProcessor);
