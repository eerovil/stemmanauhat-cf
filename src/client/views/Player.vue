<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  carriedSettings, carrySettings, getJson, Refused, remembered, rememberSong, songMemory,
  type Me, type MixMode, type Song,
} from "../api";
import Icon from "../components/Icon.vue";
import { MidiPlayer } from "../player/midi";
import { DEFAULT_OTHERS } from "../player/mix";
import type { Score } from "../player/score";
import { buildCurve, curveAt, JUMP_FRACTION, SmoothClock, timeAtX, type ScrollCurve } from "../player/scroll";
import { nearest, parseTiming, positionAt, startsOf, type Timing } from "../player/timing";
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
/** With "Oma" the size is the singer's zoom times this (a single staff can be big). */
const OWN_ZOOM = window.innerWidth < 600 ? 1.5 : 1.2;
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const zoom = ref(remembered.zoom());
/** The zoom at which the score fills its area; the − / + buttons scale from it. */
let fitZoom = 1;

const sheetOpen = ref(false);
const goToOpen = ref(false);
const goToValue = ref("");
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

let mixer: MidiPlayer | null = null;
let score: Score | null = null;
let timing: Timing | null = null;
let frame = 0;
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
  askPart.value = firstAsk.value = part < 0;
  showHint.value = !localStorage.getItem("stemmanauhat:hint-seen");
  // The listening mix and the staves follow the singer from song to song;
  // the part and the tempo belong to the song.
  const carried = carriedSettings();
  staffMode.value = carried.staves === "own" ? "own" : "all";

  try {
    const [xml, timingJson] = await Promise.all([
      fetch(s.base + "score.musicxml").then((r) => r.text()),
      fetch(s.base + "timing.json").then((r) => r.json()),
    ]);
    timing = parseTiming(timingJson);
    barCount.value = timing.measures;
    mixer = await MidiPlayer.create(s.base + "score.mid", s.parts.map((p) => p.name),
      (note) => { loadingNote.value = note; });
    mixer.setMaster(myPart.value);
    mixer.onEnded = () => { playing.value = false; };
    setMode(carried.mode ?? "focus", false);
    if (carried.others !== undefined && carried.mode !== "minus" && carried.mode !== "solo") setOthers(carried.others, false);
    if (memory.rate) setRate(memory.rate, false);
    loading.value = false;
    // The score box exists only once loading is false.
    await new Promise(requestAnimationFrame);
    // OpenSheetMusicDisplay is most of the app's size: load it only on a song page.
    const { Score } = await import("../player/score");
    score = new Score(scoreBox.value!);
    score.singleLine = singleLine.value;
    score.zoom = (singleLine.value ? 1 : OWN_ZOOM) * zoom.value;
    if (dock.value) dockObserver.observe(dock.value);
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
  dockObserver.disconnect();
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
  else if (spot.top !== lastTop) keepInView(spot.top, spot.bottom);
  lastTop = spot.top;
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
    curve = buildCurve(duration.value, (sec) => {
      const p = positionAt(tm, sec);
      return s.xAt(p.measure, p.beat) ?? 0;
    }, box.clientWidth * JUMP_FRACTION);
    curveVersion = score.version;
  }
  const offset = Math.max(0, curveAt(curve, t) - box.clientWidth * PLAYHEAD);
  wrap.style.transform = `translate3d(${-offset}px, ${-verticalOffset(box.clientHeight)}px, 0)`;
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

/**
 * Sizes the score: in the one-line view the staves fill the height, but never
 * so big that fewer than about three bars fit across (singers read ahead).
 * The singer's − / + choice is a factor on top.
 */
function fit() {
  if (!score) return;
  if (!singleLine.value) {
    fitZoom = OWN_ZOOM;
  } else {
    const box = scrollBox.value;
    if (!box || !score.height) return;
    const byHeight = (box.clientHeight * 0.92) / (score.height / score.zoom);
    const barWidth = score.width / Math.max(1, score.barCount) / score.zoom;
    const byWidth = box.clientWidth / (3 * barWidth);
    fitZoom = Math.min(3, Math.max(0.3, Math.min(byHeight, byWidth)));
  }
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

/** Which parts' staves to draw: all, or only yours. */
function visibleParts(): boolean[] {
  return song.value!.parts.map((_, i) => singleLine.value || i === myPart.value);
}

function setStaffMode(next: StaffMode) {
  if (!score || next === staffMode.value) return;
  staffMode.value = next;
  carrySettings({ staves: next });
  const wrap = scrollBox.value?.firstElementChild as HTMLElement | null;
  if (wrap) wrap.style.transform = "";
  window.scrollTo(0, 0);
  score.singleLine = singleLine.value;
  score.zoom = (singleLine.value ? fitZoom : OWN_ZOOM) * zoom.value;
  score.setVisible(visibleParts());
  void new Promise(requestAnimationFrame).then(fit);
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
    fit();
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
  if (save) rememberSong(props.choir, props.slug, { rate: value });
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

/** Jumps to a bar by its number, the way the conductor names it. */
function goToBar() {
  const n = Math.round(Number(goToValue.value));
  if (n >= 1 && n <= barCount.value) jumpTo(n - 1);
  goToOpen.value = false;
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
  goToOpen.value = false;
}

/** A tap on the score plays or pauses; with a panel open it just closes the panel. */
function onScoreClick() {
  if (dragJustEnded) { dragJustEnded = false; return; }
  if (showHint.value) dismissHint();
  if (sheetOpen.value || goToOpen.value) { closePanels(); return; }
  void togglePlay();
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

      <p v-if="showHint && !askPart" class="toast" :style="{ bottom: `${dockHeight + 10}px` }">
        Napauta nuottia: soita / tauko · Vedä nuottia sivulle: siirry eteen tai taakse
        <button type="button" class="toast-btn" @click="dismissHint">Selvä</button>
      </p>

      <div v-if="askPart" class="ask-part" role="dialog" aria-label="Valitse oma stemma"
        @click.self="if (!firstAsk) askPart = false;">
        <div class="ask-card">
          <h2>Mikä on sinun stemmasi?</h2>
          <p class="hint">Se soi kovimmin ja sen nuotit näkyvät tummalla sinisellä. Voit vaihtaa sitä myöhemmin.</p>
          <div class="ask-grid">
            <button v-for="(p, i) in song.parts" :key="p.file" type="button" class="ask-choice"
              :class="{ mine: i === myPart && !firstAsk }" @click="pickPart(i)">{{ p.name }}</button>
          </div>
        </div>
      </div>

      <!-- A tap anywhere outside an open panel closes it. -->
      <div v-if="sheetOpen || goToOpen" class="backdrop" @click="closePanels"></div>

      <!-- One quiet bar; everything else in a sheet. -->
      <section ref="dock" class="dock" :data-gains="levels.map((g) => g.toFixed(3)).join(' ')">
        <div v-if="sheetOpen" class="dock-sheet">
          <div class="handle" aria-hidden="true"></div>
          <div class="srow stacked">
            <span class="slabel">Kuuntelu</span>
            <div class="pills four" role="group" aria-label="Miten kuuntelet">
              <button v-for="m in MODES" :key="m.id" type="button" :class="{ on: mode === m.id }"
                :aria-pressed="mode === m.id" @click="setMode(m.id)">{{ m.label }}</button>
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
            <div class="pills stepper" role="group" aria-label="Tempo">
              <button type="button" aria-label="Hitaammin" :disabled="rate <= 0.5" @click="stepTempo(-0.05)">−</button>
              <button type="button" class="val" aria-label="Normaali tempo" @click="setRate(1)">{{ Math.round(rate * 100) }} %</button>
              <button type="button" aria-label="Nopeammin" :disabled="rate >= 1.5" @click="stepTempo(0.05)">+</button>
            </div>
          </div>
          <div class="srow">
            <span class="slabel">Nuotin koko</span>
            <div class="pills stepper" role="group" aria-label="Nuotin koko">
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
          :style="{ '--fill': `${duration ? (now / duration) * 100 : 0}%` }" aria-label="Kohta kappaleessa"
          @input="seekTo" />
        <div class="dock-bar">
          <a :href="`/c/${encodeURIComponent(props.choir)}`" class="ghost" aria-label="Takaisin lauluihin">
            <Icon name="chevronLeft" :size="24" /></a>
          <button type="button" class="info" :aria-expanded="goToOpen" aria-label="Siirry tahtiin"
            @click="goToOpen = !goToOpen; sheetOpen = false; goToValue = String(bar)">
            <span class="info-title">{{ song.title }}</span>
            <span class="info-meta">Tahti {{ bar }} / {{ barCount }} · <span data-testid="time">{{ clock(now) }}</span></span>
          </button>
          <button type="button" class="part-pill" aria-label="Vaihda oma stemma" @click="askPart = true">
            <Icon name="solo" :size="15" />{{ song.parts[myPart]?.name }}</button>
          <button type="button" class="play-btn" :aria-label="playing ? 'Tauko' : 'Soita'"
            :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
          <button type="button" class="ghost" :class="{ on: sheetOpen }" :aria-expanded="sheetOpen" aria-label="Säädöt"
            @click="sheetOpen = !sheetOpen; goToOpen = false"><Icon :name="sheetOpen ? 'close' : 'more'" :size="22" /></button>
        </div>
      </section>
    </template>
  </main>
</template>
