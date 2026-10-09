<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, Refused, remembered, type Me, type Song } from "../api";
import { DEFAULT_OTHERS, Mixer } from "../player/mixer";
import type { Score } from "../player/score";
import { buildCurve, curveAt, JUMP_FRACTION, SmoothClock, timeAtX, type ScrollCurve } from "../player/scroll";
import { loopRange, loopTarget, nearest, parseTiming, positionAt, startsOf, type Timing } from "../player/timing";
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
// Other parts' staves the singer has hidden, by part name (remembered per choir).
const hidden = ref<string[]>([]);
const stavesOpen = ref(false);
const zoom = ref(remembered.zoom());
const singleLine = ref(remembered.singleLine());
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
const controlsObserver = new ResizeObserver(([entry]) => {
  controlsHeight.value = entry ? (entry.target as HTMLElement).offsetHeight : 0;
});
const cursor = ref<HTMLElement | null>(null);

let mixer: Mixer | null = null;
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
  const savedPart = remembered.part(props.choir);
  myPart.value = Math.max(0, s.parts.findIndex((p) => p.name === savedPart));
  hidden.value = remembered.hidden(props.choir);

  try {
    const [xml, timingJson] = await Promise.all([
      fetch(s.base + "score.musicxml").then((r) => r.text()),
      fetch(s.base + "timing.json").then((r) => r.json()),
    ]);
    timing = parseTiming(timingJson);
    mixer = new Mixer(s.parts.map((p) => s.base + p.file));
    // On the page (hidden) rather than detached, so the browser and tests can see them.
    mixer.elements.forEach((el, i) => { el.dataset.part = s.parts[i]!.name; document.body.appendChild(el); });
    mixer.setMaster(myPart.value);
    mixer.setOthers(others.value);
    mixer.elements[myPart.value]!.addEventListener("ended", () => { playing.value = false; });
    levels.value = mixer.effectiveLevels();
    loading.value = false;
    // The score box exists only once loading is false.
    await new Promise(requestAnimationFrame);
    // OpenSheetMusicDisplay is most of the app's size: load it only on a song page.
    const { Score } = await import("../player/score");
    score = new Score(scoreBox.value!);
    score.zoom = zoom.value;
    score.singleLine = singleLine.value;
    if (controlsBox.value) controlsObserver.observe(controlsBox.value);
    await score.load(xml, visibleParts());
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
  mixer?.elements.forEach((el) => el.remove());
  mixer?.destroy();
});

function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { score?.render(); lastTop = -1; }, 250);
}

function tick() {
  frame = requestAnimationFrame(tick);
  if (!mixer || !timing || !score) return;
  const t = drag?.moved ? drag.t : smoothClock.read(mixer.time(), mixer.playing, rate.value, performance.now());
  const target = mixer.playing ? loopTarget(loopWindow, t) : null;
  if (target !== null) mixer.seek(target);
  now.value = t;
  playing.value = mixer.playing;
  const position = positionAt(timing, t);
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
  const visible = window.innerHeight - controlsHeight.value;
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

function back() {
  mixer?.seek(mixer.time() - 5);
  setLoopWindow();
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
  if (room <= 0) return 0;
  const span = score.partSpan(myPart.value);
  if (!span) return 0;
  const centre = (span.top + span.bottom) / 2;
  return Math.min(room, Math.max(0, centre - boxHeight / 2));
}

/**
 * In the one-line view, dragging the score sideways moves through the song like
 * the position slider: left is forward. A tap without moving is still a tap on a bar.
 */
interface Drag { pointer: number; startX: number; startT: number; t: number; moved: boolean; lastSeek: number }
let drag: Drag | null = null;
let dragJustEnded = false;
const DRAG_THRESHOLD = 8;

function onPointerDown(event: PointerEvent) {
  if (!singleLine.value || !mixer || !curve) return;
  const t = mixer.time();
  drag = { pointer: event.pointerId, startX: event.clientX, startT: t, t, moved: false, lastSeek: 0 };
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer || !curve || !mixer) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  drag.t = Math.min(duration.value, timeAtX(curve, curveAt(curve, drag.startT) - dx, drag.startT));
  // Seek the sound along, but not on every pointer event.
  if (event.timeStamp - drag.lastSeek > 80) {
    drag.lastSeek = event.timeStamp;
    mixer.seek(drag.t);
  }
}

function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  if (drag.moved && mixer) {
    mixer.seek(drag.t);
    setLoopWindow();
    dragJustEnded = true;
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

function changeZoom(step: number) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6);
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]!;
  if (next === zoom.value) return;
  zoom.value = next;
  remembered.setZoom(next);
  score?.setZoom(next);
  lastTop = -1;
}

function redrawStaves() {
  if (!score) return;
  score.setVisible(visibleParts());
  lastTop = -1;
}

function toggleStaff(name: string) {
  hidden.value = hidden.value.includes(name) ? hidden.value.filter((n) => n !== name) : [...hidden.value, name];
  remembered.setHidden(props.choir, hidden.value);
  redrawStaves();
}

function choosePart(index: number) {
  const wasHidden = hidden.value.includes(song.value!.parts[index]!.name);
  const previousHidden = hidden.value.includes(song.value!.parts[myPart.value]!.name);
  myPart.value = index;
  if (wasHidden || previousHidden) redrawStaves();
  remembered.setPart(props.choir, song.value!.parts[index]!.name);
  mixer?.setMaster(index);
  if (mixer) levels.value = mixer.effectiveLevels();
}

function setOthers(value: number) {
  others.value = value;
  solo.value = value === 0;
  mixer?.setOthers(value);
  if (mixer) levels.value = mixer.effectiveLevels();
}

let beforeSolo = DEFAULT_OTHERS;
function toggleSolo() {
  if (solo.value) setOthers(beforeSolo || DEFAULT_OTHERS);
  else { beforeSolo = others.value; setOthers(0); }
}

function setRate(value: number) {
  rate.value = value;
  mixer?.setRate(value);
}

function toggleLoop() {
  if (loopMode.value === "off") loopMode.value = "pick-start";
  else { loopMode.value = "off"; loopBars.value = null; }
  setLoopWindow();
}

function onScoreClick(event: MouseEvent) {
  if (dragJustEnded) { dragJustEnded = false; return; }
  if (!score || !timing || !mixer || !scoreBox.value) return;
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
    jumpTo(loopBars.value[0]);
  } else {
    jumpTo(bar);
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
  "pick-start": "Napauta silmukan ensimmäistä tahtia",
  "pick-end": "Napauta silmukan viimeistä tahtia",
  on: loopBars.value ? `Silmukka: tahdit ${loopBars.value[0] + 1}–${loopBars.value[1] + 1}` : "",
  off: "",
})[loopMode.value]);
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else class="player" :class="{ 'one-line': singleLine }"
    :style="{ paddingBottom: `${controlsHeight + (singleLine ? 0 : 16)}px`, '--controls-height': `${controlsHeight}px` }">
    <header class="bar">
      <a :href="`/c/${encodeURIComponent(props.choir)}`" class="back-link">‹ Kappaleet</a>
      <h1>{{ song?.title }}</h1>
    </header>

    <p v-if="loading" class="hint page">Ladataan…</p>
    <p v-else-if="failure" class="error page">Kappaleen lataus epäonnistui: {{ failure }}</p>

    <template v-else-if="song">
      <div ref="scrollBox" class="score-scroll" :class="{ 'single-line': singleLine }" data-testid="score-scroll"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
        @pointercancel="onPointerUp">
        <div class="score-wrap">
          <div ref="scoreBox" class="score" data-testid="score" @click="onScoreClick"></div>
          <div ref="cursor" class="cursor" data-testid="cursor" aria-hidden="true"></div>
        </div>
      </div>

      <!-- At the bottom of the screen, so the score has the space above it. -->
      <section ref="controlsBox" class="controls">
        <p v-if="loopHint" class="hint loop-hint">{{ loopHint }}</p>
        <input class="seek" type="range" min="0" :max="duration" step="0.1" :value="now"
          aria-label="Kohta kappaleessa" @input="seekTo" />
        <div class="parts" role="group" aria-label="Oma stemma">
          <button v-for="(p, i) in song.parts" :key="p.file" type="button" class="part"
            :class="{ mine: i === myPart }" :aria-pressed="i === myPart"
            :data-gain="(levels[i] ?? 0).toFixed(3)" @click="choosePart(i)">{{ p.name }}</button>
        </div>
        <div class="row transport">
          <button type="button" class="play primary" :aria-label="playing ? 'Tauko' : 'Soita'" @click="togglePlay">
            {{ playing ? "❚❚" : "▶" }}
          </button>
          <button type="button" aria-label="5 sekuntia taaksepäin" @click="back">−5 s</button>
          <span class="time" data-testid="time">{{ clock(now) }} / {{ clock(duration) }}</span>
          <span class="spacer"></span>
          <span class="zoom" role="group" aria-label="Nuotin koko">
            <button type="button" aria-label="Pienennä nuottia" :disabled="zoom <= ZOOMS[0]!"
              @click="changeZoom(-1)">−</button>
            <button type="button" aria-label="Suurenna nuottia" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!"
              @click="changeZoom(1)">+</button>
          </span>
          <button type="button" :class="{ on: singleLine }" :aria-pressed="singleLine"
            @click="toggleSingleLine">Vieritys</button>
          <button type="button" :class="{ on: stavesOpen }" :aria-expanded="stavesOpen"
            @click="stavesOpen = !stavesOpen">Viivastot</button>
        </div>
        <div v-if="stavesOpen" class="staves" role="group" aria-label="Näytettävät viivastot">
          <label v-for="(p, i) in song.parts" :key="p.file" class="staff-choice">
            <input type="checkbox" :checked="i === myPart || !hidden.includes(p.name)" :disabled="i === myPart"
              @change="toggleStaff(p.name)" />
            {{ p.name }}
          </label>
        </div>
        <div class="sliders">
          <div class="slider">
            <span>Muut stemmat</span>
            <input type="range" min="0" max="1" step="0.01" :value="others" aria-label="Muiden stemmojen voimakkuus"
              @input="setOthers(Number(($event.target as HTMLInputElement).value))" />
            <button type="button" :class="{ on: solo }" :aria-pressed="solo" @click="toggleSolo">Vain oma</button>
          </div>
          <div class="slider">
            <span>Tempo {{ Math.round(rate * 100) }} %</span>
            <input type="range" min="0.5" max="1.5" step="0.05" :value="rate" aria-label="Tempo"
              @input="setRate(Number(($event.target as HTMLInputElement).value))" />
            <button type="button" :class="{ on: loopMode !== 'off' }" :aria-pressed="loopMode !== 'off'"
              @click="toggleLoop">Silmukka</button>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
