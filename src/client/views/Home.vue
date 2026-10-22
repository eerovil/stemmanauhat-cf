<script setup lang="ts">
import Icon from "../components/Icon.vue";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import SiteCredit from "../components/SiteCredit.vue";
import { byTitle, t } from "../i18n";
import { computed, onMounted, ref } from "vue";
import { getJson, hasSungParts, listCredits, type Me, type SongSummary } from "../api";

const me = ref<Me | null>(null);
const openSongs = ref<SongSummary[]>([]);
// A visitor with no choir of their own gets the open songs first; sign-in comes after.
const signedOut = computed(() => !!me.value && !me.value.email && !me.value.linked.length);
const openChoir = computed(() => me.value?.choirs.find((c) => c.public) ?? null);

onMounted(async () => {
  me.value = await getJson<Me>("/api/me");
  if (signedOut.value && openChoir.value) {
    const data = await getJson<{ songs: SongSummary[] }>(`/api/songs?choir=${encodeURIComponent(openChoir.value.id)}`);
    openSongs.value = data.songs.sort(byTitle);
  }
});
const songUrl = (slug: string) => `/c/${encodeURIComponent(openChoir.value!.id)}/${encodeURIComponent(slug)}`;
</script>

<template>
  <main class="page narrow home">
    <div class="brand"><Icon name="note" :size="34" /></div>
    <h1>{{ t.siteName }}</h1>
    <template v-if="me && signedOut">
      <template v-if="openChoir">
        <h2>{{ openChoir.name }}</h2>
        <p class="hint">{{ t.homeOpenHint }}</p>
        <ul class="songs open-songs">
          <li v-for="s in openSongs" :key="s.slug"><a :href="songUrl(s.slug)"><span class="song-title">{{ s.title }}<span v-if="hasSungParts(s.parts)" class="sung-mark" role="img" :aria-label="t.sungVersion" :title="t.sungVersion"><Icon name="voice" :size="15" /></span></span>
            <span class="credits">{{ listCredits(s) }}</span></a></li>
        </ul>
      </template>
      <section class="members">
        <p class="hint">{{ t.homeMembersHint }}</p>
        <a class="button primary" href="/auth/login?next=/">{{ t.signInGoogle }}</a>
      </section>
    </template>
    <template v-else-if="me">
      <p v-if="me.email" class="hint">{{ t.signedInAs(me.email) }}</p>
      <ul class="choirs">
        <li v-for="c in me.choirs" :key="c.id"><a class="button" :href="`/c/${c.id}`">{{ c.name }}</a></li>
      </ul>
      <p v-if="me.admin"><a href="/admin">{{ t.admin }}</a></p>
      <form method="post" action="/auth/logout">
        <button type="submit">{{ t.signOut }}</button>
      </form>
    </template>
    <LanguageSwitch />
    <SiteCredit />
  </main>
</template>
