<script setup lang="ts">
import LanguageSwitch from "../components/LanguageSwitch.vue";
import SiteCredit from "../components/SiteCredit.vue";
import { t } from "../i18n";
const props = defineProps<{ status: number; email?: string | null }>();
const here = location.pathname;
</script>

<template>
  <main class="page narrow refused">
    <h1>{{ t.siteName }}</h1>
    <template v-if="props.status === 404">
      <p>{{ t.notFound }}</p>
      <p><a href="/">{{ t.toHome }}</a></p>
    </template>
    <template v-else>
      <p v-if="props.email">{{ t.refusedAccountBefore }} <strong>{{ props.email }}</strong> {{ t.refusedAccountAfter }}</p>
      <p v-else>{{ t.refusedNoAccount }}</p>
      <p class="hint">{{ t.refusedHint }}</p>
      <div class="row">
        <a class="button primary" :href="`/auth/login?next=${encodeURIComponent(here)}`">{{ t.useOtherAccount }}</a>
        <form method="post" action="/auth/logout"><button type="submit">{{ t.signOut }}</button></form>
      </div>
    </template>
    <LanguageSwitch />
    <SiteCredit />
  </main>
</template>
