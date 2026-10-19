/**
 * iOS Safari zooms on a double tap even under `touch-action: manipulation` (only `none` stops
 * it, until WebKit's fix ships: https://bugs.webkit.org/show_bug.cgi?id=319664). There, the
 * second of two quick taps has its default cancelled, which stops the zoom, and is sent on as
 * the click it would have been, so quick taps on −/+ still each count (#92). Pinch-zoom stays.
 */
const DOUBLE_TAP_MS = 350;
const TAP_SLOP = 10;
/** How far apart two taps may be and still make a double tap. */
const DOUBLE_TAP_SLOP = 40;

export function isIOS(nav: Navigator = navigator): boolean {
  // iPadOS says it is a Mac, but a Mac has no touch screen.
  return /iP(hone|ad|od)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** Text fields keep their own double tap (selecting a word). */
function typesText(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["button", "submit", "reset", "checkbox", "radio", "range"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

export function preventDoubleTapZoom(doc: Document = document): void {
  let start: { x: number; y: number } | null = null;
  let lastTap: { at: number; x: number; y: number } | null = null;
  doc.addEventListener("touchstart", (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    start = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, { passive: true });
  doc.addEventListener("touchend", (event) => {
    const touch = event.changedTouches.length === 1 ? event.changedTouches[0] : undefined;
    const tap = start && touch && event.touches.length === 0 &&
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) < TAP_SLOP;
    start = null;
    if (!tap || !touch) { lastTap = null; return; }
    const here = { at: event.timeStamp, x: touch.clientX, y: touch.clientY };
    const second = lastTap !== null && here.at - lastTap.at < DOUBLE_TAP_MS &&
      Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < DOUBLE_TAP_SLOP;
    lastTap = second ? null : here;
    const target = event.target;
    if (!second || !event.cancelable || !(target instanceof Element) || typesText(target)) return;
    event.preventDefault();
    // Sent from inside the tap, so it may still start the sound as iPhones require.
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window, detail: 1,
      clientX: touch.clientX, clientY: touch.clientY, screenX: touch.screenX, screenY: touch.screenY,
    }));
  }, { passive: false });
}
