<script setup lang="ts">
const props = defineProps<{ status: number; email?: string | null }>();
const here = location.pathname;
</script>

<template>
  <main class="page narrow refused">
    <h1>Stemmanauhat</h1>
    <template v-if="props.status === 404">
      <p>Tätä sivua ei löytynyt.</p>
      <p><a href="/">Etusivulle</a></p>
    </template>
    <template v-else>
      <p v-if="props.email">Tilillä <strong>{{ props.email }}</strong> ei ole pääsyä tähän kuoroon.</p>
      <p v-else>Sinulla ei ole pääsyä tähän kuoroon.</p>
      <p class="hint">Jos kuulut kuoroon, pyydä kuoron yhteyshenkilöä lisäämään sähköpostiosoitteesi.</p>
      <div class="row">
        <a class="button primary" :href="`/auth/login?next=${encodeURIComponent(here)}`">Käytä toista tiliä</a>
        <form method="post" action="/auth/logout"><button type="submit">Kirjaudu ulos</button></form>
      </div>
    </template>
  </main>
</template>
