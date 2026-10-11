<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { getJson, postJson, Refused } from "../api";
import RefusedView from "./Refused.vue";

interface AdminChoir {
  id: string;
  name: string;
  members: { email: string; added_at: string }[];
  link: boolean;
  /** The join link, or null when the link was set by passphrase and cannot be shown. */
  url: string | null;
  /** Singers' requests for new practice tracks (#38), newest first. */
  requests: AdminRequest[];
}

interface AdminRequest {
  id: number;
  title: string | null;
  credits: string | null;
  note: string | null;
  /** Google email, or the name someone who came by link typed; null if neither. */
  requester: string | null;
  pdf: boolean;
  done_at: string | null;
  created_at: string;
}

const choirs = ref<AdminChoir[]>([]);
const admins = ref<string[]>([]);
const refused = ref<number | null>(null);
const toAdd = reactive<Record<string, string>>({});
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
const renewLink = (choir: string, had: boolean) => run(choir, async () => {
  if (had && !confirm("Tehdäänkö uusi linkki? Vanha linkki lakkaa toimimaan.")) return "";
  await postJson("/api/admin/link", { choir, renew: true });
  return had ? "Uusi linkki tehty. Vanhalla linkillä tulleet on kirjattu ulos." : "Linkki tehty.";
});
const copy = (choir: string, url: string) => run(choir, async () => {
  await navigator.clipboard.writeText(url);
  return "Linkki kopioitu.";
});
const linkOff = (choir: string) => run(choir, async () => {
  if (!confirm("Poistetaanko linkillä kirjautuminen tästä kuorosta?")) return "";
  await postJson("/api/admin/link", { choir, off: true });
  return "Linkillä kirjautuminen on pois päältä.";
});
const markDone = (choir: string, r: AdminRequest) => run(choir, async () => {
  await postJson("/api/admin/requests", { id: r.id, done: true });
  return `Merkitty tehdyksi: ${r.title ?? "Nuotti (PDF)"}.`;
});
const removeRequest = (choir: string, r: AdminRequest) => run(choir, async () => {
  if (!confirm(`Poistetaanko pyyntö ${r.title ?? "Nuotti (PDF)"}?`)) return "";
  await postJson("/api/admin/requests", { id: r.id, delete: true });
  return "Pyyntö poistettu.";
});
const day = (at: string) => new Date(at).toLocaleDateString("fi-FI");
const open = (c: AdminChoir) => c.requests.filter((r) => !r.done_at);
const done = (c: AdminChoir) => c.requests.filter((r) => r.done_at);
</script>

<template>
  <RefusedView v-if="refused" :status="refused" />
  <main v-else class="page admin">
    <header class="bar"><a href="/" class="home-link">Stemmanauhat</a><h1>Ylläpito</h1></header>
    <section v-for="c in choirs" :key="c.id" class="card" :data-choir="c.id">
      <h2>{{ c.name }}</h2>
      <p v-if="message[c.id]" class="hint">{{ message[c.id] }}</p>

      <h3>Pyynnöt ({{ open(c).length }})</h3>
      <p v-if="!c.requests.length" class="hint">Ei pyyntöjä.</p>
      <ul class="request-list">
        <li v-for="r in [...open(c), ...done(c)]" :key="r.id" :class="{ done: r.done_at }">
          <strong>{{ r.title ?? "Nuotti (PDF)" }}</strong>
          <span v-if="r.credits"> · {{ r.credits }}</span>
          <p v-if="r.note" class="hint">{{ r.note }}</p>
          <div class="row">
            <span class="hint">{{ r.requester ?? "Linkillä tullut" }}, {{ day(r.created_at) }}{{ r.done_at ? ` · tehty ${day(r.done_at)}` : "" }}</span>
            <span class="row">
              <a v-if="r.pdf" :href="`/api/admin/requests/${r.id}/pdf`" target="_blank" rel="noopener">PDF</a>
              <button v-if="!r.done_at" type="button" @click="markDone(c.id, r)">Tehty</button>
              <button type="button" class="link" @click="removeRequest(c.id, r)">Poista</button>
            </span>
          </div>
        </li>
      </ul>

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

      <h3>Kuoron linkki</h3>
      <p class="hint">Linkillä pääsee kappaleisiin heti, ja Google-tilin voi lisätä jäseneksi samalla.</p>
      <p v-if="c.url" class="row">
        <input :value="c.url" type="text" readonly :aria-label="`Linkki: ${c.name}`" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" @click="copy(c.id, c.url)">Kopioi</button>
      </p>
      <p v-else-if="c.link" class="hint">Vanha linkki on käytössä, mutta sitä ei voi näyttää. Tee uusi, jos haluat jakaa linkin täältä.</p>
      <p v-else class="hint">Linkillä kirjautuminen on pois päältä.</p>
      <div class="row">
        <button type="button" @click="renewLink(c.id, c.link)">{{ c.link ? "Tee uusi linkki" : "Tee linkki" }}</button>
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
