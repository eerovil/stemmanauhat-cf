<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { carriedSettings, carrySettings, getJson, Refused, remembered, rememberSong, songMemory, type Me, type MixMode, type Song } from "../api";
import Icon from "../components/Icon.vue";
import { ui } from "../ui";
import { MidiPlayer } from "../player/midi";
import { DEFAULT_OTHERS } from "../player/mix";
import type { Score } from "../player/score";
import { buildCurve, curveAt, JUMP_FRACTION, SmoothClock, timeAtX, type ScrollCurve } from "../player/scroll";
import { loopRange, loopTarget, nearest, parseTiming, positionAt, previousBarStart, startsOf, type Timing } from "../player/timing";
import RefusedView from "./Refused.vue";

const props = defineProps<{ choir: string; slug: string }>();

const song = ref<Song | null>(null);
const me = ref<Me | null>(null);
const refused = ref<number | null>(null);
const loading = ref(true);
const failure = ref("");

const myPart = ref(0);
const others = ref(DEFAULT_OTHERS);
const solo = ref(false);
const rate = ref(1);
const playing = ref(false);
const now = ref(0);
const levels = ref<number[]>([]);
/** What the loading message says while the piano loads. */
const loadingNote = ref("");
/** Whether sound is coming out (checked while playing). */
const sounding = ref(false);
// Other parts' staves the singer has hidden, by part name (remembered per choir).
const hidden = ref<string[]>([]);
const stavesOpen = ref(false);
const zoom = ref(remembered.zoom());
// Two ways to see the score (Eero, 2026-10-10): "Normaali" is every staff that
// fits, on one line scrolling sideways; "Oma viivasto" is your own staff alone,
// wrapped into page lines like a part sheet, the page following the music.
type StaffMode = "all" | "own";
const staffMode = ref<StaffMode>("all");
const singleLine = ref(true);
/** With "Oma viivasto" the size is the singer's zoom times this (a single staff can be big). */
const OWN_ZOOM = window.innerWidth < 600 ? 1.5 : 1.2;
/** The zoom at which the visible staves fill the score area; the − / + buttons scale from it. */
let fitZoom = 1;
const scrollBox = ref<HTMLElement | null>(null);
/** Where the sung note sits across the screen in the one-line view: the videos' playhead. */
const PLAYHEAD = 0.35;
const smoothClock = new SmoothClock();
let curve: ScrollCurve | null = null;
let curveVersion = -1;
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

// Loop: "pick-start" -> "pick-end" -> on.
const loopMode = ref<"off" | "pick-start" | "pick-end" | "on">("off");
const loopBars = ref<[number, number] | null>(null);

const scoreBox = ref<HTMLElement | null>(null);
const controlsBox = ref<HTMLElement | null>(null);
const controlsHeight = ref(0);
// PROTOTYPE: which design, and its open panels.
const sheetOpen = ref(false);
const askPart = ref(false);
/** True on the very first ask for this song, when no part is chosen yet. */
const firstAsk = ref(false);
/** How the voices are mixed: the four ways singers practise. */
const mode = ref<MixMode>("focus");
const MODES: { id: MixMode; label: string; short: string; hint: string }[] = [
  { id: "focus", label: "Oma esillä", short: "Oma esillä", hint: "Oma stemma kovaa, muut hiljempaa" },
  { id: "equal", label: "Kaikki tasan", short: "Tasan", hint: "Kaikki stemmat yhtä kovaa, kuin kuorossa" },
  { id: "minus", label: "Ilman omaa", short: "Ilman omaa", hint: "Oma stemma hiljaa: laula se itse" },
  { id: "solo", label: "Vain oma", short: "Vain oma", hint: "Pelkkä oma stemma" },
];
const bar = ref(1);
const barCount = ref(1);
const goToOpen = ref(false);
const goToValue = ref("");
const offeredLoop = ref<[number, number] | null>(null);
const showHint = ref(false);
function dismissHint() {
  showHint.value = false;
  localStorage.setItem("stemmanauhat:hint-seen", "1");
}
function pickFirstPart(i: number) {
  choosePart(i);
  askPart.value = false;
  firstAsk.value = false;
}
function stepTempo(delta: number) {
  setRate(Math.min(1.5, Math.max(0.5, Math.round((rate.value + delta) * 100) / 100)));
}
const popover = ref<null | "others" | "tempo" | "staves">(null);
const sideQuery = window.matchMedia("(min-width: 900px), (orientation: landscape) and (max-height: 520px)");
const wide = ref(ui === "c" && sideQuery.matches);
sideQuery.addEventListener("change", (e) => { wide.value = ui === "c" && e.matches; });
/** How much of the bottom the controls cover (none when they sit at the side). */
const bottomSpace = computed(() => (wide.value ? 0 : controlsHeight.value));
function togglePopover(name: "others" | "tempo" | "staves") {
  popover.value = popover.value === name ? null : name;
}
const controlsObserver = new ResizeObserver(([entry]) => {
  controlsHeight.value = entry ? (entry.target as HTMLElement).offsetHeight : 0;
});
const cursor = ref<HTMLElement | null>(null);

let mixer: MidiPlayer | null = null;
let score: Score | null = null;
let timing: Timing | null = null;
let frame = 0;
/** The loop's [start, end] in seconds, fixed until the loop bars change or a seek. */
let loopWindow: [number, number] | null = null;
let lastTop = -1;
let resizeTimer: number | undefined;

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
  askPart.value = part < 0;
  firstAsk.value = part < 0;
  showHint.value = !localStorage.getItem("stemmanauhat:hint-seen");
  // The listening mix and the staves follow the singer from song to song;
  // the part and the tempo belong to the song.
  const carried = carriedSettings();
  staffMode.value = carried.staves === "own" ? "own" : "all";
  singleLine.value = staffMode.value === "all";
  hidden.value = staffMode.value === "own" ? s.parts.filter((_, i) => i !== myPart.value).map((p) => p.name) : [];
  offeredLoop.value = memory.loop ?? null;

  try {
    const [xml, timingJson] = await Promise.all([
      fetch(s.base + "score.musicxml").then((r) => r.text()),
      fetch(s.base + "timing.json").then((r) => r.json()),
    ]);
    timing = parseTiming(timingJson);
    mixer = await MidiPlayer.create(s.base + "score.mid", s.parts.map((p) => p.name),
      (note) => { loadingNote.value = note; });
    mixer.setMaster(myPart.value);
    mixer.onEnded = () => { playing.value = false; };
    setMode(carried.mode ?? "focus", false);
    if (carried.others !== undefined && carried.mode !== "minus" && carried.mode !== "solo") setOthers(carried.others, false);
    if (memory.rate) setRate(memory.rate, false);
    barCount.value = timing.measures;
    levels.value = mixer.effectiveLevels();
    loading.value = false;
    // The score box exists only once loading is false.
    await new Promise(requestAnimationFrame);
    // OpenSheetMusicDisplay is most of the app's size: load it only on a song page.
    const { Score } = await import("../player/score");
    score = new Score(scoreBox.value!);
    score.zoom = zoom.value;
    score.singleLine = singleLine.value;
    if (!singleLine.value) score.zoom = OWN_ZOOM * zoom.value;
    if (controlsBox.value) controlsObserver.observe(controlsBox.value);
    await score.load(xml, visibleParts());
    await new Promise(requestAnimationFrame);
    fit();
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(tick);
  } catch (error) {
    failure.value = String(error);
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  controlsObserver.disconnect();
  window.removeEventListener("resize", onResize);
  mixer?.destroy();
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

function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { score?.render(); fit(); }, 250);
}

function tick() {
  frame = requestAnimationFrame(tick);
  if (!mixer || !timing || !score) return;
  const t = drag?.moved ? drag.t : smoothClock.read(mixer.time(), mixer.running, rate.value, performance.now());
  const target = mixer.running ? loopTarget(loopWindow, t) : null;
  if (target !== null) mixer.seek(target);
  now.value = t;
  playing.value = mixer.playing;
  if (mixer.running && frame % 15 === 0) sounding.value = mixer.sounding();
  const position = positionAt(timing, t);
  bar.value = position.measure + 1;
  const started = t > 0 || mixer.playing;
  const lit = score.light(started ? position.measure : null, position.beat, myPart.value);
  const spot = score.marker(position.measure, position.beat);
  const el = cursor.value;
  if (!spot || !el) return;
  el.style.transform = `translate(${spot.x0}px, ${spot.top}px)`;
  el.style.width = `${spot.x1 - spot.x0}px`;
  el.style.height = `${spot.bottom - spot.top}px`;
  el.dataset.measure = String(position.measure);
  el.dataset.lit = String(lit);
  if (singleLine.value) scrollTo(t);
  if (spot.top !== lastTop) {
    lastTop = spot.top;
    if (!singleLine.value) keepInView(spot.top, spot.bottom);
  }
}

/** Scroll so the line being played sits in the upper part of the screen. */
function keepInView(top: number, bottom: number) {
  const box = scoreBox.value;
  if (!box) return;
  const pageTop = box.getBoundingClientRect().top + window.scrollY;
  const lineTop = pageTop + top;
  const lineBottom = pageTop + bottom;
  // The controls cover the bottom of the screen; the score shows above them.
  const visible = window.innerHeight - bottomSpace.value;
  const viewTop = window.scrollY + 16;
  const viewBottom = window.scrollY + visible - 16;
  if (lineTop < viewTop || lineBottom > viewBottom) {
    window.scrollTo({ top: Math.max(0, lineTop - visible * 0.2), behavior: "smooth" });
  }
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

/** Back to the start of this bar, or of the previous one if this bar just began. */
function back() {
  if (!mixer || !timing) return;
  mixer.seek(previousBarStart(timing, mixer.time()));
  setLoopWindow();
}

/** Jumps to a bar by its number, the way the conductor names it. */
function goToBar() {
  const n = Math.round(Number(goToValue.value));
  if (n >= 1 && n <= barCount.value) jumpTo(n - 1);
  goToOpen.value = false;
}

function useOfferedLoop() {
  if (!offeredLoop.value) return;
  loopBars.value = offeredLoop.value;
  loopMode.value = "on";
  offeredLoop.value = null;
  jumpTo(loopBars.value[0]);
}

/** Fix the loop's times from where playback is now: the play-through of the start bar nearest it. */
function setLoopWindow() {
  loopWindow = loopMode.value === "on" && loopBars.value && timing && mixer
    ? loopRange(timing, loopBars.value[0], loopBars.value[1], mixer.time())
    : null;
}

/** Which parts' staves to draw: yours always, the others unless hidden. */
function visibleParts(): boolean[] {
  return song.value!.parts.map((p, i) => i === myPart.value || !hidden.value.includes(p.name));
}

/** Slides the one line so the music sits at the playhead, along the smoothed curve. */
function scrollTo(t: number) {
  const box = scrollBox.value;
  const wrap = box?.firstElementChild as HTMLElement | null;
  if (!box || !wrap || !score || !timing) return;
  if (!curve || curveVersion !== score.version) {
    const s = score;
    const tm = timing;
    curve = buildCurve(duration.value, (sec) => {
      const p = positionAt(tm, sec);
      return s.xAt(p.measure, p.beat) ?? 0;
    }, box.clientWidth * JUMP_FRACTION);
    curveVersion = score.version;
  }
  const offset = Math.max(0, curveAt(curve, t) - box.clientWidth * PLAYHEAD);
  wrap.style.transform = `translate3d(${-offset}px, ${-verticalOffset(box.clientHeight)}px, 0)`;
}

/**
 * The one-line view does not scroll up and down. When every staff fits, it shows
 * them all; when not, it centres your part's staff, keeping the view on the score.
 */
function verticalOffset(boxHeight: number): number {
  if (!score) return 0;
  const room = score.height - boxHeight;
  // Everything fits: centre the line in the space.
  if (room <= 0) return room / 2;
  const span = score.partSpan(myPart.value);
  if (!span) return 0;
  const centre = (span.top + span.bottom) / 2;
  return Math.min(room, Math.max(0, centre - boxHeight / 2));
}

/**
 * In the one-line view, dragging the score sideways moves through the song like
 * the position slider: left is forward. A tap without moving is still a tap on a bar.
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
    // The sound waits while the score is dragged and starts again, all parts
    // together, where it is let go: seeking it along the way pulls parts apart.
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
    setLoopWindow();
    // Swallow the click that may end a drag, but only that one: browsers do not
    // always send it, and a stale flag would eat the next real tap.
    dragJustEnded = true;
    window.setTimeout(() => { dragJustEnded = false; }, 0);
  }
  drag = null;
}

function toggleSingleLine() {
  singleLine.value = !singleLine.value;
  remembered.setSingleLine(singleLine.value);
  score?.setSingleLine(singleLine.value);
  const wrap = scrollBox.value?.firstElementChild as HTMLElement | null;
  if (wrap) wrap.style.transform = "";
  lastTop = -1;
}

/**
 * Sizes the score so the visible staves fill the height between the title and
 * the controls; the singer's − / + choice is kept as a factor on top of that.
 */
function fit() {
  if (!singleLine.value) {
    fitZoom = OWN_ZOOM;
    score?.setZoom(fitZoom * zoom.value);
    lastTop = -1;
    return;
  }
  const box = scrollBox.value;
  if (!score || !box || !score.height) return;
  const natural = score.height / score.zoom;
  const byHeight = (box.clientHeight * 0.92) / natural;
  // But never so big that fewer than about three bars fit across: singers read ahead.
  const barWidth = score.width / Math.max(1, score.barCount) / score.zoom;
  const byWidth = box.clientWidth / (3 * barWidth);
  fitZoom = Math.min(3, Math.max(0.3, Math.min(byHeight, byWidth)));
  score.setZoom(fitZoom * zoom.value);
  lastTop = -1;
}

function changeZoom(step: number) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6);
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]!;
  if (next === zoom.value) return;
  zoom.value = next;
  remembered.setZoom(next);
  score?.setZoom(fitZoom * next);
  lastTop = -1;
}

function redrawStaves() {
  if (!score) return;
  score.setVisible(visibleParts());
  fit();
}

function setStaffMode(next: StaffMode) {
  if (!song.value || !score || next === staffMode.value) return;
  staffMode.value = next;
  carrySettings({ staves: next });
  hidden.value = next === "own" ? song.value.parts.filter((_, i) => i !== myPart.value).map((p) => p.name) : [];
  singleLine.value = next === "all";
  const wrap = scrollBox.value?.firstElementChild as HTMLElement | null;
  if (wrap) wrap.style.transform = "";
  window.scrollTo(0, 0);
  score.singleLine = singleLine.value;
  score.zoom = (next === "own" ? OWN_ZOOM : fitZoom) * zoom.value;
  score.setVisible(visibleParts());
  void new Promise(requestAnimationFrame).then(fit);
}

function toggleStaff(name: string) {
  hidden.value = hidden.value.includes(name) ? hidden.value.filter((n) => n !== name) : [...hidden.value, name];
  rememberSong(props.choir, props.slug, { hidden: hidden.value });
  redrawStaves();
}

function choosePart(index: number) {
  if (song.value && staffMode.value === "own") {
    hidden.value = song.value.parts.filter((_, i) => i !== index).map((p) => p.name);
  }
  const wasHidden = hidden.value.includes(song.value!.parts[index]!.name);
  const previousHidden = hidden.value.includes(song.value!.parts[myPart.value]!.name);
  myPart.value = index;
  if (wasHidden || previousHidden) redrawStaves();
  remembered.setPart(props.choir, song.value!.parts[index]!.name);
  rememberSong(props.choir, props.slug, { part: song.value!.parts[index]!.name });
  mixer?.setMaster(index);
  if (mixer) levels.value = mixer.effectiveLevels();
}

function setOthers(value: number, save = true) {
  others.value = value;
  solo.value = value === 0;
  mixer?.setOthers(value);
  if (mixer) levels.value = mixer.effectiveLevels();
  if (save) carrySettings({ others: value });
}

/** One tap for each way of practising; the slider below still fine-tunes the others. */
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

let beforeSolo = DEFAULT_OTHERS;
function toggleSolo() {
  setMode(mode.value === "solo" ? "focus" : "solo");
}

function setRate(value: number, save = true) {
  rate.value = value;
  if (save) rememberSong(props.choir, props.slug, { rate: value });
  mixer?.setRate(value);
}

function toggleLoop() {
  if (loopMode.value === "off") loopMode.value = "pick-start";
  else {
    if (loopMode.value === "on") rememberSong(props.choir, props.slug, { loop: null });
    loopMode.value = "off";
    loopBars.value = null;
  }
  offeredLoop.value = null;
  setLoopWindow();
}

/** A tap on the score plays or pauses (Eero); while picking loop bars it picks a bar. */
function onScoreClick(event: MouseEvent) {
  if (dragJustEnded) { dragJustEnded = false; return; }
  if (showHint.value) dismissHint();
  // With the settings open, a tap on the score just closes them.
  if (sheetOpen.value) { sheetOpen.value = false; return; }
  if (!score || !timing || !mixer || !scoreBox.value) return;
  if (loopMode.value !== "pick-start" && loopMode.value !== "pick-end") {
    void togglePlay();
    return;
  }
  const box = scoreBox.value.getBoundingClientRect();
  const bar = score.barAt(event.clientX - box.left, event.clientY - box.top);
  if (bar === null) return;
  if (loopMode.value === "pick-start") {
    loopBars.value = [bar, bar];
    loopMode.value = "pick-end";
    jumpTo(bar);
  } else if (loopMode.value === "pick-end" && loopBars.value) {
    const start = loopBars.value[0];
    loopBars.value = bar >= start ? [start, bar] : [bar, start];
    loopMode.value = "on";
    rememberSong(props.choir, props.slug, { loop: loopBars.value });
    jumpTo(loopBars.value[0]);
  }
}

/** Jump to a bar's play-through nearest where we are now (a repeat has several). */
function jumpTo(bar: number) {
  if (!timing || !mixer) return;
  const t = nearest(startsOf(timing, bar), mixer.time());
  if (t !== null) mixer.seek(t);
  setLoopWindow();
}

function seekTo(event: Event) {
  mixer?.seek(Number((event.target as HTMLInputElement).value));
  setLoopWindow();
}

const loopHint = computed(() => ({
  "pick-start": "1/2 · Napauta tahtia, josta silmukka alkaa",
  "pick-end": "2/2 · Napauta tahtia, johon silmukka loppuu",
  on: loopBars.value ? `Silmukka tahdit ${loopBars.value[0] + 1}–${loopBars.value[1] + 1}` : "",
  off: "",
})[loopMode.value]);
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else class="player" :class="[`ui-${ui}`, { 'one-line': singleLine, wide }]"
    :style="{ paddingBottom: `${bottomSpace + (singleLine ? 0 : 16)}px` }">
    <header v-if="!wide && ui !== 'a'" class="appbar">
      <a :href="`/c/${encodeURIComponent(props.choir)}`" class="appbar-back" aria-label="Kappaleet">
        <Icon name="chevronLeft" :size="20" /><span>Laulut</span>
      </a>
      <h1>{{ song?.title }}</h1>
    </header>

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
      <p v-if="showHint && !askPart" class="loop-pill hint-pill" :style="{ bottom: `${bottomSpace + 10}px` }">
        Napauta nuottia: soita / tauko · Vedä nuottia sivulle: siirry eteen tai taakse
        <button type="button" class="pill-btn" @click="dismissHint">Selvä</button>
      </p>
      <div v-if="askPart" class="ask-part" role="dialog" aria-label="Valitse oma stemma"
        @click.self="if (!firstAsk) askPart = false;">
        <div class="ask-card">
          <h2>Mikä on sinun stemmasi?</h2>
          <p class="hint">Se soi kovimmin ja sen nuotit näkyvät tummalla sinisellä. Voit vaihtaa sitä myöhemmin.</p>
          <div class="ask-grid">
            <button v-for="(p, i) in song.parts" :key="p.file" type="button" class="chip big part"
              :class="{ mine: i === myPart && !firstAsk }" :data-gain="(levels[i] ?? 0).toFixed(3)"
              @click="pickFirstPart(i)">{{ p.name }}</button>
          </div>
        </div>
      </div>

      <!-- A tap anywhere outside an open panel closes it. -->
      <div v-if="ui === 'a' && (sheetOpen || goToOpen)" class="backdrop"
        @click="sheetOpen = false; goToOpen = false"></div>
      <!-- ===== A: one quiet bar; everything else in a sheet ===== -->
      <section v-if="ui === 'a'" ref="controlsBox" class="dock">
        <div v-if="sheetOpen" class="dock-sheet">
          <div class="handle" aria-hidden="true"></div>
          <div class="srow stacked">
            <span class="slabel">Kuuntelu</span>
            <div class="pills four" role="group" aria-label="Miten kuuntelet">
              <button v-for="m in MODES" :key="m.id" type="button" :class="{ on: mode === m.id }"
                :aria-pressed="mode === m.id" @click="setMode(m.id)">{{ m.short }}</button>
            </div>
            <span class="snote">{{ MODES.find((m) => m.id === mode)?.hint }}</span>
          </div>
          <div v-if="mode !== 'solo'" class="srow">
            <span class="slabel">Muut stemmat</span>
            <input class="range" type="range" min="0" max="1" step="0.01" :value="others"
              :style="{ '--fill': `${others * 100}%` }" aria-label="Muiden stemmojen voimakkuus"
              @input="onOthersSlider(Number(($event.target as HTMLInputElement).value))" />
          </div>
          <div class="srow">
            <span class="slabel">Tempo</span>
            <div class="pills stepper2" role="group" aria-label="Tempo">
              <button type="button" aria-label="Hitaammin" :disabled="rate <= 0.5" @click="stepTempo(-0.05)">−</button>
              <button type="button" class="val" aria-label="Normaali tempo" @click="setRate(1)">{{ Math.round(rate * 100) }} %</button>
              <button type="button" aria-label="Nopeammin" :disabled="rate >= 1.5" @click="stepTempo(0.05)">+</button>
            </div>
          </div>
          <div class="srow">
            <span class="slabel">Nuotin koko</span>
            <div class="pills stepper2" role="group" aria-label="Nuotin koko">
              <button type="button" aria-label="Pienennä nuottia" :disabled="zoom <= ZOOMS[0]!" @click="changeZoom(-1)">−</button>
              <span class="val">{{ Math.round(zoom * 100) }} %</span>
              <button type="button" aria-label="Suurenna nuottia" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!"
                @click="changeZoom(1)">+</button>
            </div>
          </div>
          <div class="srow">
            <span class="slabel">Viivastot</span>
            <div class="pills" role="group" aria-label="Viivastot">
              <button type="button" :class="{ on: staffMode === 'all' }" :aria-pressed="staffMode === 'all'"
                @click="setStaffMode('all')">Kaikki</button>
              <button type="button" :class="{ on: staffMode === 'own' }" :aria-pressed="staffMode === 'own'"
                @click="setStaffMode('own')">Oma</button>
            </div>
          </div>
        </div>
        <form v-if="goToOpen" class="dock-goto" @submit.prevent="goToBar">
          <span class="slabel">Siirry tahtiin</span>
          <input v-model="goToValue" type="number" inputmode="numeric" min="1" :max="barCount" aria-label="Tahdin numero" />
          <button type="submit" class="go">Mene</button>
        </form>
        <input class="progress" type="range" min="0" :max="duration" step="0.1" :value="now"
          :style="{ '--fill': `${duration ? (now / duration) * 100 : 0}%` }" aria-label="Kohta kappaleessa" @input="seekTo" />
        <div class="dock-bar">
          <a :href="`/c/${encodeURIComponent(props.choir)}`" class="ghost" aria-label="Takaisin lauluihin">
            <Icon name="chevronLeft" :size="24" /></a>
          <button type="button" class="info" :aria-expanded="goToOpen" aria-label="Siirry tahtiin"
            @click="goToOpen = !goToOpen; goToValue = String(bar)">
            <span class="info-title">{{ song.title }}</span>
            <span class="info-meta">Tahti {{ bar }} / {{ barCount }} · <span data-testid="time">{{ clock(now) }}</span></span>
          </button>
          <button type="button" class="part-pill" aria-label="Vaihda oma stemma" @click="askPart = true">
            <Icon name="solo" :size="15" />{{ song.parts[myPart]?.name }}</button>
          <button type="button" class="play-btn" :aria-label="playing ? 'Tauko' : 'Soita'"
            :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
          <button type="button" class="ghost" :class="{ on: sheetOpen }" :aria-expanded="sheetOpen" aria-label="Säädöt"
            @click="sheetOpen = !sheetOpen"><Icon :name="sheetOpen ? 'close' : 'more'" :size="22" /></button>
        </div>
      </section>
      <!-- ===== B: compact rows, icons only, small pop-ups for the sliders ===== -->
      <section v-if="ui === 'b'" ref="controlsBox" class="controls ctl-b">
        <div v-if="popover" class="popover">
          <template v-if="popover === 'others'">
            <span class="field-label">Muut stemmat</span>
            <input type="range" min="0" max="1" step="0.01" :value="others" aria-label="Muiden stemmojen voimakkuus"
              @input="setOthers(Number(($event.target as HTMLInputElement).value))" />
          </template>
          <template v-else-if="popover === 'tempo'">
            <span class="field-label">Tempo <b>{{ Math.round(rate * 100) }} %</b></span>
            <input type="range" min="0.5" max="1.5" step="0.05" :value="rate" aria-label="Tempo"
              @input="setRate(Number(($event.target as HTMLInputElement).value))" />
          </template>
          <div v-else class="staves" role="group" aria-label="Näytettävät viivastot">
            <label v-for="(p, i) in song.parts" :key="p.file" class="staff-choice">
              <input type="checkbox" :checked="i === myPart || !hidden.includes(p.name)" :disabled="i === myPart"
                @change="toggleStaff(p.name)" /> {{ p.name }}
            </label>
          </div>
        </div>
        <div class="seek-row">
          <input class="seek" type="range" min="0" :max="duration" step="0.1" :value="now"
            aria-label="Kohta kappaleessa" @input="seekTo" />
          <span class="time" data-testid="time">{{ clock(now) }} / {{ clock(duration) }}</span>
        </div>
        <div class="bar-row">
          <button type="button" class="play round" :aria-label="playing ? 'Tauko' : 'Soita'"
            :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
          <button type="button" class="icon-btn" aria-label="5 sekuntia taaksepäin" @click="back"><Icon name="back5" /></button>
          <div class="parts chips" role="group" aria-label="Oma stemma">
            <button v-for="(p, i) in song.parts" :key="p.file" type="button" class="chip part"
              :class="{ mine: i === myPart }" :aria-pressed="i === myPart"
              :data-gain="(levels[i] ?? 0).toFixed(3)" @click="choosePart(i)">{{ p.name }}</button>
          </div>
        </div>
        <div class="tool-row">
          <button type="button" class="icon-btn" :class="{ on: popover === 'others' }" aria-label="Muut stemmat"
            @click="togglePopover('others')"><Icon name="others" /></button>
          <button type="button" class="icon-btn" :class="{ on: solo }" :aria-pressed="solo" aria-label="Vain oma"
            @click="toggleSolo"><Icon name="solo" /></button>
          <button type="button" class="icon-btn" :class="{ on: popover === 'tempo' }" aria-label="Tempoasetus"
            @click="togglePopover('tempo')"><Icon name="tempo" /></button>
          <button type="button" class="icon-btn" :class="{ on: loopMode !== 'off' }" :aria-pressed="loopMode !== 'off'"
            aria-label="Silmukka" @click="toggleLoop"><Icon name="loop" /></button>
          <button type="button" class="icon-btn" :class="{ on: singleLine }" :aria-pressed="singleLine"
            aria-label="Vieritys" @click="toggleSingleLine"><Icon name="scroll" /></button>
          <button type="button" class="icon-btn" :class="{ on: popover === 'staves' }" aria-label="Viivastot"
            @click="togglePopover('staves')"><Icon name="staves" /></button>
          <button type="button" class="icon-btn" aria-label="Pienennä nuottia" :disabled="zoom <= ZOOMS[0]!"
            @click="changeZoom(-1)"><Icon name="zoomOut" /></button>
          <button type="button" class="icon-btn" aria-label="Suurenna nuottia" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!"
            @click="changeZoom(1)"><Icon name="zoomIn" /></button>
        </div>
      </section>

      <!-- ===== C: a side panel on wide screens, a slim bar + full panel on phones ===== -->
      <section v-if="ui === 'c'" ref="controlsBox" class="controls ctl-c" :class="{ side: wide, open: sheetOpen }">
        <div v-if="wide || sheetOpen" class="panel">
          <div v-if="wide" class="panel-head">
            <a :href="`/c/${encodeURIComponent(props.choir)}`" class="back-link"><Icon name="chevronLeft" :size="18" /> Kappaleet</a>
            <h1>{{ song.title }}</h1>
          </div>
          <div v-if="!wide" class="panel-close">
            <button type="button" class="text-btn" @click="sheetOpen = false">Sulje</button>
          </div>
          <h2>Oma stemma</h2>
          <div class="parts grid" role="group" aria-label="Oma stemma">
            <button v-for="(p, i) in song.parts" :key="p.file" type="button" class="chip part"
              :class="{ mine: i === myPart }" :aria-pressed="i === myPart"
              :data-gain="(levels[i] ?? 0).toFixed(3)" @click="choosePart(i)">{{ p.name }}</button>
          </div>
          <template v-if="wide">
            <div class="transport">
              <button type="button" class="play round" :aria-label="playing ? 'Tauko' : 'Soita'"
                :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="26" /></button>
              <button type="button" class="text-btn" aria-label="5 sekuntia taaksepäin" @click="back">−5 s</button>
              <span class="time" data-testid="time">{{ clock(now) }} / {{ clock(duration) }}</span>
            </div>
            <input class="seek" type="range" min="0" :max="duration" step="0.1" :value="now"
              aria-label="Kohta kappaleessa" @input="seekTo" />
          </template>
          <h2>Äänet</h2>
          <label class="field">
            <span class="field-label">Muut stemmat</span>
            <input type="range" min="0" max="1" step="0.01" :value="others" aria-label="Muiden stemmojen voimakkuus"
              @input="setOthers(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label class="field">
            <span class="field-label">Tempo <b>{{ Math.round(rate * 100) }} %</b></span>
            <input type="range" min="0.5" max="1.5" step="0.05" :value="rate" aria-label="Tempo"
              @input="setRate(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <div class="switches">
            <button type="button" class="switch" :aria-pressed="solo" @click="toggleSolo"><span class="knob"></span>Vain oma</button>
            <button type="button" class="switch" :aria-pressed="loopMode !== 'off'" @click="toggleLoop"><span class="knob"></span>Silmukka</button>
            <button type="button" class="switch" :aria-pressed="singleLine" @click="toggleSingleLine"><span class="knob"></span>Vieritys</button>
          </div>
          <h2>Nuotti</h2>
          <div class="zoom-row">
            <span>Koko</span>
            <span class="zoom" role="group" aria-label="Nuotin koko">
              <button type="button" aria-label="Pienennä nuottia" :disabled="zoom <= ZOOMS[0]!" @click="changeZoom(-1)">−</button>
              <button type="button" aria-label="Suurenna nuottia" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!" @click="changeZoom(1)">+</button>
            </span>
          </div>
          <div class="staves" role="group" aria-label="Näytettävät viivastot">
            <label v-for="(p, i) in song.parts" :key="p.file" class="staff-choice">
              <input type="checkbox" :checked="i === myPart || !hidden.includes(p.name)" :disabled="i === myPart"
                @change="toggleStaff(p.name)" /> {{ p.name }}
            </label>
          </div>
        </div>
        <div v-if="!wide" class="slim">
          <input class="seek" type="range" min="0" :max="duration" step="0.1" :value="now"
            aria-label="Kohta kappaleessa" @input="seekTo" />
          <div class="bar-row">
            <button type="button" class="play round" :aria-label="playing ? 'Tauko' : 'Soita'"
              :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
            <button type="button" class="text-btn" aria-label="5 sekuntia taaksepäin" @click="back">−5 s</button>
            <span class="time" data-testid="time">{{ clock(now) }} / {{ clock(duration) }}</span>
            <span class="spacer"></span>
            <span class="mine-label">{{ song.parts[myPart]?.name }}</span>
            <button type="button" class="text-btn strong" :aria-expanded="sheetOpen" @click="sheetOpen = !sheetOpen">Asetukset</button>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
