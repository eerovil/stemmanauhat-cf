export interface Choir {
  id: string;
  name: string;
  public: boolean;
}

export interface Me {
  email: string | null;
  linked: string[];
  admin: boolean;
  choirs: Choir[];
}

export interface Part {
  name: string;
  file: string;
}

export interface SongSummary {
  slug: string;
  title: string;
  parts: Part[];
  duration: number;
  published_at: string;
}

export interface Song extends SongSummary {
  choir: string;
  base: string;
}

/** A refusal the page should show rather than an error: 401, 403 or 404. */
export class Refused extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
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
  /** One scrolling line (true) or page lines (false), on this device. */
  singleLine: () => localStorage.getItem("stemmanauhat:single-line") === "1",
  setSingleLine: (on: boolean) => localStorage.setItem("stemmanauhat:single-line", on ? "1" : "0"),
  hidden: (choir: string): string[] => {
    try {
      const value = JSON.parse(localStorage.getItem(`stemmanauhat:${choir}:hidden`) ?? "[]");
      return Array.isArray(value) ? value.filter((n) => typeof n === "string") : [];
    } catch {
      return [];
    }
  },
  setHidden: (choir: string, names: string[]) =>
    localStorage.setItem(`stemmanauhat:${choir}:hidden`, JSON.stringify(names)),
};
