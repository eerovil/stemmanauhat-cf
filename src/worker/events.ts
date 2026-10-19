/**
 * Usage events (eerovil/eeron-omat-taskit#72): what the player sends to
 * /api/events, checked here. Anything off is dropped without an answer that
 * says why: the player never shows a singer anything about tracking.
 */
export const EVENT_NAMES = ["song_open", "settings_open", "sound_choice", "setting", "listen",
  // The song list's install notice (#91): shown, dismissed, installed from it, and
  // an open of the installed app (iPhones never say they installed).
  "install_shown", "install_dismiss", "install_accept", "app_open"] as const;
export const SETTING_NAMES = ["mode", "others", "rate", "staves", "zoom", "sound"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];
/** The defaults the admin page measures settings against (Player.vue, player/mix.ts). */
export const SETTING_DEFAULTS: Record<SettingName, string> = {
  mode: "focus", others: "0.4", rate: "1", staves: "all", zoom: "1", sound: "piano",
};
export const EVENT_MAX_BYTES = 1024;
/** A listen shorter than this is a tap on play and pause, not listening. */
export const LISTEN_MIN_SECONDS = 3;
const LISTEN_MAX_SECONDS = 7200;
/** The song list's "Suositut" (#89): songs ranked by how many people listened in this many days… */
export const POPULAR_DAYS = 30;
/** …counting only listens at least this long. */
export const POPULAR_MIN_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SETTING_VALUE = /^[a-z0-9.]{1,10}$/;

export interface UsageEvent {
  visitor: string;
  choir: string;
  song: string | null;
  part: string | null;
  name: (typeof EVENT_NAMES)[number];
  sung: boolean;
  setting: SettingName | null;
  value: string | null;
  settings: string | null;
  seconds: number | null;
  listen: string | null;
}

const short = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/** The event in a body the player sent, or null when it is not one. */
export function parseEvent(text: string): UsageEvent | null {
  if (text.length > EVENT_MAX_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = EVENT_NAMES.find((n) => n === b.name);
  const visitor = typeof b.visitor === "string" && UUID.test(b.visitor) ? b.visitor : null;
  const choir = short(b.choir, 100);
  if (!name || !visitor || !choir) return null;
  const event: UsageEvent = {
    visitor, choir, name, song: short(b.song, 100), part: short(b.part, 20), sung: b.sung === 1 || b.sung === true,
    setting: null, value: null, settings: null, seconds: null, listen: null,
  };
  if (name === "sound_choice" || name === "listen") {
    if (b.value !== "piano" && b.value !== "sung") return null;
    event.value = b.value;
  }
  if ((name === "install_shown" || name === "install_dismiss") && (b.value === "prompt" || b.value === "ios")) {
    event.value = b.value; // Which notice: the browser's prompt, or the iPhone's how-to.
  }
  if (name === "setting") {
    const setting = SETTING_NAMES.find((n) => n === b.setting);
    const value = typeof b.value === "string" && SETTING_VALUE.test(b.value) ? b.value : null;
    if (!setting || !value) return null;
    event.setting = setting;
    event.value = value;
  }
  if (name === "listen") {
    const seconds = b.seconds;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < LISTEN_MIN_SECONDS
      || seconds > LISTEN_MAX_SECONDS) return null;
    if (typeof b.listen !== "string" || !UUID.test(b.listen)) return null;
    event.seconds = seconds;
    event.listen = b.listen;
    event.settings = parseSettings(b.settings);
    if (event.settings === null) return null;
  }
  return event;
}

/** The six settings a listen played with, as JSON with only those keys. */
function parseSettings(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of SETTING_NAMES) {
    const item = v[key];
    if (typeof item !== "string" || !SETTING_VALUE.test(item)) return null;
    out[key] = item;
  }
  return Object.keys(v).length === SETTING_NAMES.length ? JSON.stringify(out) : null;
}
