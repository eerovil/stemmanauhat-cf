<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { getJson, postJson, Refused } from "../api";
import RefusedView from "./Refused.vue";

interface AdminChoir {
  id: string;
  name: string;
  members: { email: string; added_at: string }[];
  link: boolean;
}

const choirs = ref<AdminChoir[]>([]);
const admins = ref<string[]>([]);
const refused = ref<number | null>(null);
const toAdd = reactive<Record<string, string>>({});
const passphrase = reactive<Record<string, string>>({});
const message = reactive<Record<string, string>>({});

async function load() {
  try {
    const data = await getJson<{ choirs: AdminChoir[]; admins: string[] }>("/api/admin");
    choirs.value = data.choirs;
    admins.value = data.admins;
  } catch (error) {
    if (error instanceof Refused) refused.value = error.status;
    else throw error;
  }
}
onMounted(load);

async function run(choir: string, action: () => Promise<string>) {
  try {
    message[choir] = await action();
    await load();
  } catch (error) {
    message[choir] = (error as Error).message;
  }
}

const add = (choir: string) => run(choir, async () => {
  const r = await postJson<{ added: string[] }>("/api/admin/members", { choir, add: toAdd[choir] ?? "" });
  toAdd[choir] = "";
  return r.added.length ? `Lisätty ${r.added.length}.` : "Ei kelvollisia osoitteita.";
});
const remove = (choir: string, email: string) => run(choir, async () => {
  if (!confirm(`Poistetaanko ${email}?`)) return "";
  await postJson("/api/admin/members", { choir, remove: [email] });
  return `Poistettu ${email}.`;
});
const setLink = (choir: string) => run(choir, async () => {
  await postJson("/api/admin/link", { choir, passphrase: passphrase[choir] ?? "" });
  passphrase[choir] = "";
  return "Salasana vaihdettu. Vanhalla linkillä tulleet on kirjattu ulos.";
});
const linkOff = (choir: string) => run(choir, async () => {
  if (!confirm("Poistetaanko linkillä kirjautuminen tästä kuorosta?")) return "";
  await postJson("/api/admin/link", { choir, off: true });
  return "Linkillä kirjautuminen on pois päältä.";
});
</script>

<template>
  <RefusedView v-if="refused" :status="refused" />
  <main v-else class="page admin">
    <header class="bar"><a href="/" class="home-link">Stemmanauhat</a><h1>Ylläpito</h1></header>
    <section v-for="c in choirs" :key="c.id" class="card" :data-choir="c.id">
      <h2>{{ c.name }}</h2>
      <p v-if="message[c.id]" class="hint">{{ message[c.id] }}</p>

      <h3>Jäsenet ({{ c.members.length }})</h3>
      <textarea v-model="toAdd[c.id]" rows="3" placeholder="Liitä sähköpostiosoitteet, yksi riville"
        :aria-label="`Lisää jäseniä: ${c.name}`"></textarea>
      <button type="button" class="primary" @click="add(c.id)">Lisää</button>
      <ul class="members">
        <li v-for="m in c.members" :key="m.email">
          <span>{{ m.email }}</span>
          <button type="button" class="link" @click="remove(c.id, m.email)">Poista</button>
        </li>
      </ul>

      <h3>Vanha linkki</h3>
      <p class="hint">{{ c.link ? "Linkillä pääsee sisään ilman Google-tiliä." : "Linkillä kirjautuminen on pois päältä." }}</p>
      <div class="row">
        <input v-model="passphrase[c.id]" type="text" autocomplete="off" placeholder="Uusi salasana"
          :aria-label="`Uusi salasana: ${c.name}`" />
        <button type="button" @click="setLink(c.id)">Vaihda</button>
        <button v-if="c.link" type="button" class="link" @click="linkOff(c.id)">Pois päältä</button>
      </div>
    </section>
    <section class="card">
      <h2>Ylläpitäjät</h2>
      <ul><li v-for="a in admins" :key="a">{{ a }}</li></ul>
      <p class="hint">Ylläpitäjän lisää <code>scripts/add-admin.sh</code>.</p>
    </section>
  </main>
</template>
