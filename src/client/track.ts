/**
 * Usage events (eerovil/eeron-omat-taskit#72): do singers find the singing, and
 * which settings do they use? Sent with sendBeacon, so a send never holds up
 * the player and a failed one is simply lost; nothing is shown to the singer.
 * The worker adds who it was from the session (src/worker/events.ts).
 */
export type SettingName = "mode" | "others" | "rate" | "staves" | "zoom" | "sound";
export type Settings = Record<SettingName, string>;

export interface EventFields {
  choir: string;
  song?: string;
  part?: string;
  sung?: boolean;
  setting?: SettingName;
  value?: string;
  settings?: Settings;
  seconds?: number;
  listen?: string;
}

const VISITOR_KEY = "stemmanauhat:visitor";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** This device's random id: tells devices apart where nobody signed in with Google. */
export function visitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id || !UUID.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

export type EventName = "song_open" | "settings_open" | "sound_choice" | "setting" | "listen"
  | "install_shown" | "install_dismiss" | "install_accept" | "app_open";

export function track(name: EventName, fields: EventFields): void {
  try {
    navigator.sendBeacon("/api/events", JSON.stringify({ ...fields, name, visitor: visitorId(), sung: fields.sung ? 1 : 0 }));
  } catch { /* no storage or no beacon: this visit is not counted */ }
}

/** How a setting's value is written: numbers as their shortest decimal, e.g. 0.4, 1, 1.15. */
export const settingValue = (value: string | number): string =>
  typeof value === "number" ? String(Math.round(value * 100) / 100) : value;

/** A listen shorter than this is a tap on play and pause, not listening. */
export const LISTEN_MIN_SECONDS = 3;
/** A listen still going is saved again this often, so a page closed without warning keeps it. */
export const LISTEN_SAVE_MS = 60_000;

/**
 * One listen: from play to pause, the song's end, a change of sound or leaving.
 * `save` gets the listen's id, its whole seconds and what started it, at each
 * full minute and at the end; the id lets the worker update one row.
 */
export class ListenTimer<T> {
  private id: string | null = null;
  private startedAt = 0;
  private context: T | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly save: (id: string, seconds: number, context: T) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get running(): boolean {
    return this.id !== null;
  }

  start(context: T): void {
    if (this.id) return;
    this.id = crypto.randomUUID();
    this.startedAt = this.clock();
    this.context = context;
    this.timer = setInterval(() => this.send(), LISTEN_SAVE_MS);
  }

  stop(): void {
    if (!this.id) return;
    this.send();
    clearInterval(this.timer);
    this.id = null;
  }

  private send(): void {
    const seconds = Math.floor((this.clock() - this.startedAt) / 1000);
    if (this.id && seconds >= LISTEN_MIN_SECONDS) this.save(this.id, seconds, this.context as T);
  }
}

/**
 * A setting that moves in small steps (a slider, a stepper) is sent once, this
 * long after the last change, with the value it ended on.
 */
export const SETTLE_MS = 2000;

export class SettleTimer {
  private pending = new Map<SettingName, { timer: ReturnType<typeof setTimeout>; send: () => void }>();

  /** Sends now, or `settle` ms after the last call for the same setting. */
  note(setting: SettingName, send: () => void, settle = false): void {
    this.cancel(setting);
    if (!settle) { send(); return; }
    this.pending.set(setting, { timer: setTimeout(() => { this.pending.delete(setting); send(); }, SETTLE_MS), send });
  }

  /** Sends whatever is still waiting: the page is going away. */
  flush(): void {
    for (const [setting, { send }] of [...this.pending]) { this.cancel(setting); send(); }
  }

  private cancel(setting: SettingName): void {
    const waiting = this.pending.get(setting);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(setting);
  }
}
