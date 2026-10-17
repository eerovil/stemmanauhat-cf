<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { getJson, postJson, problemLabels, Refused } from "../api";
import RefusedView from "./Refused.vue";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import { day, t, words } from "../i18n";

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
  /** Set when this is a flag on a published song (#41): its slug. */
  song: string | null;
  bar: number | null;
  problems: string[];
  /** The flagger's own part. */
  part: string | null;
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
  return r.added.length ? words().added(r.added.length) : words().noValidAddresses;
});
const remove = (choir: string, email: string) => run(choir, async () => {
  if (!confirm(words().confirmRemove(email))) return "";
  await postJson("/api/admin/members", { choir, remove: [email] });
  return words().removed(email);
});
const renewLink = (choir: string, had: boolean) => run(choir, async () => {
  if (had && !confirm(words().confirmNewLink)) return "";
  await postJson("/api/admin/link", { choir, renew: true });
  return had ? words().newLinkMade : words().linkMade;
});
const copy = (choir: string, url: string) => run(choir, async () => {
  await navigator.clipboard.writeText(url);
  return words().linkCopied;
});
const linkOff = (choir: string) => run(choir, async () => {
  if (!confirm(words().confirmLinkOff)) return "";
  await postJson("/api/admin/link", { choir, off: true });
  return words().linkOff;
});
const markDone = (choir: string, r: AdminRequest) => run(choir, async () => {
  await postJson("/api/admin/requests", { id: r.id, done: true });
  return words().markedDone(r.title ?? words().pdfOnly);
});
const removeRequest = (choir: string, r: AdminRequest) => run(choir, async () => {
  const title = r.title ?? words().pdfOnly;
  if (!confirm(r.song ? words().confirmRemoveFlag(title) : words().confirmRemoveRequest(title))) return "";
  await postJson("/api/admin/requests", { id: r.id, delete: true });
  return r.song ? words().flagRemoved : words().requestRemoved;
});
const open = (c: AdminChoir) => c.requests.filter((r) => !r.done_at);
const done = (c: AdminChoir) => c.requests.filter((r) => r.done_at);
</script>

<template>
  <RefusedView v-if="refused" :status="refused" />
  <main v-else class="page admin">
    <header class="bar"><a href="/" class="home-link">{{ t.siteName }}</a><h1>{{ t.admin }}</h1><LanguageSwitch /></header>
    <section v-for="c in choirs" :key="c.id" class="card" :data-choir="c.id">
      <h2>{{ c.name }}</h2>
      <p v-if="message[c.id]" class="hint">{{ message[c.id] }}</p>

      <h3>{{ t.requestsHeading(open(c).length) }}</h3>
      <p v-if="!c.requests.length" class="hint">{{ t.noRequests }}</p>
      <ul class="request-list">
        <li v-for="r in [...open(c), ...done(c)]" :key="r.id" :class="{ done: r.done_at }">
          <template v-if="r.song">
            <span class="flag-tag">{{ t.flagTag }}</span>
            <a :href="`/c/${encodeURIComponent(c.id)}/${encodeURIComponent(r.song)}`"><strong>{{ r.title }}</strong></a>
            <span class="flag-what">{{ [r.bar ? t.barLower(r.bar) : "", problemLabels(r.problems),
              r.part ? t.partLower(r.part) : ""].filter(Boolean).join(" · ") }}</span>
          </template>
          <template v-else>
            <strong>{{ r.title ?? t.pdfOnly }}</strong>
            <span v-if="r.credits"> · {{ r.credits }}</span>
          </template>
          <p v-if="r.note" class="hint">{{ r.note }}</p>
          <div class="row">
            <span class="hint">{{ r.requester ?? t.viaLink }}, {{ day(r.created_at) }}{{ r.done_at ? t.doneOn(day(r.done_at)) : "" }}</span>
            <span class="row">
              <a v-if="r.pdf" :href="`/api/admin/requests/${r.id}/pdf`" target="_blank" rel="noopener">PDF</a>
              <button v-if="!r.done_at" type="button" @click="markDone(c.id, r)">{{ t.done }}</button>
              <button type="button" class="link" @click="removeRequest(c.id, r)">{{ t.remove }}</button>
            </span>
          </div>
        </li>
      </ul>

      <h3>{{ t.members(c.members.length) }}</h3>
      <textarea v-model="toAdd[c.id]" rows="3" :placeholder="t.pasteEmails"
        :aria-label="t.addMembers(c.name)"></textarea>
      <button type="button" class="primary" @click="add(c.id)">{{ t.add }}</button>
      <ul class="members">
        <li v-for="m in c.members" :key="m.email">
          <span>{{ m.email }}</span>
          <button type="button" class="link" @click="remove(c.id, m.email)">{{ t.remove }}</button>
        </li>
      </ul>

      <h3>{{ t.choirLink }}</h3>
      <p class="hint">{{ t.linkHint }}</p>
      <p v-if="c.url" class="row">
        <input :value="c.url" type="text" readonly :aria-label="t.linkLabel(c.name)" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" @click="copy(c.id, c.url)">{{ t.copy }}</button>
      </p>
      <p v-else-if="c.link" class="hint">{{ t.oldLinkHidden }}</p>
      <p v-else class="hint">{{ t.linkOff }}</p>
      <div class="row">
        <button type="button" @click="renewLink(c.id, c.link)">{{ c.link ? t.newLink : t.makeLink }}</button>
        <button v-if="c.link" type="button" class="link" @click="linkOff(c.id)">{{ t.turnOff }}</button>
      </div>
    </section>
    <section class="card">
      <h2>{{ t.admins }}</h2>
      <ul><li v-for="a in admins" :key="a">{{ a }}</li></ul>
      <p class="hint">{{ t.addAdminBefore }} <code>scripts/add-admin.sh</code>.</p>
    </section>
  </main>
</template>
