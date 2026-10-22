<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { getJson, hasSungParts, listCredits, postForm, postJson, Refused, remembered, type Me, type Setlist, type SongOrder, type SongRequest,
  songListKey, type SongSummary } from "../api";
import Icon from "../components/Icon.vue";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import SiteCredit from "../components/SiteCredit.vue";
import { byTitle, day, t, words } from "../i18n";
import { firstThisVisit, installed, installPrompt, ios, markDone, noticeAllowed, standalone } from "../install";
import { track } from "../track";
import { PDF_MAX_BYTES, pdfTitle } from "../../worker/requests";
import RefusedView from "./Refused.vue";

const props = defineProps<{ choir: string }>();
const songs = ref<SongSummary[]>([]);
const choirName = ref("");
const me = ref<Me | null>(null);
const refused = ref<number | null>(null);
const query = ref("");
const order = ref<SongOrder>(remembered.order());
function sortBy(value: SongOrder) {
  order.value = value;
  remembered.setOrder(value);
}

/** The songs listened to lately, most popular first, tied songs in one group; the rest are not in it. */
const popular = ref<string[][]>([]);
const setlists = ref<Setlist[]>([]);
const picked = ref<number | null>(remembered.setlist(props.choir));
function pick(id: number | null) {
  picked.value = id;
  remembered.setSetlist(props.choir, id);
}
/** The picked setlist, or null for every song (also when the remembered one is gone). */
const setlist = computed(() => setlists.value.find((l) => l.id === picked.value) ?? null);

type ListData = { choir: { name: string }; songs: SongSummary[]; setlists: Setlist[]; requests: SongRequest[];
  openFlags: number; popular?: string[][] };
// The page shows nothing until it has both answers, then all of it at once. Coming
// back from a song, the last answers (kept for this tab) show at once and are then
// refreshed, so the list does not pop in piece by piece or lose its scroll (#43).
const cacheKey = songListKey(props.choir);
const listUrl = `/api/songs?choir=${encodeURIComponent(props.choir)}`;
const ready = ref(false);
function show(data: ListData) {
  choirName.value = data.choir.name;
  songs.value = data.songs;
  setlists.value = data.setlists;
  requests.value = data.requests;
  openFlags.value = data.openFlags;
  // A list kept from before the groups (#89) had plain slugs.
  popular.value = (data.popular ?? []).map((group) => (Array.isArray(group) ? group : [group]));
}
async function load() {
  const data = await getJson<ListData>(listUrl);
  show(data);
  if (me.value) sessionStorage.setItem(cacheKey, JSON.stringify({ me: me.value, data }));
}

try {
  const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null") as { me: Me; data: ListData } | null;
  if (cached?.me && cached.data) {
    me.value = cached.me;
    show(cached.data);
    ready.value = true;
  }
} catch {
  sessionStorage.removeItem(cacheKey);
}

onMounted(async () => {
  const fresh = getJson<Me>("/api/me");
  const songsData = getJson<ListData>(listUrl);
  songsData.catch(() => {}); // Awaited below; this only keeps an early failure from going unhandled.
  try {
    me.value = await fresh;
    show(await songsData);
    sessionStorage.setItem(cacheKey, JSON.stringify({ me: me.value, data: await songsData }));
  } catch (error) {
    sessionStorage.removeItem(cacheKey);
    if (error instanceof Refused) refused.value = error.status;
    else throw error;
  } finally {
    ready.value = true;
  }
});

const newest = computed(() => new Set([...songs.value]
  .sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 3).map((s) => s.slug)));
const bySlug = computed(() => new Map(songs.value.map((s) => [s.slug, s])));
/** The songs to list; in a setlist, in its order and with each song's place in it. */
const shown = computed((): (SongSummary & { place?: number })[] => {
  const q = query.value.trim().toLowerCase();
  const matches = (s: SongSummary) => !q || s.title.toLowerCase().includes(q);
  if (setlist.value) {
    return setlist.value.songs.flatMap((slug) => bySlug.value.get(slug) ?? [])
      .map((s, i) => ({ ...s, place: i + 1 }))
      .filter(matches);
  }
  // Tied songs, and those with no listens lately (after the popular ones), go by name.
  const rank = new Map(popular.value.flatMap((group, i) => group.map((slug) => [slug, i] as const)));
  const rankOf = (s: SongSummary) => rank.get(s.slug) ?? popular.value.length;
  return [...songs.value]
    .filter(matches)
    .sort((a, b) => (order.value === "date" ? b.published_at.localeCompare(a.published_at)
      : order.value === "popular" ? rankOf(a) - rankOf(b) : 0)
      || byTitle(a, b));
});
/** With a setlist picked, a search also finds the songs outside it, so a remembered
 * setlist cannot quietly hide a song (#49). */
const others = computed((): SongSummary[] => {
  const q = query.value.trim().toLowerCase();
  if (!setlist.value || !q) return [];
  const inList = new Set(setlist.value.songs);
  return songs.value.filter((s) => !inList.has(s.slug) && s.title.toLowerCase().includes(q))
    .sort(byTitle);
});
/** How many of the choir's songs the picked setlist leaves out of the list. */
const inSetlist = computed(() => setlist.value?.songs.filter((slug) => bySlug.value.has(slug)).length ?? 0);

// Admins make and change setlists here, where the songs to choose from are.
const editing = ref<{ id: number | null; name: string; songs: string[] } | null>(null);
const editMessage = ref("");
const editPicked = computed(() => editing.value?.songs.flatMap((slug) => bySlug.value.get(slug) ?? []) ?? []);
const editRest = computed(() => songs.value.filter((s) => !editing.value?.songs.includes(s.slug)).sort(byTitle));
function startNew() {
  editMessage.value = "";
  editing.value = { id: null, name: "", songs: [] };
}
function startEdit(list: Setlist) {
  editMessage.value = "";
  editing.value = { id: list.id, name: list.name, songs: [...list.songs] };
}
function move(index: number, by: number) {
  const list = editing.value!.songs;
  const to = index + by;
  if (to < 0 || to >= list.length) return;
  [list[index], list[to]] = [list[to]!, list[index]!];
}
function toggle(slug: string) {
  const list = editing.value!.songs;
  const at = list.indexOf(slug);
  if (at >= 0) list.splice(at, 1);
  else list.push(slug);
}
async function save() {
  const edit = editing.value!;
  try {
    const r = await postJson<{ id: number }>("/api/admin/setlists", {
      choir: props.choir, name: edit.name, songs: edit.songs, ...(edit.id === null ? {} : { id: edit.id }),
    });
    await load();
    pick(r.id);
    editing.value = null;
    editMessage.value = words().saved;
  } catch (error) {
    editMessage.value = (error as Error).message;
  }
}
async function removeSetlist() {
  const edit = editing.value!;
  if (edit.id === null || !confirm(words().confirmDeleteSetlist(edit.name))) return;
  try {
    await postJson("/api/admin/setlists", { choir: props.choir, id: edit.id, delete: true });
    await load();
    pick(null);
    editing.value = null;
    editMessage.value = words().setlistDeleted;
  } catch (error) {
    editMessage.value = (error as Error).message;
  }
}
// A singer asks for a new practice track (#38). Every field is optional, but a
// request needs a song name or a PDF. The open list takes no requests.
const requests = ref<SongRequest[]>([]);
/** Open flags on this choir's songs (#41): only counted here, for the admin's link. */
const openFlags = ref(0);
const canRequest = computed(() => me.value?.choirs.some((c) => c.id === props.choir && !c.public && !c.staging) ?? false);
const requesting = ref<{ title: string; credits: string; note: string; name: string } | null>(null);
// Up to ten PDFs at once (#77), each sent as its own request named after its
// file; with two or more, the name and composer fields go and the note is
// copied to each.
const PDFS_MAX = 10;
const requestPdfs = ref<File[]>([]);
const pdfInput = ref<HTMLInputElement | null>(null);
const pdfErrors = ref(new Map<File, string>());
const several = computed(() => requestPdfs.value.length > 1);
const requestMessage = ref("");
const sending = ref(false);
function startRequest() {
  requestMessage.value = "";
  requestPdfs.value = [];
  pdfErrors.value = new Map();
  requesting.value = { title: "", credits: "", note: "", name: "" };
}
function setPdfs(files: File[]) {
  const before = requestPdfs.value;
  requestPdfs.value = files;
  pdfErrors.value = new Map();
  if (!files.length && pdfInput.value) pdfInput.value.value = "";
  // An empty song name takes the file's name, which can still be edited;
  // so does one the previous file gave, but never one typed in. Coming down
  // from several files, the name field was hidden, so whatever it held then
  // belongs to no file left: the remaining file names it.
  const r = requesting.value;
  if (files.length !== 1 || !r) return;
  const given = before.length === 1 ? pdfTitle(before[0]!.name) ?? "" : "";
  if (before.length > 1 || !r.title.trim() || r.title === given) r.title = pdfTitle(files[0]!.name) ?? "";
}
function pickPdf(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  requestMessage.value = "";
  if (files.length > PDFS_MAX) {
    input.value = "";
    setPdfs([]);
    requestMessage.value = words().tooManyPdfs;
    return;
  }
  setPdfs(files);
}
function removePdf(file: File) {
  setPdfs(requestPdfs.value.filter((f) => f !== file));
}
/** One request; the error to show for it, or null once it is sent. */
async function sendOne(fields: Record<string, string>, pdf: File | undefined): Promise<string | null> {
  // Said here rather than after uploading it all from a phone.
  if (pdf && pdf.size > PDF_MAX_BYTES) return words().pdfTooBig;
  const form = new FormData();
  form.set("choir", props.choir);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (pdf) form.set("pdf", pdf);
  try {
    await postForm("/api/requests", form);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
async function sendRequest() {
  const r = requesting.value!;
  const pdfs = requestPdfs.value;
  if (!r.title.trim() && !pdfs.length) {
    requestMessage.value = words().needTitleOrPdf;
    return;
  }
  sending.value = true;
  try {
    if (!several.value) {
      const error = await sendOne(r, pdfs[0]);
      if (error) {
        requestMessage.value = error;
        return;
      }
      requesting.value = null;
      requestMessage.value = words().requestSent;
    } else {
      // One upload each, one after another, so each stays under the size limits.
      // The same note for every song, whatever happens to the form meanwhile.
      const fields = { note: r.note, name: r.name };
      const failed = new Map<File, string>();
      for (const pdf of pdfs) {
        const error = await sendOne(fields, pdf);
        if (error) failed.set(pdf, error);
      }
      if (failed.size) {
        setPdfs([...failed.keys()]);
        pdfErrors.value = failed;
        requestMessage.value = words().sentSome(pdfs.length - failed.size, pdfs.length);
      } else {
        requesting.value = null;
        requestMessage.value = words().requestsSent(pdfs.length);
      }
    }
    await load();
  } finally {
    sending.value = false;
  }
}
// The test list (#73): an admin moves a tried-out song to a choir's list.
const staging = computed(() => me.value?.choirs.some((c) => c.id === props.choir && c.staging) ?? false);
const moveTargets = computed(() => me.value?.choirs.filter((c) => !c.staging) ?? []);
const moveMessage = ref("");
async function moveSong(s: SongSummary, select: HTMLSelectElement) {
  const target = moveTargets.value.find((c) => c.id === select.value);
  select.value = "";
  if (!target || !confirm(words().confirmMove(s.title, target.name))) return;
  try {
    await postJson("/api/admin/move", { choir: props.choir, slug: s.slug, to: target.id });
    await load();
    moveMessage.value = words().moved(s.title, target.name);
  } catch (error) {
    moveMessage.value = (error as Error).message;
  }
}
const last = computed(() => {
  const slug = remembered.last(props.choir);
  return songs.value.find((s) => s.slug === slug) ?? null;
});
// Installing as an app (#91): a quiet card on the song list, never in the player.
// Not beside the card asking to add a Google account, and not on the test list.
const inApp = standalone();
const dismissed = ref(false);
const installWay = computed((): "prompt" | "ios" | null => {
  if (inApp || installed.value || dismissed.value || !ready.value || refused.value || staging.value
    || me.value?.joinable.includes(props.choir)) return null;
  return ios() ? "ios" : installPrompt.value ? "prompt" : null;
});
// Asked only once there is a way to install, so a browser with none uses up no showing.
const installAllowed = ref<boolean | null>(null);
const installNotice = computed(() => installWay.value && installAllowed.value ? installWay.value : null);
watch(installWay, (way) => {
  if (!way || installAllowed.value !== null) return;
  installAllowed.value = noticeAllowed();
  if (installAllowed.value && firstThisVisit(`stemmanauhat:install-shown:${props.choir}`)) track("install_shown", { choir: props.choir, value: way });
}, { immediate: true });
async function install() {
  const prompt = installPrompt.value;
  if (!prompt) return;
  installPrompt.value = null; // A prompt can be shown only once.
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === "accepted") {
    // Chrome also says appinstalled, which counts it again (install.ts): the
    // admin page counts people, so one install is still one.
    markDone();
    installed.value = true;
    track("install_accept", { choir: props.choir });
  }
}
function dismissInstall() {
  markDone();
  dismissed.value = true;
  track("install_dismiss", { choir: props.choir, value: installWay.value ?? undefined });
}
const joinUrl = computed(() => `/auth/login?next=${encodeURIComponent(`/c/${props.choir}`)}`);
const songUrl = (slug: string) => `/c/${encodeURIComponent(props.choir)}/${encodeURIComponent(slug)}`;
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else-if="!ready" class="page songlist"></main>
  <main v-else class="page songlist">
    <header class="bar">
      <a href="/" class="home-link">{{ t.siteName }}</a>
      <h1>{{ choirName }}</h1>
    </header>
    <aside v-if="me?.joinable.includes(choir)" class="join card">
      <p>{{ t.joinText }}</p>
      <a class="button primary" :href="joinUrl">{{ t.joinButton }}</a>
    </aside>
    <aside v-if="installNotice" class="install card">
      <p>{{ installNotice === "ios" ? t.installIosText : t.installText }}</p>
      <div class="row">
        <button v-if="installNotice === 'prompt'" type="button" class="primary" @click="install">{{ t.installButton }}</button>
        <button type="button" :class="{ link: installNotice === 'prompt' }" @click="dismissInstall">{{ installNotice === "ios" ? t.gotIt : t.notNow }}</button>
      </div>
    </aside>
    <a v-if="last" class="button primary continue" :href="songUrl(last.slug)">▶ {{ t.continueFrom }}: {{ last.title }}</a>
    <section v-if="editing" class="card setlist-edit">
      <h2>{{ editing.id === null ? t.newSetlist : t.editSetlist }}</h2>
      <input v-model="editing.name" type="text" :placeholder="t.setlistName" :aria-label="t.setlistName" />
      <p v-if="editMessage" class="hint">{{ editMessage }}</p>
      <ol class="songs picked">
        <li v-for="(s, i) in editPicked" :key="s.slug">
          <label><input type="checkbox" checked @change="toggle(s.slug)" />{{ s.title }}</label>
          <button type="button" class="link" :disabled="i === 0" :aria-label="t.moveUp(s.title)" @click="move(i, -1)">↑</button>
          <button type="button" class="link" :disabled="i === editPicked.length - 1" :aria-label="t.moveDown(s.title)" @click="move(i, 1)">↓</button>
        </li>
      </ol>
      <p v-if="!editPicked.length" class="hint">{{ t.pickSongsBelow }}</p>
      <h3>{{ t.addSongs }}</h3>
      <ul class="songs">
        <li v-for="s in editRest" :key="s.slug">
          <label><input type="checkbox" @change="toggle(s.slug)" />{{ s.title }}</label>
        </li>
      </ul>
      <div class="row">
        <button type="button" class="primary" @click="save">{{ t.save }}</button>
        <button type="button" @click="editing = null">{{ t.cancel }}</button>
        <button v-if="editing.id !== null" type="button" class="link" @click="removeSetlist">{{ t.deleteSetlist }}</button>
      </div>
    </section>
    <section v-else-if="requesting" class="card request-form">
      <h2>{{ t.requestTrack }}</h2>
      <p class="hint">{{ t.requestHint }}</p>
      <template v-if="!several">
        <label>{{ t.songName }}<input v-model="requesting.title" type="text" maxlength="200" :disabled="sending" /></label>
        <label>{{ t.composerArranger }}<input v-model="requesting.credits" type="text" maxlength="200" :disabled="sending" /></label>
      </template>
      <label>{{ t.notes }}<textarea v-model="requesting.note" rows="3" maxlength="1000" :disabled="sending"></textarea></label>
      <label v-if="!me?.email">{{ t.yourName }}<input v-model="requesting.name" type="text" maxlength="100" :disabled="sending" /></label>
      <label>{{ t.musicPdfOptional }}<input ref="pdfInput" type="file" accept="application/pdf,.pdf" multiple :disabled="sending" @change="pickPdf" /></label>
      <p class="hint">{{ t.pdfsHint }}</p>
      <ul v-if="requestPdfs.length" class="pdf-list">
        <li v-for="pdf in requestPdfs" :key="pdf.name + pdf.size + pdf.lastModified">
          <span class="pdf-name">{{ pdfTitle(pdf.name) ?? pdf.name }}<span v-if="pdfErrors.get(pdf)" class="pdf-error error">{{ pdfErrors.get(pdf) }}</span></span>
          <button type="button" class="link" :aria-label="t.removePdf(pdfTitle(pdf.name) ?? pdf.name)" :disabled="sending" @click="removePdf(pdf)">✕</button>
        </li>
      </ul>
      <p v-if="requestMessage" class="hint">{{ requestMessage }}</p>
      <div class="row">
        <button type="button" class="primary" :disabled="sending" @click="sendRequest">{{ t.send }}</button>
        <!-- Not while a batch is still going up: it would carry on unseen (#77). -->
        <button type="button" :disabled="sending" @click="requesting = null">{{ t.cancel }}</button>
      </div>
    </section>
    <template v-else>
      <p v-if="staging" class="hint staging-hint">{{ t.stagingHint }}</p>
      <p v-if="moveMessage" class="hint move-message">{{ moveMessage }}</p>
      <div v-if="!staging && (setlists.length || me?.admin)" class="row setlists">
        <select v-if="setlists.length" :value="setlist?.id ?? ''" :aria-label="t.setlist" :class="{ picked: setlist }"
          @change="pick(Number(($event.target as HTMLSelectElement).value) || null)">
          <option value="">{{ t.allSongs }}</option>
          <option v-for="l in setlists" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
        <button v-if="setlist" type="button" @click="pick(null)">{{ t.showAll }}</button>
        <button v-if="me?.admin && setlist" type="button" @click="startEdit(setlist)">{{ t.edit }}</button>
        <button v-if="me?.admin" type="button" @click="startNew">{{ t.newSetlist }}</button>
      </div>
      <p v-if="editMessage" class="hint">{{ editMessage }}</p>
      <input v-model="query" class="search" type="search" :placeholder="t.searchSongs" :aria-label="t.searchSongs" />
      <div v-if="!setlist" class="segmented order" role="group" :aria-label="t.order">
        <button type="button" :class="{ on: order === 'popular' }" :aria-pressed="order === 'popular'" @click="sortBy('popular')">{{ t.popular }}</button>
        <button type="button" :class="{ on: order === 'name' }" :aria-pressed="order === 'name'" @click="sortBy('name')">{{ t.byName }}</button>
        <button type="button" :class="{ on: order === 'date' }" :aria-pressed="order === 'date'" @click="sortBy('date')">{{ t.newest }}</button>
      </div>
      <ul v-if="shown.length || !others.length" class="songs">
        <li v-for="s in shown" :key="s.slug">
          <span v-if="s.place" class="place">{{ s.place }}.</span>
          <a :href="songUrl(s.slug)"><span class="song-title">{{ s.title }}<span v-if="hasSungParts(s.parts)" class="sung-mark" role="img" :aria-label="t.sungVersion" :title="t.sungVersion"><Icon name="voice" :size="15" /></span></span>
            <span class="credits">{{ listCredits(s) }}</span></a>
          <span v-if="newest.has(s.slug)" class="badge">{{ t.newBadge }}</span>
          <span v-if="order === 'date' && !setlist" class="date">{{ day(s.published_at) }}</span>
          <select v-if="staging" class="move" value="" :aria-label="t.moveSongTo(s.title)"
            @change="moveSong(s, $event.target as HTMLSelectElement)">
            <option value="" disabled>{{ t.moveTo }}</option>
            <option v-for="c in moveTargets" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </li>
      </ul>
      <template v-if="others.length">
        <h2 class="others-heading">{{ t.otherSongs }}</h2>
        <ul class="songs others">
          <li v-for="s in others" :key="s.slug">
            <a :href="songUrl(s.slug)"><span class="song-title">{{ s.title }}<span v-if="hasSungParts(s.parts)" class="sung-mark" role="img" :aria-label="t.sungVersion" :title="t.sungVersion"><Icon name="voice" :size="15" /></span></span>
              <span class="credits">{{ listCredits(s) }}</span></a>
            <span v-if="newest.has(s.slug)" class="badge">{{ t.newBadge }}</span>
          </li>
        </ul>
      </template>
      <p v-if="!songs.length" class="hint">{{ t.noSongs }}</p>
      <p v-else-if="setlist && !setlist.songs.length" class="hint">{{ t.setlistEmpty }}</p>
      <p v-if="setlist && !query.trim() && inSetlist < songs.length" class="hint setlist-note">
        {{ t.setlistCount(inSetlist, songs.length) }}
        <button type="button" class="link" @click="pick(null)">{{ t.showAll }}</button>
      </p>
      <section v-if="canRequest" class="requests">
        <h2 v-if="requests.length">{{ t.requested(requests.length) }}</h2>
        <!-- Not .songs: the song list's tests and styles mean the songs alone. -->
        <ul v-if="requests.length" class="requested">
          <li v-for="r in requests" :key="r.id">
            <span class="request"><span class="request-title">{{ r.title ?? t.pdfOnly }}</span>
              <span class="request-details">{{ [r.credits, r.note].filter(Boolean).join(" · ") }}</span></span>
            <span class="request-date">{{ day(r.created_at) }}</span>
          </li>
        </ul>
        <p v-if="requestMessage" class="hint">{{ requestMessage }}</p>
        <button type="button" @click="startRequest">{{ t.requestTrack }}</button>
      </section>
    </template>
    <footer class="row">
      <a v-if="me?.admin" href="/admin">{{ t.admin }}</a>
      <a v-if="me?.admin && canRequest && requests.length + openFlags" href="/admin">{{ t.requestsCount(requests.length + openFlags) }}</a>
      <form v-if="me?.email || me?.linked.length" method="post" action="/auth/logout">
        <button type="submit" class="link">{{ t.signOut }}</button>
      </form>
      <LanguageSwitch />
    </footer>
    <SiteCredit />
  </main>
</template>
