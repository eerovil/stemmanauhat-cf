<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getJson, Refused, remembered, type Me, type SongSummary } from "../api";
import RefusedView from "./Refused.vue";

const props = defineProps<{ choir: string }>();
const songs = ref<SongSummary[]>([]);
const choirName = ref("");
const me = ref<Me | null>(null);
const refused = ref<number | null>(null);
const query = ref("");

onMounted(async () => {
  me.value = await getJson<Me>("/api/me");
  try {
    const data = await getJson<{ choir: { name: string }; songs: SongSummary[] }>(
      `/api/songs?choir=${encodeURIComponent(props.choir)}`);
    choirName.value = data.choir.name;
    songs.value = data.songs;
  } catch (error) {
    if (error instanceof Refused) refused.value = error.status;
    else throw error;
  }
});

const newest = computed(() => new Set([...songs.value]
  .sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 3).map((s) => s.slug)));
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...songs.value]
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, "fi"));
});
const last = computed(() => {
  const slug = remembered.last(props.choir);
  return songs.value.find((s) => s.slug === slug) ?? null;
});
const songUrl = (slug: string) => `/c/${encodeURIComponent(props.choir)}/${encodeURIComponent(slug)}`;
</script>

<template>
  <RefusedView v-if="refused" :status="refused" :email="me?.email" />
  <main v-else class="page songlist">
    <header class="bar">
      <a href="/" class="home-link">Stemmanauhat</a>
      <h1>{{ choirName }}</h1>
    </header>
    <a v-if="last" class="button primary continue" :href="songUrl(last.slug)">Jatka siitä: {{ last.title }}</a>
    <input v-model="query" class="search" type="search" placeholder="Hae kappaletta" aria-label="Hae kappaletta" />
    <ul class="songs">
      <li v-for="s in shown" :key="s.slug">
        <a :href="songUrl(s.slug)">{{ s.title }}</a>
        <span v-if="newest.has(s.slug)" class="badge">Uusi</span>
      </li>
    </ul>
    <p v-if="!songs.length" class="hint">Ei vielä kappaleita.</p>
    <footer class="row">
      <a v-if="me?.admin" href="/admin">Ylläpito</a>
      <form v-if="me?.email || me?.linked.length" method="post" action="/auth/logout">
        <button type="submit" class="link">Kirjaudu ulos</button>
      </form>
    </footer>
  </main>
</template>
