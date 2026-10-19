/**
 * The song list's notice that the site can be installed as an app (#91).
 *
 * Chrome and Edge (Android and desktop) offer their own install prompt, which
 * the notice's button opens; iPhone and iPad have none, so there it says how
 * (Share › Add to Home Screen). It is shown on at most a few pages, never once
 * the site runs as the installed app, and never again once dismissed or installed.
 */
import { ref } from "vue";
import { track } from "./track";

/** Chrome's install prompt event; not in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DONE_KEY = "stemmanauhat:install-done";
const SHOWN_KEY = "stemmanauhat:install-showings";
/** Shown on this many song list pages at most, coming back from a song included. */
export const INSTALL_SHOWINGS = 3;

/** The browser's install prompt, once it has offered one. */
export const installPrompt = ref<InstallPromptEvent | null>(null);
/** Installed from this tab: the notice goes. */
export const installed = ref(false);

/** The choir of this page (/c/<choir> or /c/<choir>/<song>), which usage events need. */
export function pageChoir(): string | null {
  const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return parts[0] === "c" && parts[1] ? parts[1] : null;
}

/**
 * Called once at start, so a prompt offered before the song list mounts is kept,
 * an install from the browser's own menu is counted too, and every page of the
 * installed app (a song list or a player) counts it as used.
 */
export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // The notice offers it, not the browser's own bar.
    installPrompt.value = event as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt.value = null;
    markDone();
    installed.value = true;
    const choir = pageChoir();
    if (choir) track("install_accept", { choir });
  });
  const choir = pageChoir();
  if (choir && standalone()) {
    markDone();
    if (firstThisVisit(`stemmanauhat:app-open:${choir}`)) track("app_open", { choir });
  }
}

/** Running as the installed app. */
export function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad, where only Share › Add to Home Screen installs (iPadOS says it is a Mac). */
export function ios(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function markDone(): void {
  try { localStorage.setItem(DONE_KEY, "1"); } catch { /* no storage: it may show again */ }
}

/**
 * Whether this page may show the notice: not dismissed or installed, and one of
 * the first few showings on this device. Each yes counts as a showing.
 */
export function noticeAllowed(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
    const shown = Number(localStorage.getItem(SHOWN_KEY)) || 0;
    if (shown >= INSTALL_SHOWINGS) return false;
    localStorage.setItem(SHOWN_KEY, String(shown + 1));
    return true;
  } catch {
    return false;
  }
}

/** True once per tab session for `key`: an event sent once per visit (per choir, as the admin page counts). */
export function firstThisVisit(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
