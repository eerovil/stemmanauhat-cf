<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  carriedSettings, hasSungParts, sungCredit, carrySettings, credits, getJson, postJson, problemLabels, Refused, remembered,
  rememberSong, songMemory, validRate, type FlagProblem, type Me, type MixMode, type Song,
} from "../api";
import Icon from "../components/Icon.vue";
import { lang, t, words } from "../i18n";
import { FilePlayer, wantsFilePlayback } from "../player/file-player";
import { MidiPlayer } from "../player/midi";
import { DEFAULT_PIVOT, OCTAVE_DB, type Pivot } from "../player/balance";
import type { SungPlayer } from "../player/sung";
import { focusOf, keepChoirPart, partLabel, staffOf, startingPart, visibleStaves } from "../player/part";
import { SlidingPieces } from "../player/slide";
import { DEFAULT_OTHERS, gainOf } from "../player/mix";
import type { Score } from "../player/score";
import { buildCurve, curveAt, JUMP_FRACTION, SmoothClock, timeAtX, type ScrollCurve } from "../player/scroll";
import { barLengths, nearest, parseTiming, positionAt, startsOf, timeOf, type Timing } from "../player/timing";
import { ListenTimer, SettleTimer, settingValue, track, type SettingName, type Settings } from "../track";
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
/** The four ways, with their words in the language shown now (src/client/i18n.ts). */
const MODES = computed((): { id: MixMode; label: string; hint: string }[] =>
  (["focus", "equal", "minus", "solo"] as const).map((id) => ({ id, ...t.value.modes[id] })));

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
/** As tall as the window with the phone's address bar shown (`100svh`). */
const smallViewport = ref<HTMLElement | null>(null);
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

let mixer: MidiPlayer | FilePlayer | SungPlayer | null = null;
/** Which player has the song (shown to tests on the dock). */
const playerKind = ref<"midi" | "file" | "sung" | "">("");
/** The singer's choice when the song has sung parts: piano (the default) or the sung parts. */
const sound = ref<"piano" | "sung">("piano");
/**
 * Säädöt › Lisäasetukset (eerovil/stemmanauhat-cf#117), for the sung parts only: how many dB
 * an octave lower sings louder and the middle that stays as recorded (carried from song to
 * song), and each sung part's own volume (this song's).
 */
const lowLouder = ref(OCTAVE_DB);
const middle = ref<Pivot>(DEFAULT_PIVOT);
const volumes = ref<number[]>([]);
const MIDDLES = ["moment", "song", 60] as const;
/**
 * Whether every part has a sung MP3 (marked `sung`: rows from before #36 list piano
 * MP3s under the same names) and this browser can play them together.
 */
const hasSung = computed(() => {
  const parts = song.value?.parts ?? [];
  return !wantsFilePlayback() && hasSungParts(parts);
});
/** What the Ääni choice shows: what plays, not what was asked for (a sung load can fall back to the piano). */
const shownSound = computed(() => (switching.value ? sound.value : playerKind.value === "sung" ? "sung" : "piano"));
/** True while the player is being swapped for the other sound. */
const switching = ref(false);
/** Firefox on Android slides the one-line view as moving picture pieces (player/slide.ts). */
let pieces: SlidingPieces | null = null;
let score: Score | null = null;
let timing: Timing | null = null;
let frame = 0;
let lastTop = -1;
let lastBottom = 0;
let resizeTimer: number | undefined;
/** The window's height now, and before the resizes waiting in `resizeTimer` (0 if none wait). */
let windowHeight = 0;
let heightBefore = 0;
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
  document.title = `${s.title} – ${words().siteName}`;
  remembered.setLast(props.choir, props.slug);

  // The part: this song's, else the one usually sung in this choir or the nearest above it in the
  // voice tree (S1b falling back to S1, Basso 2 to Basso), else ask. A fallback is not remembered,
  // so the next song with S1b starts on S1b again.
  const memory = songMemory(props.choir, props.slug);
  const part = startingPart(s.parts.map((p) => p.name), memory.part, remembered.part(props.choir), s.voices);
  myPart.value = Math.max(0, part);
  askPart.value = firstAsk.value = part < 0;
  showHint.value = !localStorage.getItem("stemmanauhat:hint-seen");
  // The settings follow the singer from song to song; the part belongs to the song.
  const carried = carriedSettings();
  if (carried.sound === "sung") endSungDot();
  else sungDotWanted.value = !localStorage.getItem(SUNG_TRIED_KEY);
  staffMode.value = carried.staves === "own" ? "own" : "all";
  sound.value = carried.sound === "sung" ? "sung" : "piano";
  if (typeof carried.lowLouder === "number" && carried.lowLouder >= 0 && carried.lowLouder <= 12) lowLouder.value = carried.lowLouder;
  if (MIDDLES.includes(carried.middle as never)) middle.value = carried.middle!;
  volumes.value = s.parts.map((p) => {
    const v = memory.volumes?.[p.name];
    return typeof v === "number" && v >= 0 && v <= 2 ? v : 1;
  });

  try {
    const [xml, timingJson] = await Promise.all([
      fetch(s.base + "score.musicxml").then((r) => r.text()),
      fetch(s.base + "timing.json").then((r) => r.json()),
    ]);
    timing = parseTiming(timingJson);
    barCount.value = timing.measures;
    // The page always opens on the piano; chosen singing loads behind it (loadSung).
    mixer = await createPiano(s);
    mixer.setMaster(myPart.value);
    mixer.onEnded = () => { playing.value = false; };
    setMode(carried.mode ?? "focus", false);
    if (carried.others !== undefined && carried.mode !== "minus" && carried.mode !== "solo") setOthers(carried.others, false);
    // Before tempo carried, each song kept its own: the first song opened after
    // the change hands its tempo on, so nobody's saved tempo resets to 100 %.
    const carriedRate = validRate(carried.rate);
    const oldRate = validRate(memory.rate);
    if (carriedRate) setRate(carriedRate, false);
    else if (oldRate) { setRate(oldRate, false); carrySettings({ rate: oldRate }); }
    loading.value = false;
    track("song_open", where());
    window.addEventListener("pagehide", leaving);
    if (sound.value === "sung" && hasSung.value) void loadSung();
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
    windowHeight = window.innerHeight;
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(tick);
  } catch (error) {
    failure.value = String(error);
    loading.value = false;
  }
});

/** The piano: score.mid through the synth, or a rendered file on Firefox for Android. */
async function createPiano(s: Song): Promise<MidiPlayer | FilePlayer> {
  const log = (note: string) => { loadingNote.value = note; };
  const piano = await (wantsFilePlayback() ? FilePlayer : MidiPlayer).create(s.base + "score.mid", s.parts.map((p) => p.name), log);
  playerKind.value = wantsFilePlayback() ? "file" : "midi";
  return piano;
}

/** Hand the song to another player at the same place, with the same part, mix and tempo. */
async function takeOver(next: MidiPlayer | FilePlayer | SungPlayer, t: number, resume: boolean) {
  mixer = next;
  mixer.setMaster(myPart.value);
  mixer.onEnded = () => { playing.value = false; };
  setMode(mode.value, false);
  if (mode.value !== "minus" && mode.value !== "solo") setOthers(others.value, false);
  mixer.setRate(rate.value);
  mixer.seek(t);
  if (resume) await mixer.play();
  playing.value = mixer.playing;
  levels.value = mixer.effectiveLevels();
}

/** Counts sung loads, so a load the singer has since cancelled (Piano) is thrown away. */
let sungLoad = 0;

/**
 * The sung parts, loaded while the piano already plays (Eero, 2026-10-13: singing
 * must not slow the page down). Its code and the MP3s are fetched only now; once
 * every part is decoded the singing takes over at the same place. A load that
 * fails leaves the piano playing, and the Ääni switch says so.
 */
async function loadSung() {
  const s = song.value;
  if (!s || !hasSung.value) return;
  const load = ++sungLoad;
  switching.value = true;
  try {
    const { SungPlayer, loadNotes } = await import("../player/sung");
    const [sung, notes] = await Promise.all([
      SungPlayer.create(s.parts.map((p) => s.base + (p.file ?? ""))),
      loadNotes(s.base + "score.mid", s.parts.map((p) => p.name), s.base + "words.json"),
    ]);
    sung.setBalance(lowLouder.value, middle.value);
    sung.setVolumes(volumes.value);
    if (notes) sung.setUnisons(notes);
    if (load !== sungLoad || sound.value !== "sung" || !mixer) { sung.destroy(); return; }
    const resume = mixer.playing;
    const t = mixer.time();
    mixer.pause();
    mixer.destroy();
    playerKind.value = "sung";
    await takeOver(sung, t, resume);
  } catch (error) {
    console.warn(`sung parts not played: ${String(error)}`);
  } finally {
    if (load === sungLoad) switching.value = false;
  }
}

onBeforeUnmount(() => {
  leaving();
  window.removeEventListener("pagehide", leaving);
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

// ---------------------------------------------------------------- usage events (eeron-omat-taskit#72)

/** Which song, part and kind of song an event is about. */
function where() {
  return { choir: props.choir, song: props.slug, part: song.value?.parts[myPart.value]?.name, sung: hasSung.value };
}
/** What is playing now: the piano also when singing was chosen but has not loaded. */
const playingSound = (): "piano" | "sung" => (playerKind.value === "sung" ? "sung" : "piano");
function settingsNow(): Settings {
  return {
    mode: mode.value, others: settingValue(others.value), rate: settingValue(rate.value), staves: staffMode.value,
    zoom: settingValue(zoom.value), sound: playingSound(),
  };
}
const listens = new ListenTimer<"piano" | "sung">((id, seconds, played) =>
  track("listen", { ...where(), value: played, seconds, listen: id, settings: { ...settingsNow(), sound: played } }));
watch(playing, (on) => { if (on) listens.start(playingSound()); else listens.stop(); });
// Piano and singing are separate listens.
watch(playerKind, () => {
  if (!listens.running) return;
  listens.stop();
  if (playing.value) listens.start(playingSound());
});
let settingsSeen = false;
watch(sheetOpen, (open) => {
  if (!open || settingsSeen) return;
  settingsSeen = true;
  track("settings_open", where());
});
const settles = new SettleTimer();
/** A setting the singer changed; sliders and steppers send the value they end on. */
function noteSetting(setting: SettingName, value: () => string, settle = false) {
  settles.note(setting, () => track("setting", { ...where(), setting, value: value() }), settle);
}
function leaving() {
  listens.stop();
  settles.flush();
}

function reload() {
  location.reload();
}

/**
 * Laid out again only for a new width (page lines re-wrap, a phone turns). A
 * phone's address bar showing or hiding changes just the height: laying out
 * then made the one-line view jump in the middle of a song.
 *
 * The page view checks again that the line being sung is in view only if it
 * showed before: Safari shows and hides its bar as the singer scrolls, and
 * checking every time scrolled the page back while they read ahead (#93).
 */
function onResize() {
  window.clearTimeout(resizeTimer);
  heightBefore ||= windowHeight;
  windowHeight = window.innerHeight;
  resizeTimer = window.setTimeout(() => {
    // Asked as the page is scrolled now, so scrolling on while the bar moves counts too.
    if (lastTop >= 0 && lineInView(lastTop, lastBottom, heightBefore)) lastTop = -1;
    heightBefore = 0;
    if (window.innerWidth === laidOutWidth) return;
    laidOutWidth = window.innerWidth;
    lastTop = -1;
    score?.render();
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
  const lit = score.light(started ? position.measure : null, position.beat,
    focusOf(song.value!.parts, myPart.value));
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
  lastBottom = spot.bottom;
}

function setStyle(el: HTMLElement, name: "transform" | "width" | "height", value: string) {
  if (el.style[name] !== value) el.style[name] = value;
}

/** "Oma" view: scroll the page so the line being sung sits in the upper part of the screen. */
function keepInView(top: number, bottom: number) {
  const box = scoreBox.value;
  if (!box || lineInView(top, bottom, window.innerHeight)) return;
  const visible = window.innerHeight - dockHeight.value;
  const lineTop = box.getBoundingClientRect().top + window.scrollY + top;
  window.scrollTo({ top: Math.max(0, lineTop - visible * 0.2), behavior: "smooth" });
}

/** "Oma" view: whether the line shows above the dock, as the page is scrolled now, in a window this tall. */
function lineInView(top: number, bottom: number, height: number): boolean {
  const box = scoreBox.value;
  if (!box || singleLine.value) return false;
  const pageTop = box.getBoundingClientRect().top + window.scrollY;
  const visible = height - dockHeight.value;
  return pageTop + top >= window.scrollY + 16 && pageTop + bottom <= window.scrollY + visible - 16;
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

/**
 * The line never scrolls up and down. When it fits, the spare room goes 40 % above and
 * 60 % below it, so the lowest notes and lyrics stay clear of the dock; else it is
 * centred on your staff. It is placed as if the address bar were shown, so the bar
 * hiding only adds room below the line instead of moving it (#93).
 */
function verticalOffset(clientHeight: number): number {
  if (!score) return 0;
  // 0 in a browser without `svh`, which then places the line in the whole box.
  const small = smallViewport.value?.offsetHeight || window.innerHeight;
  const boxHeight = clientHeight - Math.max(0, window.innerHeight - small);
  const room = score.height - boxHeight;
  if (room <= 0) return room * 0.4;
  const span = score.partSpan(staffOf(song.value!.parts, myPart.value));
  if (!span) return 0;
  return Math.min(room, Math.max(0, (span.top + span.bottom) / 2 - boxHeight / 2));
}

function changeZoom(step: number) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6);
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]!;
  if (next === zoom.value) return;
  zoom.value = next;
  remembered.setZoom(next);
  noteSetting("zoom", () => settingValue(zoom.value), true);
  score?.setZoom(next);
  lastTop = -1;
}

/** Which staves to draw: all, or only yours (shared with another part when the page prints it so). */
function visibleParts(): boolean[] {
  return visibleStaves(song.value!.parts, myPart.value, singleLine.value);
}

async function setStaffMode(next: StaffMode) {
  if (!score || next === staffMode.value) return;
  staffMode.value = next;
  // Laid out once the page is in the new view: the one-line view's box is as wide as its content.
  await nextTick();
  carrySettings({ staves: next });
  noteSetting("staves", () => next);
  const wrap = scrollBox.value?.firstElementChild as HTMLElement | null;
  if (wrap) wrap.style.transform = "";
  leavePieces(wrap);
  window.scrollTo(0, 0);
  score.singleLine = singleLine.value;
  score.setVisible(visibleParts());
  lastTop = -1;
}

function choosePart(index: number) {
  const parts = song.value!.parts;
  const ownStaffChanges = !singleLine.value && staffOf(parts, index) !== staffOf(parts, myPart.value);
  myPart.value = index;
  const name = song.value!.parts[index]!.name;
  // Picking "Basso" in a song not divided keeps "Basso 2" as the choir's part (#107).
  if (!keepChoirPart(remembered.part(props.choir), name, song.value!.voices)) remembered.setPart(props.choir, name);
  rememberSong(props.choir, props.slug, { part: name });
  mixer?.setMaster(index);
  if (mixer) levels.value = mixer.effectiveLevels();
  if (ownStaffChanges && score) {
    score.setVisible(visibleParts());
    lastTop = -1;
  }
}

/** A part as the singer sees it: its place's name in the voice tree, in the site's language (#107). */
function labelOf(name: string | undefined): string {
  return name === undefined ? "" : partLabel(name, song.value?.voices ?? [], lang.value);
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
  if (save) {
    carrySettings({ mode: next, others: level });
    noteSetting("mode", () => next);
  }
}

function onOthersSlider(value: number) {
  if (mode.value === "solo" && value > 0) setMode("focus");
  setOthers(value);
  noteSetting("others", () => settingValue(others.value), true);
}

function setRate(value: number, save = true) {
  rate.value = value;
  if (save) {
    carrySettings({ rate: value });
    noteSetting("rate", () => settingValue(rate.value), true);
  }
  mixer?.setRate(value);
}

function setBalance(db: number, mid: Pivot) {
  lowLouder.value = db;
  middle.value = mid;
  carrySettings({ lowLouder: db, middle: mid as 60 | "song" | "moment" });
  if (playerKind.value === "sung") (mixer as SungPlayer).setBalance(db, mid);
}

function setVolume(part: number, value: number) {
  volumes.value = volumes.value.map((v, i) => (i === part ? value : v));
  const s = song.value!;
  rememberSong(props.choir, props.slug, { volumes: Object.fromEntries(s.parts.map((p, i) => [p.name, volumes.value[i]!])) });
  if (playerKind.value === "sung") {
    (mixer as SungPlayer).setVolumes(volumes.value);
    levels.value = mixer!.effectiveLevels();
  }
}

/** Swap the piano for the sung parts or back, keeping the place, the tempo and the mix. */
async function setSound(next: "piano" | "sung") {
  if (!song.value || !mixer || next === sound.value && (switching.value || next === shownSound.value)) return;
  sound.value = next;
  carrySettings({ sound: next });
  if (next === "sung") endSungDot();
  track("sound_choice", { ...where(), value: next });
  noteSetting("sound", () => next);
  if (next === "sung") { await loadSung(); return; }
  // Piano: a sung load still under way is dropped, and singing that plays hands back.
  sungLoad++;
  switching.value = false;
  if (playerKind.value !== "sung") return;
  const resume = mixer.playing;
  const t = mixer.time();
  mixer.pause();
  mixer.destroy();
  mixer = null;
  await takeOver(await createPiano(song.value), t, resume);
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

/**
 * Flagging the score (#41): a singer in a private choir says what is wrong and
 * where, and it waits for Eero on /admin. The open list takes no flags.
 */
const canFlag = computed(() => me.value?.choirs.some((c) => c.id === props.choir && !c.public && !c.staging) ?? false);
/** `bar` turns into a number once typed in: Vue reads a number field as one. */
const flagging = ref<{ problems: FlagProblem[]; bar: string | number; note: string; name: string } | null>(null);
const flagError = ref("");
const flagSending = ref(false);
const flagThanks = ref(false);
let flagThanksTimer: number | undefined;

function startFlag() {
  sheetOpen.value = false;
  if (mixer?.playing) {
    mixer.pause();
    playing.value = false;
  }
  flagError.value = "";
  flagging.value = { problems: [], bar: String(bar.value), note: "", name: "" };
}

async function sendFlag() {
  const f = flagging.value!;
  if (!f.problems.length && !f.note.trim()) {
    flagError.value = words().flagNeedSomething;
    return;
  }
  const typed = String(f.bar).trim();
  const barNumber = typed ? Number(typed) : null;
  flagSending.value = true;
  flagError.value = "";
  try {
    const { id } = await postJson<{ id: number }>(
      `/api/songs/${encodeURIComponent(props.choir)}/${encodeURIComponent(props.slug)}/flags`,
      { problems: f.problems, bar: barNumber, note: f.note, name: f.name, part: song.value!.parts[myPart.value]?.name });
    song.value!.flags.unshift({ id, bar: barNumber, problems: [...f.problems], note: f.note.trim() || null,
      created_at: new Date().toISOString() });
    flagging.value = null;
    flagThanks.value = true;
    window.clearTimeout(flagThanksTimer);
    flagThanksTimer = window.setTimeout(() => { flagThanks.value = false; }, 4000);
  } catch (error) {
    flagError.value = (error as Error).message;
  } finally {
    flagSending.value = false;
  }
}

/** "Tahti 12 · Väärä nuotti · the note": one open flag on the settings sheet. */
function flagLine(f: Song["flags"][number]): string {
  return [f.bar ? `${words().bar} ${f.bar}` : "", problemLabels(f.problems), f.note ?? ""].filter(Boolean).join(" · ");
}

function dismissHint() {
  showHint.value = false;
  localStorage.setItem("stemmanauhat:hint-seen", "1");
}

/**
 * Telling singers a song can be heard sung (#84): on a song with singing, a dot on
 * Säädöt for a singer who has never chosen Laulu, and in Säädöt the Ääni row lit up
 * with a dot on Laulu. It stays until Laulu has been tried once on this device
 * (Eero, 2026-10-18). It never covers the score and never plays anything by itself.
 */
const SUNG_TRIED_KEY = "stemmanauhat:sung-tried";
const sungDotWanted = ref(false);
const showSungDot = computed(() => sungDotWanted.value && hasSung.value && !loading.value && !failure.value);
/** Säädöt shows the Ääni row lit up while the dot is wanted. */
const soundLit = computed(() => sheetOpen.value && showSungDot.value);
function endSungDot() {
  sungDotWanted.value = false;
  localStorage.setItem(SUNG_TRIED_KEY, "1");
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
    <div ref="smallViewport" class="small-viewport" aria-hidden="true"></div>
    <p v-if="loading" class="hint page">{{ loadingNote || t.loading }}</p>
    <p v-else-if="failure" class="error page" role="alert">
      {{ t.loadFailed }} {{ failure }}
      <button type="button" class="link" @click="reload">{{ t.retry }}</button>
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
      <div v-if="showHint && !askPart && !sheetOpen && !flagging" class="hint-card" role="note" :style="{ bottom: `${dockHeight + 12}px` }">
        <ul>
          <li v-if="singleLine"><Icon name="tap" :size="20" /><span><b>{{ t.tapWord }}</b>{{ t.tapPlay }}</span></li>
          <li v-else><Icon name="tap" :size="20" /><span><b>{{ t.tapWord }}</b>{{ t.tapMove }}</span></li>
          <li v-if="singleLine"><Icon name="scroll" :size="20" /><span><b>{{ t.dragWord }}</b>{{ t.dragMove }}</span></li>
        </ul>
        <button type="button" @click="dismissHint">{{ t.gotIt }}</button>
      </div>

      <!-- Säädöt: a sheet just above the dock; a tap on the dimmed score closes it. -->
      <div v-if="sheetOpen" class="backdrop" @click="closePanels"></div>
      <!-- No taller than the screen above the dock: Lisäasetukset's part rows scroll within it. -->
      <div v-if="sheetOpen" class="sheet"
        :style="{ bottom: `${dockHeight - 1}px`, maxHeight: `calc(100dvh - ${dockHeight}px - env(safe-area-inset-top) - 8px)` }">
        <div class="handle" aria-hidden="true"></div>
        <ul v-if="song.flags.length" class="flags" :aria-label="t.reportedProblems">
          <li v-for="f in song.flags" :key="f.id">{{ t.reportedProblem }} {{ flagLine(f) }}</li>
        </ul>
        <div class="section-label">{{ t.listening }}</div>
        <div class="segmented modes" role="group" :aria-label="t.howYouListen">
          <button v-for="m in MODES" :key="m.id" type="button" :class="{ on: mode === m.id }"
            :aria-pressed="mode === m.id" @click="setMode(m.id)">{{ m.label }}</button>
        </div>
        <div class="mode-hint">{{ MODES.find((m) => m.id === mode)?.hint }}</div>
        <template v-if="hasSung">
          <div class="setting" :class="{ lit: soundLit }">
            <span class="row-label">{{ t.sound }}</span>
            <div class="segmented two" role="group" :aria-label="t.sound">
              <button type="button" :class="{ on: shownSound === 'piano' }" :aria-pressed="shownSound === 'piano'"
                @click="setSound('piano')">{{ t.piano }}</button>
              <button type="button" :class="{ on: shownSound === 'sung' }" :aria-pressed="shownSound === 'sung'"
                @click="setSound('sung')">{{ t.sung }}<span v-if="soundLit" class="sung-dot"
                  data-testid="sung-dot-choice"></span></button>
            </div>
          </div>
          <div v-if="soundLit" class="mode-hint sung-tip">{{ t.sungTip }}</div>
          <div v-if="switching" class="mode-hint">{{ t.loadingSinging }}</div>
          <div v-else-if="sound === 'sung' && playerKind !== 'sung'" class="mode-hint">{{ t.singingFailed }}</div>
        </template>
        <div class="setting">
          <span class="row-label">{{ t.tempo }}</span>
          <div class="stepper" role="group" :aria-label="t.tempo">
            <button type="button" :aria-label="t.slower" :disabled="rate <= 0.5" @click="stepTempo(-0.05)">−</button>
            <button type="button" class="value" :aria-label="t.normalTempo" @click="setRate(1)">
              {{ rate === 1 ? t.normal : `${Math.round(rate * 100)} %` }}</button>
            <button type="button" :aria-label="t.faster" :disabled="rate >= 1.5" @click="stepTempo(0.05)">+</button>
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-label">{{ t.score }}</div>
        <div class="setting">
          <span class="row-label">{{ t.staves }}</span>
          <div class="segmented two" role="group" :aria-label="t.staves">
            <button type="button" :class="{ on: staffMode === 'all' }" :aria-pressed="staffMode === 'all'"
              @click="setStaffMode('all')">{{ t.allStaves }}</button>
            <button type="button" :class="{ on: staffMode === 'own' }" :aria-pressed="staffMode === 'own'"
              @click="setStaffMode('own')">{{ t.ownStaff }}</button>
          </div>
        </div>
        <div class="setting">
          <span class="row-label">{{ t.scoreSize }}</span>
          <div class="stepper" role="group" :aria-label="t.scoreSize">
            <button type="button" :aria-label="t.smaller" :disabled="zoom <= ZOOMS[0]!" @click="changeZoom(-1)">−</button>
            <span class="value">{{ Math.round(zoom * 100) }} %</span>
            <button type="button" :aria-label="t.larger" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!"
              @click="changeZoom(1)">+</button>
          </div>
        </div>
        <!-- Lisäasetukset (#117): closed until tapped. Muut stemmat for every song; on a sung song
             also the singing's balance by pitch and each sung part's volume. -->
        <details class="advanced">
          <summary>{{ t.advanced }}</summary>
          <div v-if="mode !== 'solo'" class="others-row">
            <span class="row-label">{{ t.otherParts }}</span>
            <input type="range" min="0" max="1" step="0.01" :value="others" :aria-label="t.otherPartsVolume"
              @input="onOthersSlider(Number(($event.target as HTMLInputElement).value))" />
            <span class="others-value">{{ Math.round(gainOf(others) * 100) }} %</span>
          </div>
          <template v-if="hasSung">
            <div class="mode-hint">{{ t.advancedSungOnly }}</div>
            <div class="others-row">
              <span class="row-label">{{ t.lowLouder }}</span>
              <input type="range" min="0" max="12" step="1" :value="lowLouder" :aria-label="t.lowLouder"
                @input="setBalance(Number(($event.target as HTMLInputElement).value), middle)" />
              <span class="others-value">{{ lowLouder }} {{ t.dbPerOctave }}</span>
            </div>
            <div class="setting">
              <span class="row-label">{{ t.middle }}</span>
              <div class="segmented three" role="group" :aria-label="t.middle">
                <button v-for="m in MIDDLES" :key="m" type="button" :class="{ on: middle === m }" :aria-pressed="middle === m"
                  @click="setBalance(lowLouder, m)">{{ m === 60 ? "C4" : m === "song" ? t.middleSong : t.middleMoment }}</button>
              </div>
            </div>
            <div class="mode-hint">{{ middle === 60 ? t.middleCHint : middle === "song" ? t.middleSongHint : t.middleMomentHint }}</div>
            <div v-for="(p, i) in song.parts" :key="p.name" class="others-row">
              <span class="row-label">{{ labelOf(p.name) }}</span>
              <input type="range" min="0" max="2" step="0.05" :value="volumes[i] ?? 1" :aria-label="`${labelOf(p.name)}: ${t.partVolume}`"
                @input="setVolume(i, Number(($event.target as HTMLInputElement).value))" />
              <span class="others-value">{{ Math.round((volumes[i] ?? 1) * 100) }} %</span>
            </div>
          </template>
        </details>
        <template v-if="canFlag">
          <div class="divider"></div>
          <button type="button" class="flag-open" @click="startFlag">{{ t.reportProblem }}</button>
        </template>
      </div>

      <div v-if="flagThanks" class="hint-card" role="status" :style="{ bottom: `${dockHeight + 12}px` }">
        <span class="flag-thanks">{{ t.flagThanks }}</span>
        <button type="button" @click="flagThanks = false">{{ t.gotIt }}</button>
      </div>

      <!-- The dock: the position line on its top edge, then one row. -->
      <section ref="dock" class="dock" :data-gains="levels.map((g) => g.toFixed(3)).join(' ')" :data-player="playerKind">
        <input class="progress" type="range" min="0" :max="duration" step="0.1" :value="now"
          :style="{ '--fill': `${duration ? (now / duration) * 100 : 0}%` }" :aria-label="t.position"
          @input="seekTo" />
        <div class="dock-row">
          <a :href="`/c/${encodeURIComponent(props.choir)}`" class="back" :aria-label="t.backToSongs">
            <Icon name="chevronLeft" :size="24" /></a>
          <div class="info">
            <span class="info-title">{{ song.title }}</span>
            <span v-if="credits(song)" class="info-credits">{{ credits(song) }}</span>
            <span class="info-meta">{{ t.bar }} {{ bar }} / {{ barCount }} ·
              <span data-testid="time">{{ clock(now) }}</span> / {{ clock(duration) }}</span>
            <!-- The voice's terms: credit it wherever its singing plays (AGENTS.md). -->
            <span v-if="switching && sound === 'sung'" class="info-credits sung-loading">{{ t.loadingSinging }}</span>
            <span v-else-if="playerKind === 'sung'" class="info-credits sung-credit">{{ sungCredit(song.parts) }}</span>
          </div>
          <button type="button" class="own" :aria-label="t.changePart" @click="askPart = true">
            <span class="own-tag">{{ t.ownTag }}</span><span class="own-name">{{ labelOf(song.parts[myPart]?.name) }}</span></button>
          <button type="button" class="play" :aria-label="playing ? t.pause : t.play"
            :data-sounding="sounding ? '1' : '0'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" :size="24" /></button>
          <button type="button" class="settings" :class="{ on: sheetOpen }" :aria-expanded="sheetOpen"
            :aria-label="sheetOpen ? t.closeSettings : t.settings" @click="sheetOpen = !sheetOpen">
            <Icon :name="sheetOpen ? 'close' : 'more'" :size="22" />
            <span v-if="showSungDot && !sheetOpen" class="sung-dot" data-testid="sung-dot"></span></button>
        </div>
      </section>

      <!-- Ilmoita virheestä (#41): a sheet from the bottom, over everything, like the part picker. -->
      <template v-if="flagging">
        <div class="picker-backdrop" @click="flagging = null"></div>
        <form class="picker flag-form" role="dialog" :aria-label="t.reportProblem" @submit.prevent="sendFlag">
          <div class="handle" aria-hidden="true"></div>
          <h2>{{ t.reportProblem }}</h2>
          <p>{{ t.flagIntro }}</p>
          <div class="flag-problems" role="group" :aria-label="t.whatsWrong">
            <label v-for="(label, key) in t.flagProblems" :key="key" :class="{ on: flagging.problems.includes(key) }">
              <input v-model="flagging.problems" type="checkbox" :value="key" />{{ label }}</label>
          </div>
          <label class="flag-field flag-bar">{{ t.bar }}
            <input v-model="flagging.bar" type="number" inputmode="numeric" min="1" :max="barCount" /></label>
          <label class="flag-field">{{ t.notes }}
            <textarea v-model="flagging.note" rows="2" maxlength="1000"></textarea></label>
          <label v-if="!me?.email" class="flag-field">{{ t.yourName }}
            <input v-model="flagging.name" type="text" maxlength="100" /></label>
          <p v-if="flagError" class="error" role="alert">{{ flagError }}</p>
          <div class="flag-actions">
            <button type="submit" class="send" :disabled="flagSending">{{ t.send }}</button>
            <button type="button" @click="flagging = null">{{ t.cancel }}</button>
          </div>
        </form>
      </template>

      <!-- Oma stemma: a sheet from the bottom, over everything. On the first visit a part must be picked. -->
      <template v-if="askPart">
        <div class="picker-backdrop" @click="if (!firstAsk) askPart = false;"></div>
        <div class="picker" role="dialog" :aria-label="t.chooseYourPart">
          <div class="handle" aria-hidden="true"></div>
          <h2>{{ t.whichPart }}</h2>
          <p>{{ t.partIntro }}</p>
          <div class="picker-grid">
            <button v-for="(p, i) in song.parts" :key="i" type="button"
              :class="{ mine: i === myPart && !firstAsk }" @click="pickPart(i)">{{ labelOf(p.name) }}</button>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>
