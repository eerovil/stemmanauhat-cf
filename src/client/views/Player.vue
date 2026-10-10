<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  carriedSettings, carrySettings, getJson, Refused, remembered, rememberSong, songMemory,
  type Me, type MixMode, type Song,
} from "../api";
import Icon from "../components/Icon.vue";
import { FilePlayer, wantsFilePlayback } from "../player/file-player";
import { MidiPlayer } from "../player/midi";
import { SlidingPieces } from "../player/slide";
import { DEFAULT_OTHERS, gainOf } from "../player/mix";
import type { Score } from "../player/score";
import { buildCurve, curveAt, JUMP_FRACTION, SmoothClock, timeAtX, type ScrollCurve } from "../player/scroll";
import { barLengths, nearest, parseTiming, positionAt, startsOf, timeOf, type Timing } from "../player/timing";
import RefusedView from "./Refused.vue";

const props = defineProps<{ choir: string; slug: string }>();

const song = ref<Song | null>(null);
const me = ref<Me | null>(null);
const refused = ref<number | null>(null);
const loading = ref(true);
const failure = ref("");
/** What the loading message says while the piano loads. */
const loadingNote = ref("");

const myPart = ref(0);
const rate = ref(1);
const playing = ref(false);
const now = ref(0);
const bar = ref(1);
const barCount = ref(1);
/** The gain each part plays at (shown to tests on the panel). */
const levels = ref<number[]>([]);
/** Whether sound is coming out (checked while playing). */
const sounding = ref(false);

/** How the voices are mixed: the four ways singers practise (Eero, 2026-10-10). */
const mode = ref<MixMode>("focus");
const others = ref(DEFAULT_OTHERS);
const MODES: { id: MixMode; label: string; hint: string }[] = [
  { id: "focus", label: "Oma esillä", hint: "Oma stemma kovaa, muut hiljempaa" },
  { id: "equal", label: "Tasan", hint: "Kaikki stemmat yhtä kovaa, kuin kuorossa" },
  { id: "minus", label: "Ilman omaa", hint: "Oma stemma hiljaa: laula se itse" },
  { id: "solo", label: "Vain oma", hint: "Pelkkä oma stemma" },
];

/**
 * Two ways to see the score: "Kaikki" is every staff that fits, on one line
 * scrolling sideways under a fixed cursor like the old videos; "Oma" is your own
 * staff alone, wrapped into page lines like a part sheet, the page following.
 */
type StaffMode = "all" | "own";
const staffMode = ref<StaffMode>("all");
const singleLine = computed(() => staffMode.value === "all");
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
/**
 * The note size: a staff is always the same height on this device, however many
 * staves the song has and whichever view shows it (Eero, eerovil/stemmanauhat-cf#24).
 */
const zoom = ref(remembered.zoom());

const sheetOpen = ref(false);
const askPart = ref(false);
/** True on the very first ask for this song: a part has to be chosen. */
const firstAsk = ref(false);
const showHint = ref(false);

const scrollBox = ref<HTMLElement | null>(null);
const scoreBox = ref<HTMLElement | null>(null);
const cursor = ref<HTMLElement | null>(null);
const dock = ref<HTMLElement | null>(null);
const dockHeight = ref(0);
const dockObserver = new ResizeObserver(([entry]) => {
  dockHeight.value = entry ? (entry.target as HTMLElement).offsetHeight : 0;
});

/** Where the sung note sits across the screen in the one-line view: the videos' playhead. */
const PLAYHEAD = 0.35;
const smoothClock = new SmoothClock();
let curve: ScrollCurve | null = null;
let curveVersion = -1;

let mixer: MidiPlayer | FilePlayer | null = null;
/** Firefox on Android slides the one-line view as moving picture pieces (player/slide.ts). */
let pieces: SlidingPieces | null = null;
let score: Score | null = null;
let timing: Timing | null = null;
let frame = 0;
let lastTop = -1;
let resizeTimer: number | undefined;
/** The width the score was last laid out for: only a new width needs a new layout. */
let laidOutWidth = 0;

const duration = computed(() => song.value?.duration ?? 0);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

onMounted(async () => {
  me.value = await getJson<Me>("/api/me");
  try {
    song.value = await getJson<Song>(`/api/songs/${encodeURIComponent(props.choir)}/${encodeURIComponent(props.slug)}`);
  } catch (error) {
    if (error instanceof Refused) { refused.value = error.status; return; }
    throw error;
  }
  const s = song.value;
  document.title = `${s.title} – Stemmanauhat`;
  remembered.setLast(props.choir, props.slug);

  // The part: this song's, else the one usually sung in this choir, else ask.
  // Part names and divisi change from song to song, so never guess.
  const memory = songMemory(props.choir, props.slug);
  const indexOf = (name: string | null | undefined) => (name ? s.parts.findIndex((p) => p.name === name) : -1);
  let part = indexOf(memory.part);
  if (part < 0) part = indexOf(remembered.part(props.choir));
  myPart.value = Math.max(0, part);
  askPart.value = firstAsk.value = part < 0;
  showHint.value = !localStorage.getItem("stemmanauhat:hint-seen");
  // The settings follow the singer from song to song; the part belongs to the song.
  const carried = carriedSettings();
  staffMode.value = carried.staves === "own" ? "own" : "all";

  try {
    const [xml, timingJson] = await Promise.all([
      fetch(s.base + "score.musicxml").then((r) => r.text()),
      fetch(s.base + "timing.json").then((r) => r.json()),
    ]);
    timing = parseTiming(timingJson);
    barCount.value = timing.measures;
    mixer = await (wantsFilePlayback() ? FilePlayer : MidiPlayer).create(s.base + "score.mid", s.parts.map((p) => p.name),
      (note) => { loadingNote.value = note; });
    mixer.setMaster(myPart.value);
    mixer.onEnded = () => { playing.value = false; };
    setMode(carried.mode ?? "focus", false);
    if (carried.others !== undefined && carried.mode !== "minus" && carried.mode !== "solo") setOthers(carried.others, false);
    if (carried.rate) setRate(carried.rate, false);
    loading.value = false;
    // The score box exists only once loading is false.
    await new Promise(requestAnimationFrame);
    // OpenSheetMusicDisplay is most of the app's size: load it only on a song page.
    const { Score } = await import("../player/score");
    score = new Score(scoreBox.value!);
    score.barLengths = barLengths(timing);
    if (dock.value) dockObserver.observe(dock.value);
    score.singleLine = singleLine.value;
    score.zoom = zoom.value;
    await score.load(xml, visibleParts());
    laidOutWidth = window.innerWidth;
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(tick);
  } catch (error) {
    failure.value = String(error);
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  dockObserver.disconnect();
  window.removeEventListener("resize", onResize);
  mixer?.destroy();
  pieces?.destroy();
});

/** The screen stays on while playing: singers sing along without touching the phone. */
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed (battery saver, hidden tab): the screen may sleep */ }
}
watch(playing, (on) => { void keepAwake(on); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && playing.value) void keepAwake(true);
});

function reload() {
  location.reload();
}

/**
 * Laid out again only for a new width (page lines re-wrap, a phone turns). A
 * phone's address bar showing or hiding changes just the height: laying out
 * then made the one-line view jump in the middle of a song.
 */
function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (window.innerWidth === laidOutWidth) return;
    laidOutWidth = window.innerWidth;
    score?.render();
    lastTop = -1;
  }, 250);
}

/**
 * `frameTime` is when this frame will be shown. Everything is placed for that
 * moment, not for when this code happens to run: on a busy frame (a note
 * changing colour, say) the code runs late, and a position read from the clock
 * then would land a few milliseconds ahead and make the scroll hitch.
 */
function tick(frameTime: number) {
  frame = requestAnimationFrame(tick);
  if (!mixer || !timing || !score) return;
  const late = mixer.running ? ((performance.now() - frameTime) / 1000) * rate.value : 0;
  const t = drag?.moved ? drag.t : smoothClock.read(mixer.time() - late, mixer.running, rate.value, frameTime);
  // The time and the progress bar show tenths at most: updating them every frame
  // re-rendered the controls 60 times a second, which a phone feels.
  const shown = Math.round(t * 10) / 10;
  if (shown !== now.value) now.value = shown;
  playing.value = mixer.playing;
  if (mixer.running && frame % 15 === 0) sounding.value = mixer.sounding();
  const position = positionAt(timing, t);
  bar.value = position.measure + 1;
  const started = t > 0 || mixer.playing;
  const lit = score.light(started ? position.measure : null, position.beat, myPart.value);
  const spot = score.marker(position.measure, position.beat);
  const el = cursor.value;
  if (!spot || !el) return;
  // Written only when they change: each write makes the browser restyle the page.
  setStyle(el, "transform", `translate(${spot.x0}px, ${spot.top}px)`);
  setStyle(el, "width", `${spot.x1 - spot.x0}px`);
  setStyle(el, "height", `${spot.bottom - spot.top}px`);
  if (el.dataset.measure !== String(position.measure)) el.dataset.measure = String(position.measure);
  if (el.dataset.lit !== String(lit)) el.dataset.lit = String(lit);
  if (singleLine.value) scrollTo(t);
  else if (spot.top !== lastTop) keepInView(spot.top, spot.bottom);
  lastTop = spot.top;
}

function setStyle(el: HTMLElement, name: "transform" | "width" | "height", value: string) {
  if (el.style[name] !== value) el.style[name] = value;
}

/** "Oma" view: scroll the page so the line being sung sits in the upper part of the screen. */
function keepInView(top: number, bottom: number) {
  const box = scoreBox.value;
  if (!box) return;
  const pageTop = box.getBoundingClientRect().top + window.scrollY;
  const visible = window.innerHeight - dockHeight.value;
  const lineTop = pageTop + top;
  if (lineTop < window.scrollY + 16 || pageTop + bottom > window.scrollY + visible - 16) {
    window.scrollTo({ top: Math.max(0, lineTop - visible * 0.2), behavior: "smooth" });
  }
}

/** One-line view: slide the line so the music sits at the playhead, along the smoothed curve. */
function scrollTo(t: number) {
  const box = scrollBox.value;
  const wrap = box?.firstElementChild as HTMLElement | null;
  if (!box || !wrap || !score || !timing) return;
  if (!curve || curveVersion !== score.version) {
    const s = score;
    const tm = timing;
    let last = 0;
    curve = buildCurve(duration.value, (sec) => {
      const p = positionAt(tm, sec);
      // A bar with nothing drawn stays where the music was, not at the song's start.
      last = s.xAt(p.measure, p.beat) ?? last;
      return last;
    }, box.clientWidth * JUMP_FRACTION);
    curveVersion = score.version;
  }
  const shift = box.clientWidth * PLAYHEAD;
  const vertical = verticalOffset(box.clientHeight);
  if (wantsFilePlayback() && mixer) {
    pieces ??= new SlidingPieces(box);
    pieces.build(score.version, scoreBox.value?.querySelector("svg:not(.highlights)") ?? null, wrap);
    // Until the pieces are drawn the line moves itself, below.
    if (pieces.ready(score.version)) {
      if (cursor.value && cursor.value.parentElement !== pieces.movers) pieces.movers.appendChild(cursor.value);
      score.highlightInto(pieces.movers);
      wrap.style.transform = "";
      wrap.style.willChange = "auto";
      pieces.follow(curve, `${curveVersion}:${shift}:${vertical}`, shift, vertical, box.clientWidth * JUMP_FRACTION,
        t, mixer.running && !drag?.moved, rate.value);
      return;
    }
  }
  const offset = Math.max(0, curveAt(curve, t) - shift);
  wrap.style.transform = `translate3d(${-offset}px, ${-vertical}px, 0)`;
}

/** Back from moving pieces to the drawn score (the page view). */
function leavePieces(wrap: HTMLElement | null) {
  if (!pieces) return;
  pieces.stop();
  score?.highlightInto(null);
  if (wrap) wrap.style.willChange = "";
  if (wrap && cursor.value && cursor.value.parentElement !== wrap) wrap.appendChild(cursor.value);
}

/** The line never scrolls up and down: centred when it fits, else centred on your staff. */
function verticalOffset(boxHeight: number): number {
  if (!score) return 0;
  const room = score.height - boxHeight;
  if (room <= 0) return room / 2;
  const span = score.partSpan(myPart.value);
  if (!span) return 0;
  return Math.min(room, Math.max(0, (span.top + span.bottom) / 2 - boxHeight / 2));
}

function changeZoom(step: number) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6);
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]!;
  if (next === zoom.value) return;
  zoom.value = next;
  remembered.setZoom(next);
  score?.setZoom(next);
  lastTop = -1;
}

/** Which parts' staves to draw: all, or only yours. */
function visibleParts(): boolean[] {
  return song.value!.parts.map((_, i) => singleLine.value || i === myPart.value);
}

async function setStaffMode(next: StaffMode) {
  if (!score || next === staffMode.value) return;
  staffMode.value = next;
  // Laid out once the page is in the new view: the one-line view's box is as wide as its content.
  await nextTick();
  carrySettings({ staves: next });
  const wrap = scrollBox.value?.firstElementChild as HTMLElement | null;
  if (wrap) wrap.style.transform = "";
  leavePieces(wrap);
  window.scrollTo(0, 0);
  score.singleLine = singleLine.value;
  score.setVisible(visibleParts());
  lastTop = -1;
}

function choosePart(index: number) {
  const ownStaffChanges = !singleLine.value && index !== myPart.value;
  myPart.value = index;
  const name = song.value!.parts[index]!.name;
  remembered.setPart(props.choir, name);
  rememberSong(props.choir, props.slug, { part: name });
  mixer?.setMaster(index);
  if (mixer) levels.value = mixer.effectiveLevels();
  if (ownStaffChanges && score) {
    score.setVisible(visibleParts());
    lastTop = -1;
  }
}

function pickPart(index: number) {
  choosePart(index);
  askPart.value = firstAsk.value = false;
}

function setOthers(value: number, save = true) {
  others.value = value;
  mixer?.setOthers(value);
  if (mixer) levels.value = mixer.effectiveLevels();
  if (save) carrySettings({ others: value });
}

/** One tap for each way of practising; the slider still fine-tunes the others. */
function setMode(next: MixMode, save = true) {
  mode.value = next;
  mixer?.setOwn(next !== "minus");
  const level = { focus: DEFAULT_OTHERS, equal: 1, minus: 1, solo: 0 }[next];
  setOthers(level, false);
  if (save) carrySettings({ mode: next, others: level });
}

function onOthersSlider(value: number) {
  if (mode.value === "solo" && value > 0) setMode("focus");
  setOthers(value);
}

function setRate(value: number, save = true) {
  rate.value = value;
  if (save) carrySettings({ rate: value });
  mixer?.setRate(value);
}

function stepTempo(delta: number) {
  setRate(Math.min(1.5, Math.max(0.5, Math.round((rate.value + delta) * 100) / 100)));
}

async function togglePlay() {
  if (!mixer) return;
  if (mixer.playing) mixer.pause();
  else {
    if (duration.value && mixer.time() >= duration.value - 0.05) mixer.seek(0);
    await mixer.play();
  }
  playing.value = mixer.playing;
  levels.value = mixer.effectiveLevels();
}

/** Jumps to a bar's play-through nearest where we are now (a repeat has several). */
function jumpTo(barIndex: number) {
  if (!timing || !mixer) return;
  const t = nearest(startsOf(timing, barIndex), mixer.time());
  if (t !== null) mixer.seek(t);
}

function seekTo(event: Event) {
  mixer?.seek(Number((event.target as HTMLInputElement).value));
}

function dismissHint() {
  showHint.value = false;
  localStorage.setItem("stemmanauhat:hint-seen", "1");
}

function closePanels() {
  sheetOpen.value = false;
}

/**
 * A tap on the score plays or pauses; in the "Oma" page view a tap on a note
 * moves there instead. With a panel open it just closes the panel.
 */
function onScoreClick(event: MouseEvent) {
  if (dragJustEnded) { dragJustEnded = false; return; }
  if (showHint.value) dismissHint();
  if (sheetOpen.value) { closePanels(); return; }
  if (!singleLine.value && seekToNote(event)) return;
  void togglePlay();
}

/** Moves to the note tapped, in the play-through nearest now; playing or paused stays as it was. */
function seekToNote(event: MouseEvent): boolean {
  const box = scoreBox.value;
  if (!box || !score || !timing || !mixer) return false;
  const rect = box.getBoundingClientRect();
  const note = score.noteAt(event.clientX - rect.left, event.clientY - rect.top);
  const t = note ? timeOf(timing, note.measure, note.beat, mixer.time()) : null;
  if (t === null) return false;
  mixer.seek(t);
  return true;
}

/**
 * In the one-line view, dragging the score sideways moves through the song:
 * left is forward. A tap without moving is still a tap.
 */
interface Drag { pointer: number; startX: number; startT: number; t: number; moved: boolean; resume: boolean }
let drag: Drag | null = null;
let dragJustEnded = false;
const DRAG_THRESHOLD = 8;

function onPointerDown(event: PointerEvent) {
  if (!singleLine.value || !mixer || !curve) return;
  const t = mixer.time();
  drag = { pointer: event.pointerId, startX: event.clientX, startT: t, t, moved: false, resume: false };
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer || !curve || !mixer) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    // The sound waits while the score is dragged and starts again where it is let go.
    drag.resume = mixer.playing;
    if (drag.resume) mixer.pause();
  }
  drag.t = Math.min(duration.value, timeAtX(curve, curveAt(curve, drag.startT) - dx, drag.startT));
}

function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  if (drag.moved && mixer) {
    mixer.seek(drag.t);
    if (drag.resume) void mixer.play();
    // Swallow the click that may end a drag, but only that one: browsers do not
    // always send it, and a stale flag would eat the next real tap.
    dragJustEnded = true;
    window.setTimeout(() => { dragJustEnded = false; }, 0);
  }
  drag = null;
}
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else class="player" :class="{ 'one-line': singleLine }"
    :style="{ paddingBottom: `${dockHeight + (singleLine ? 0 : 16)}px` }">
    <p v-if="loading" class="hint page">{{ loadingNote || "Ladataan…" }}</p>
    <p v-else-if="failure" class="error page" role="alert">
      Kappaleen lataus epäonnistui: {{ failure }}
      <button type="button" class="link" @click="reload">Yritä uudelleen</button>
    </p>

    <template v-else-if="song">
      <div ref="scrollBox" class="score-scroll" :class="{ 'single-line': singleLine }" data-testid="score-scroll"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
        @pointercancel="onPointerUp">
        <div class="score-wrap">
          <div ref="scoreBox" class="score" data-testid="score" @click="onScoreClick"></div>
          <div ref="cursor" class="cursor" data-testid="cursor" aria-hidden="true"></div>
        </div>
      </div>

      <!-- A one-time hint: a small card above the dock, like the other sheets. -->
      <div v-if="showHint && !askPart && !sheetOpen" class="hint-card" role="note" :style="{ bottom: `${dockHeight + 12}px` }">
        <ul>
          <li v-if="singleLine"><Icon name="tap" :size="20" /><span><b>Napauta</b> nuottia: soita tai pysäytä</span></li>
          <li v-else><Icon name="tap" :size="20" /><span><b>Napauta</b> nuottia: siirry siihen</span></li>
          <li v-if="singleLine"><Icon name="scroll" :size="20" /><span><b>Vedä</b> nuottia sivulle: siirry</span></li>
        </ul>
        <button type="button" @click="dismissHint">Selvä</button>
      </div>

      <!-- Säädöt: a sheet just above the dock; a tap on the dimmed score closes it. -->
      <div v-if="sheetOpen" class="backdrop" @click="closePanels"></div>
      <div v-if="sheetOpen" class="sheet" :style="{ bottom: `${dockHeight - 1}px` }">
        <div class="handle" aria-hidden="true"></div>
        <div class="section-label">Kuuntelu</div>
        <div class="segmented modes" role="group" aria-label="Miten kuuntelet">
          <button v-for="m in MODES" :key="m.id" type="button" :class="{ on: mode === m.id }"
            :aria-pressed="mode === m.id" @click="setMode(m.id)">{{ m.label }}</button>
        </div>
        <div class="mode-hint">{{ MODES.find((m) => m.id === mode)?.hint }}</div>
        <div v-if="mode !== 'solo'" class="others-row">
          <span class="row-label">Muut stemmat</span>
          <input type="range" min="0" max="1" step="0.01" :value="others" aria-label="Muiden stemmojen voimakkuus"
            @input="onOthersSlider(Number(($event.target as HTMLInputElement).value))" />
          <span class="others-value">{{ Math.round(gainOf(others) * 100) }} %</span>
        </div>
        <div class="setting">
          <span class="row-label">Tempo</span>
          <div class="stepper" role="group" aria-label="Tempo">
            <button type="button" aria-label="Hitaammin" :disabled="rate <= 0.5" @click="stepTempo(-0.05)">−</button>
            <button type="button" class="value" aria-label="Normaali tempo" @click="setRate(1)">
              {{ rate === 1 ? "Normaali" : `${Math.round(rate * 100)} %` }}</button>
            <button type="button" aria-label="Nopeammin" :disabled="rate >= 1.5" @click="stepTempo(0.05)">+</button>
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-label">Nuotti</div>
        <div class="setting">
          <span class="row-label">Viivastot</span>
          <div class="segmented two" role="group" aria-label="Viivastot">
            <button type="button" :class="{ on: staffMode === 'all' }" :aria-pressed="staffMode === 'all'"
              @click="setStaffMode('all')">Kaikki</button>
            <button type="button" :class="{ on: staffMode === 'own' }" :aria-pressed="staffMode === 'own'"
              @click="setStaffMode('own')">Oma</button>
          </div>
        </div>
        <div class="setting">
          <span class="row-label">Nuotin koko</span>
          <div class="stepper" role="group" aria-label="Nuotin koko">
            <button type="button" aria-label="Pienennä nuottia" :disabled="zoom <= ZOOMS[0]!" @click="changeZoom(-1)">−</button>
            <span class="value">{{ Math.round(zoom * 100) }} %</span>
            <button type="button" aria-label="Suurenna nuottia" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!"
              @click="changeZoom(1)">+</button>
          </div>
        </div>
      </div>

      <!-- The dock: the position line on its top edge, then one row. -->
      <section ref="dock" class="dock" :data-gains="levels.map((g) => g.toFixed(3)).join(' ')">
        <input class="progress" type="range" min="0" :max="duration" step="0.1" :value="now"
          :style="{ '--fill': `${duration ? (now / duration) * 100 : 0}%` }" aria-label="Kohta kappaleessa"
          @input="seekTo" />
        <div class="dock-row">
          <a :href="`/c/${encodeURIComponent(props.choir)}`" class="back" aria-label="Takaisin lauluihin">
            <Icon name="chevronLeft" :size="24" /></a>
          <div class="info">
            <span class="info-title">{{ song.title }}</span>
            <span class="info-meta">Tahti {{ bar }} / {{ barCount }} ·
              <span data-testid="time">{{ clock(now) }}</span> / {{ clock(duration) }}</span>
          </div>
          <button type="button" class="own" aria-label="Vaihda oma stemma" @click="askPart = true">
            <span class="own-tag">Oma</span><span class="own-name">{{ song.parts[myPart]?.name }}</span></button>
          <button type="button" class="play" :aria-label="playing ? 'Tauko' : 'Soita'"
            :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
          <button type="button" class="settings" :class="{ on: sheetOpen }" :aria-expanded="sheetOpen"
            :aria-label="sheetOpen ? 'Sulje säädöt' : 'Säädöt'" @click="sheetOpen = !sheetOpen">
            <Icon :name="sheetOpen ? 'close' : 'more'" :size="22" /></button>
        </div>
      </section>

      <!-- Oma stemma: a sheet from the bottom, over everything. On the first visit a part must be picked. -->
      <template v-if="askPart">
        <div class="picker-backdrop" @click="if (!firstAsk) askPart = false;"></div>
        <div class="picker" role="dialog" aria-label="Valitse oma stemma">
          <div class="handle" aria-hidden="true"></div>
          <h2>Mikä on sinun stemmasi?</h2>
          <p>Se soi kovimmin ja sen nuotit näkyvät tummalla sinisellä. Voit vaihtaa sitä myöhemmin napauttamalla Oma-painiketta.</p>
          <div class="picker-grid">
            <button v-for="(p, i) in song.parts" :key="p.file" type="button"
              :class="{ mine: i === myPart && !firstAsk }" @click="pickPart(i)">{{ p.name }}</button>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>
