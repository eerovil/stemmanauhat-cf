/**
 * The song list's notice that the site can be installed as an app (#91).
 *
 * Chrome and Edge (Android and desktop) offer their own install prompt, which
 * the notice's button opens; iPhone and iPad have none, so there it says how
 * (Share › Add to Home Screen). It is shown on at most a few visits, never once
 * the site runs as the installed app, and never again once dismissed or installed.
 */
import { ref } from "vue";

/** Chrome's install prompt event; not in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DONE_KEY = "stemmanauhat:install-done";
const VISITS_KEY = "stemmanauhat:install-visits";
const VISIT_KEY = "stemmanauhat:install-visit";
/** On this many visits (tab sessions) at most. */
export const INSTALL_VISITS = 3;

/** The browser's install prompt, once it has offered one. */
export const installPrompt = ref<InstallPromptEvent | null>(null);
/** Installed from this tab: the notice goes. */
export const installed = ref(false);

/** Called once at start, so a prompt offered before the song list mounts is kept. */
export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // The notice offers it, not the browser's own bar.
    installPrompt.value = event as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt.value = null;
    markDone();
    installed.value = true;
  });
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
 * Whether this visit may show the notice: not dismissed or installed, and one
 * of the first few visits. A visit counts once, however many pages it opens.
 */
export function noticeAllowed(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
    if (sessionStorage.getItem(VISIT_KEY)) return true;
    const visits = Number(localStorage.getItem(VISITS_KEY)) || 0;
    if (visits >= INSTALL_VISITS) return false;
    localStorage.setItem(VISITS_KEY, String(visits + 1));
    sessionStorage.setItem(VISIT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** True once per tab session for `key`: an event sent once per visit. */
export function firstThisVisit(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
