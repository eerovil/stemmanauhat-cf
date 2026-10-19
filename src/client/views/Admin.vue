<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { getJson, postJson, problemLabels, Refused, type MixMode } from "../api";
import { gainOf } from "../player/mix";
import RefusedView from "./Refused.vue";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import { day, sortLocale, t, words } from "../i18n";

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

/** One choir's last 30 days, in people (eeron-omat-taskit#72). */
interface Usage {
  id: string;
  name: string;
  people: number;
  songOpens: number;
  settingsOpens: number;
  choseSung: number;
  playedSung: number;
  playedSungMinute: number;
  sawInstall: number;
  installed: number;
}

type SettingName = "mode" | "others" | "rate" | "staves" | "zoom" | "sound";
interface SettingUse {
  setting: SettingName;
  default: string;
  changedBy: number;
  /** The share of listening time at the default, 0–1; null with no listens yet. */
  defaultShare: number | null;
  topOther: string | null;
}

interface Listen {
  at: string;
  choir: string;
  email: string | null;
  admin: boolean;
  song: string | null;
  title: string | null;
  part: string | null;
  value: "piano" | "sung";
  seconds: number;
}

const choirs = ref<AdminChoir[]>([]);
const usage = ref<Usage[]>([]);
const settingsUse = ref<SettingUse[]>([]);
const listens = ref<Listen[]>([]);
const admins = ref<string[]>([]);
const refused = ref<number | null>(null);
const toAdd = reactive<Record<string, string>>({});
const message = reactive<Record<string, string>>({});

async function load() {
  try {
    const data = await getJson<{ choirs: AdminChoir[]; admins: string[]; usage: Usage[]; settings: SettingUse[];
      listens: Listen[] }>("/api/admin");
    choirs.value = data.choirs;
    admins.value = data.admins;
    usage.value = data.usage;
    settingsUse.value = data.settings;
    listens.value = data.listens;
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

const USAGE_LINES = [
  ["usagePeople", "people"], ["usageSongOpens", "songOpens"], ["usageSettingsOpens", "settingsOpens"],
  ["usageChoseSung", "choseSung"], ["usagePlayedSung", "playedSung"], ["usagePlayedSungMinute", "playedSungMinute"],
  ["usageSawInstall", "sawInstall"], ["usageInstalled", "installed"],
] as const;
const SETTING_LABELS = { mode: "listening", others: "otherParts", rate: "tempo", staves: "staves", zoom: "scoreSize", sound: "sound" } as const;
/** A setting's value as Säädöt shows it. */
function settingText(setting: SettingName, value: string): string {
  const w = t.value;
  const n = Number(value);
  switch (setting) {
    case "mode": return w.modes[value as MixMode]?.label ?? value;
    case "others": return `${Math.round(gainOf(n) * 100)} %`;
    case "rate": case "zoom": return `${Math.round(n * 100)} %`;
    case "staves": return value === "own" ? w.ownStaff : w.allStaves;
    case "sound": return value === "sung" ? w.sung : w.piano;
  }
}
function settingLine(s: SettingUse): string {
  const w = t.value;
  return [
    w.settingDefault(settingText(s.setting, s.default)),
    w.settingChangedBy(s.changedBy),
    s.defaultShare === null ? "" : w.settingAtDefault(Math.round(s.defaultShare * 100)),
    s.topOther === null ? "" : w.settingTopOther(settingText(s.setting, s.topOther)),
  ].filter(Boolean).join(" · ");
}
const when = (at: string) => new Date(at).toLocaleString(sortLocale(), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
function listenLine(l: Listen): string {
  const w = t.value;
  return [
    l.email ?? w.noAccount, l.title ?? l.song ?? "", l.part ?? "", l.value === "sung" ? w.sung : w.piano,
    w.listenLength(Math.floor(l.seconds / 60), l.seconds % 60), when(l.at),
  ].filter(Boolean).join(" · ") + (l.admin ? ` ${w.adminMark}` : "");
}
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
    <section class="card usage">
      <h2>{{ t.usageHeading }}</h2>
      <p class="hint">{{ t.usageHint }}</p>
      <p v-if="!usage.length" class="hint">{{ t.noUsage }}</p>
      <div v-for="u in usage" :key="u.id" :data-usage="u.id">
        <p class="usage-choir">{{ u.name }}</p>
        <ul class="usage-lines">
          <li v-for="[label, key] in USAGE_LINES" :key="key" :data-line="key"><span>{{ t[label] }}</span><b>{{ u[key] }}</b></li>
        </ul>
      </div>
      <details class="settings-use">
        <summary>{{ t.settingsUseHeading }}</summary>
        <p class="hint">{{ t.settingsUseHint }}</p>
        <ul>
          <li v-for="s in settingsUse" :key="s.setting" :data-setting="s.setting">
            <strong>{{ t[SETTING_LABELS[s.setting]] }}</strong> · {{ settingLine(s) }}
          </li>
        </ul>
      </details>
      <details class="latest-listens">
        <summary>{{ t.latestListens }}</summary>
        <p v-if="!listens.length" class="hint">{{ t.noListens }}</p>
        <ul>
          <li v-for="(l, i) in listens" :key="i">{{ listenLine(l) }}</li>
        </ul>
      </details>
    </section>
    <section class="card">
      <h2>{{ t.admins }}</h2>
      <ul><li v-for="a in admins" :key="a">{{ a }}</li></ul>
      <p class="hint">{{ t.addAdminBefore }} <code>scripts/add-admin.sh</code>.</p>
    </section>
  </main>
</template>
