<script setup lang="ts">
import Icon from "../components/Icon.vue";
import { computed, onMounted, ref } from "vue";
import { getJson, type Me, type SongSummary } from "../api";

const me = ref<Me | null>(null);
const openSongs = ref<SongSummary[]>([]);
// A visitor with no choir of their own gets the open songs first; sign-in comes after.
const signedOut = computed(() => !!me.value && !me.value.email && !me.value.linked.length);
const openChoir = computed(() => me.value?.choirs.find((c) => c.public) ?? null);

onMounted(async () => {
  me.value = await getJson<Me>("/api/me");
  if (signedOut.value && openChoir.value) {
    const data = await getJson<{ songs: SongSummary[] }>(`/api/songs?choir=${encodeURIComponent(openChoir.value.id)}`);
    openSongs.value = data.songs.sort((a, b) => a.title.localeCompare(b.title, "fi"));
  }
});
const songUrl = (slug: string) => `/c/${encodeURIComponent(openChoir.value!.id)}/${encodeURIComponent(slug)}`;
</script>

<template>
  <main class="page narrow home">
    <div class="brand"><Icon name="note" :size="34" /></div>
    <h1>Stemmanauhat</h1>
    <template v-if="me && signedOut">
      <template v-if="openChoir">
        <h2>{{ openChoir.name }}</h2>
        <p class="hint">Tekijänoikeusvapaita kuorolauluja kaikille. Valitse laulu ja harjoittele omaa stemmaasi.</p>
        <ul class="songs open-songs">
          <li v-for="s in openSongs" :key="s.slug"><a :href="songUrl(s.slug)">{{ s.title }}</a></li>
        </ul>
      </template>
      <section class="members">
        <p class="hint">Kuoron jäsen? Kirjaudu, niin näet oman kuorosi laulut.</p>
        <a class="button primary" href="/auth/login?next=/">Kirjaudu Google-tilillä</a>
      </section>
    </template>
    <template v-else-if="me">
      <p v-if="me.email" class="hint">Kirjautuneena: {{ me.email }}</p>
      <ul class="choirs">
        <li v-for="c in me.choirs" :key="c.id"><a class="button" :href="`/c/${c.id}`">{{ c.name }}</a></li>
      </ul>
      <p v-if="me.admin"><a href="/admin">Ylläpito</a></p>
      <form method="post" action="/auth/logout">
        <button type="submit">Kirjaudu ulos</button>
      </form>
    </template>
  </main>
</template>
