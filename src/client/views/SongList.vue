<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getJson, listCredits, postJson, Refused, remembered, type Me, type Setlist, type SongOrder, type SongSummary } from "../api";
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

const setlists = ref<Setlist[]>([]);
const picked = ref<number | null>(remembered.setlist(props.choir));
function pick(id: number | null) {
  picked.value = id;
  remembered.setSetlist(props.choir, id);
}
/** The picked setlist, or null for every song (also when the remembered one is gone). */
const setlist = computed(() => setlists.value.find((l) => l.id === picked.value) ?? null);

async function load() {
  const data = await getJson<{ choir: { name: string }; songs: SongSummary[]; setlists: Setlist[] }>(
    `/api/songs?choir=${encodeURIComponent(props.choir)}`);
  choirName.value = data.choir.name;
  songs.value = data.songs;
  setlists.value = data.setlists;
}

onMounted(async () => {
  me.value = await getJson<Me>("/api/me");
  try {
    await load();
  } catch (error) {
    if (error instanceof Refused) refused.value = error.status;
    else throw error;
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
  return [...songs.value]
    .filter(matches)
    .sort((a, b) => (order.value === "date" ? b.published_at.localeCompare(a.published_at) : 0)
      || a.title.localeCompare(b.title, "fi"));
});

// Admins make and change setlists here, where the songs to choose from are.
const editing = ref<{ id: number | null; name: string; songs: string[] } | null>(null);
const editMessage = ref("");
const byTitle = (a: SongSummary, b: SongSummary) => a.title.localeCompare(b.title, "fi");
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
    editMessage.value = "Tallennettu.";
  } catch (error) {
    editMessage.value = (error as Error).message;
  }
}
async function removeSetlist() {
  const edit = editing.value!;
  if (edit.id === null || !confirm(`Poistetaanko setlista ${edit.name}?`)) return;
  try {
    await postJson("/api/admin/setlists", { choir: props.choir, id: edit.id, delete: true });
    await load();
    pick(null);
    editing.value = null;
    editMessage.value = "Setlista poistettu.";
  } catch (error) {
    editMessage.value = (error as Error).message;
  }
}
const day = (at: string) => new Date(at).toLocaleDateString("fi-FI");
const last = computed(() => {
  const slug = remembered.last(props.choir);
  return songs.value.find((s) => s.slug === slug) ?? null;
});
const joinUrl = computed(() => `/auth/login?next=${encodeURIComponent(`/c/${props.choir}`)}`);
const songUrl = (slug: string) => `/c/${encodeURIComponent(props.choir)}/${encodeURIComponent(slug)}`;
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else class="page songlist">
    <header class="bar">
      <a href="/" class="home-link">Stemmanauhat</a>
      <h1>{{ choirName }}</h1>
    </header>
    <aside v-if="me?.joinable.includes(choir)" class="join card">
      <p>Pääsit sisään linkillä. Lisää Google-tilisi kuoron jäseneksi, niin pysyt kirjautuneena kaikilla laitteillasi.</p>
      <a class="button primary" :href="joinUrl">Lisää Google-tili</a>
    </aside>
    <a v-if="last" class="button primary continue" :href="songUrl(last.slug)">▶ Jatka siitä: {{ last.title }}</a>
    <section v-if="editing" class="card setlist-edit">
      <h2>{{ editing.id === null ? "Uusi setlista" : "Muokkaa setlistaa" }}</h2>
      <input v-model="editing.name" type="text" placeholder="Setlistan nimi" aria-label="Setlistan nimi" />
      <p v-if="editMessage" class="hint">{{ editMessage }}</p>
      <ol class="songs picked">
        <li v-for="(s, i) in editPicked" :key="s.slug">
          <label><input type="checkbox" checked @change="toggle(s.slug)" />{{ s.title }}</label>
          <button type="button" class="link" :disabled="i === 0" :aria-label="`Siirrä ylös: ${s.title}`" @click="move(i, -1)">↑</button>
          <button type="button" class="link" :disabled="i === editPicked.length - 1" :aria-label="`Siirrä alas: ${s.title}`" @click="move(i, 1)">↓</button>
        </li>
      </ol>
      <p v-if="!editPicked.length" class="hint">Valitse kappaleet alta.</p>
      <h3>Lisää kappaleita</h3>
      <ul class="songs">
        <li v-for="s in editRest" :key="s.slug">
          <label><input type="checkbox" @change="toggle(s.slug)" />{{ s.title }}</label>
        </li>
      </ul>
      <div class="row">
        <button type="button" class="primary" @click="save">Tallenna</button>
        <button type="button" @click="editing = null">Peru</button>
        <button v-if="editing.id !== null" type="button" class="link" @click="removeSetlist">Poista setlista</button>
      </div>
    </section>
    <template v-else>
      <div v-if="setlists.length || me?.admin" class="row setlists">
        <select v-if="setlists.length" :value="setlist?.id ?? ''" aria-label="Setlista"
          @change="pick(Number(($event.target as HTMLSelectElement).value) || null)">
          <option value="">Kaikki kappaleet</option>
          <option v-for="l in setlists" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
        <button v-if="me?.admin && setlist" type="button" @click="startEdit(setlist)">Muokkaa</button>
        <button v-if="me?.admin" type="button" @click="startNew">Uusi setlista</button>
      </div>
      <p v-if="editMessage" class="hint">{{ editMessage }}</p>
      <input v-model="query" class="search" type="search" placeholder="Hae kappaletta" aria-label="Hae kappaletta" />
      <div v-if="!setlist" class="segmented two order" role="group" aria-label="Järjestys">
        <button type="button" :class="{ on: order === 'name' }" :aria-pressed="order === 'name'" @click="sortBy('name')">Nimi</button>
        <button type="button" :class="{ on: order === 'date' }" :aria-pressed="order === 'date'" @click="sortBy('date')">Uusimmat</button>
      </div>
      <ul class="songs">
        <li v-for="s in shown" :key="s.slug">
          <span v-if="s.place" class="place">{{ s.place }}.</span>
          <a :href="songUrl(s.slug)"><span class="song-title">{{ s.title }}</span>
            <span class="credits">{{ listCredits(s) }}</span></a>
          <span v-if="newest.has(s.slug)" class="badge">Uusi</span>
          <span v-if="order === 'date' && !setlist" class="date">{{ day(s.published_at) }}</span>
        </li>
      </ul>
      <p v-if="!songs.length" class="hint">Ei vielä kappaleita.</p>
      <p v-else-if="setlist && !setlist.songs.length" class="hint">Setlistassa ei ole vielä kappaleita.</p>
    </template>
    <footer class="row">
      <a v-if="me?.admin" href="/admin">Ylläpito</a>
      <form v-if="me?.email || me?.linked.length" method="post" action="/auth/logout">
        <button type="submit" class="link">Kirjaudu ulos</button>
      </form>
    </footer>
  </main>
</template>
