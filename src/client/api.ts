import { lang, words } from "./i18n";
import type { Voice } from "./player/part";

export interface Choir {
  id: string;
  name: string;
  public: boolean;
  /** The test list (#73): admins only, songs move from it to a choir. */
  staging: boolean;
}

export interface Me {
  email: string | null;
  linked: string[];
  /** An agent's read-only login link session (#79). */
  agent: boolean;
  admin: boolean;
  choirs: Choir[];
  /** Choirs this browser is in only by link, which a Google sign-in would join. */
  joinable: string[];
}

export interface Part {
  name: string;
  /**
   * The part's MP3 under the song's base. Rows from before #36 list piano renders here;
   * only a part marked `sung` is singing, which Säädöt offers as "Laulu".
   */
  file?: string;
  sung?: boolean;
  /** The AI voice that sings a sung part; REMY when not named. */
  voice?: string;
  /**
   * Where the part is drawn when it shares a staff (musescore-choir-plugins#420): the
   * MusicXML part (0-based) and its notes' voice numbers there. Absent: a staff of its own.
   */
  staff?: number;
  voices?: number[];
}

/** Who each AI voice is credited to, as its terms ask (REMY's and LYSE's tos.txt). */
export const VOICE_CREDITS: Record<string, string> = {
  REMY: "UTAU French Resources (Hisa!)",
  LYSE: "UTAU French Resources (valshamr)",
};

/**
 * The credit line shown while a song's sung parts play: every voice that sings them, in the
 * parts' order, each with its makers. A mixed choir's parts name two (#102).
 */
export function sungCredit(parts: Part[]): string {
  const voices = new Set(parts.length ? parts.map((p) => p.voice ?? "REMY") : ["REMY"]);
  const credited = [...voices].map((voice) => {
    const by = VOICE_CREDITS[voice];
    return `${voice}${by ? `, ${by}` : ""}`;
  });
  return `${words().sungBy} ${credited.join("; ")}`;
}

export interface SongSummary {
  slug: string;
  title: string;
  parts: Part[];
  duration: number;
  published_at: string;
  /** From the score; null or missing when it does not say. */
  composer?: string | null;
  lyricist?: string | null;
  arranger?: string | null;
}

/** Whether every part has a sung MP3 marked `sung` (rows from before #36 list piano MP3s). */
export function hasSungParts(parts: Part[]): boolean {
  return parts.length > 0 && parts.every((p) => p.sung === true && (p.file ?? "").endsWith(".mp3"));
}

type Credited = Pick<SongSummary, "composer" | "lyricist" | "arranger">;

/** "säv. X · san. Y · sov. Z", leaving out what is not known; "" when nothing is. The player's line. */
export function credits(song: Credited): string {
  const w = words();
  return joinCredits([[w.composerAbbr, song.composer], [w.lyricistAbbr, song.lyricist], [w.arrangerAbbr, song.arranger]]);
}

/** The song lists' shorter line: "säv. X · sov. Y", never the lyricist (Eero, PR #33 review). */
export function listCredits(song: Credited): string {
  const w = words();
  return joinCredits([[w.composerAbbr, song.composer], [w.arrangerAbbr, song.arranger]]);
}

function joinCredits(pairs: [string, string | null | undefined][]): string {
  return pairs
    .filter(([, name]) => typeof name === "string" && name.trim())
    .map(([label, name]) => `${label} ${name!.trim()}`)
    .join(" · ");
}

/** A choir's named song list in its own order, such as a concert's program. */
export interface Setlist {
  id: number;
  name: string;
  /** Song slugs, in order. */
  songs: string[];
}

/** A singer's open request for a new practice track (#38), as every singer sees it. */
export interface SongRequest {
  id: number;
  /** Null when only a PDF was sent. */
  title: string | null;
  credits: string | null;
  note: string | null;
  pdf: boolean;
  created_at: string;
}

/** What a singer can say is wrong with a published song (#41), in the order the form shows them. */
export const FLAG_PROBLEMS = {
  notes: "Väärä nuotti",
  part: "Väärä stemma",
  lyrics: "Sanat",
  timing: "Rytmi / ajoitus",
  sound: "Ääni",
  other: "Muu",
} as const;
export type FlagProblem = keyof typeof FLAG_PROBLEMS;

/** The problems' labels in the language shown now (FLAG_PROBLEMS is the Finnish). */
export const flagProblems = (): Record<FlagProblem, string> => words().flagProblems;

/** "Väärä nuotti, Sanat": the problems ticked, as the singer saw them. */
export function problemLabels(problems: string[]): string {
  const labels = flagProblems();
  return problems.map((p) => labels[p as FlagProblem] ?? p).join(", ");
}

/** An open flag on a song (#41), as every singer sees it: without who sent it. */
export interface SongFlag {
  id: number;
  bar: number | null;
  problems: string[];
  note: string | null;
  created_at: string;
}

export interface Song extends SongSummary {
  choir: string;
  base: string;
  flags: SongFlag[];
  /** The voice tree (#107), for carrying a singer's part between differently named parts. */
  voices?: Voice[];
}

/** A refusal the page should show rather than an error: 401, 403 or 404. */
export class Refused extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", headers: { "X-Lang": lang.value } });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new Refused(response.status);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Lang": lang.value },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

/**
 * A multipart POST (a form with a file). The custom header is the CSRF guard:
 * a cross-site HTML form cannot set it.
 */
export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Stemmanauhat": "1", "X-Lang": lang.value },
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  // A 413 from the proxy in front of the Worker has no message of ours (#77).
  if (response.status === 413 && !data.error) throw new Error(words().pdfTooBig);
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

/** Per choir, in this browser: the part you sing and the song you played last. */
export const remembered = {
  part: (choir: string) => localStorage.getItem(`stemmanauhat:${choir}:part`),
  setPart: (choir: string, part: string) => localStorage.setItem(`stemmanauhat:${choir}:part`, part),
  last: (choir: string) => localStorage.getItem(`stemmanauhat:${choir}:last`),
  setLast: (choir: string, slug: string) => localStorage.setItem(`stemmanauhat:${choir}:last`, slug),
  /** The score's zoom on this device, for every song. */
  zoom: () => {
    const value = Number(localStorage.getItem("stemmanauhat:zoom"));
    return value >= 0.5 && value <= 2 ? value : 1;
  },
  setZoom: (zoom: number) => localStorage.setItem("stemmanauhat:zoom", String(zoom)),
  /** How the song lists are sorted on this device: popular lately (the default, #89), by name or newest first. */
  order: (): SongOrder => {
    const value = localStorage.getItem("stemmanauhat:order");
    return value === "name" || value === "date" ? value : "popular";
  },
  setOrder: (order: SongOrder) => localStorage.setItem("stemmanauhat:order", order),
  /** The setlist picked for this choir's list, or null for every song. */
  setlist: (choir: string) => {
    const value = Number(localStorage.getItem(`stemmanauhat:${choir}:setlist`));
    return Number.isInteger(value) && value > 0 ? value : null;
  },
  setSetlist: (choir: string, id: number | null) => {
    if (id === null) localStorage.removeItem(`stemmanauhat:${choir}:setlist`);
    else localStorage.setItem(`stemmanauhat:${choir}:setlist`, String(id));
  },
};

/** The song lists kept for this tab (SongList.vue, #43). */
export const songListKey = (choir: string) => `stemmanauhat:list:${choir}`;

/** Forgets every kept song list, so a signed-out tab never draws one. */
export function forgetSongLists() {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("stemmanauhat:list:")) sessionStorage.removeItem(key);
  }
}

export type SongOrder = "popular" | "name" | "date";

export type MixMode = "focus" | "equal" | "minus" | "solo";

/** What this browser remembers about one song: the singer's part there. */
export interface SongMemory {
  part?: string;
  /** The tempo this song was left at before tempo carried between songs (eerovil/stemmanauhat-cf#24). */
  rate?: number;
  /** Säädöt › Lisäasetukset: each sung part's own volume by part name, 1 as it is (eerovil/stemmanauhat-cf#117). */
  volumes?: Record<string, number>;
}

export function songMemory(choir: string, slug: string): SongMemory {
  try {
    const value = JSON.parse(localStorage.getItem(`stemmanauhat:song:${choir}/${slug}`) ?? "{}");
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}

export function rememberSong(choir: string, slug: string, change: Partial<SongMemory>): void {
  const key = `stemmanauhat:song:${choir}/${slug}`;
  localStorage.setItem(key, JSON.stringify({ ...songMemory(choir, slug), ...change }));
}

/** Settings that follow the singer from song to song (on this device). */
export interface CarriedSettings {
  mode?: MixMode;
  others?: number;
  staves?: "all" | "own";
  /** The tempo, 0.5–1.5 of the written one. */
  rate?: number;
  /** "sung": play a song's sung parts when it has them; the piano otherwise (the default). */
  sound?: "piano" | "sung";
  /** Säädöt › Lisäasetukset (#117): dB the sung parts sing louder an octave lower, 0–12. */
  lowLouder?: number;
  /** The key that sings as recorded: middle C (60), the song's mean or the moment's. */
  middle?: 60 | "song" | "moment";
}

/** A tempo the player accepts: 0.5–1.5 of the written one. */
export function validRate(value: unknown): number | undefined {
  return typeof value === "number" && value >= 0.5 && value <= 1.5 ? value : undefined;
}

export function carriedSettings(): CarriedSettings {
  try {
    const value = JSON.parse(localStorage.getItem("stemmanauhat:settings") ?? "{}");
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}

export function carrySettings(change: CarriedSettings): void {
  localStorage.setItem("stemmanauhat:settings", JSON.stringify({ ...carriedSettings(), ...change }));
}
