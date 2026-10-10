<script setup lang="ts">
import Icon from "../components/Icon.vue";
const params = new URLSearchParams(location.search);
const next = params.get("next") ?? "/";
const failed = params.get("error") === "failed";
</script>

<template>
  <main class="page narrow signin">
    <div class="brand"><Icon name="note" :size="34" /></div>
    <h1>Stemmanauhat</h1>
    <p>Kuorojen harjoitusnauhat: nuotti ja oma stemma.</p>
    <p v-if="failed" class="error">Kirjautuminen ei onnistunut. Yritä uudelleen.</p>
    <a class="button primary" :href="`/auth/login?next=${encodeURIComponent(next)}`">Kirjaudu Google-tilillä</a>
    <p class="hint">Kuoron vanha linkki toimii edelleen ilman Google-tiliä.</p>
    <p><a href="/c/public">Kokeile esittelykappaleita</a></p>
  </main>
</template>
