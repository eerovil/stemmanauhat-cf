<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getJson, type Me } from "../api";

const me = ref<Me | null>(null);
onMounted(async () => { me.value = await getJson<Me>("/api/me"); });
</script>

<template>
  <main class="page narrow home">
    <h1>Stemmanauhat</h1>
    <template v-if="me">
      <p v-if="me.email" class="hint">Kirjautuneena: {{ me.email }}</p>
      <ul class="choirs">
        <li v-for="c in me.choirs" :key="c.id"><a class="button" :href="`/c/${c.id}`">{{ c.name }}</a></li>
      </ul>
      <p v-if="!me.email && !me.linked.length">
        <a class="button primary" href="/auth/login?next=/">Kirjaudu Google-tilillä</a>
      </p>
      <p v-if="me.admin"><a href="/admin">Ylläpito</a></p>
      <form v-if="me.email || me.linked.length" method="post" action="/auth/logout">
        <button type="submit">Kirjaudu ulos</button>
      </form>
    </template>
  </main>
</template>
