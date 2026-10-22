<script setup lang="ts">
import Icon from "../components/Icon.vue";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import SiteCredit from "../components/SiteCredit.vue";
import { t } from "../i18n";
const params = new URLSearchParams(location.search);
const next = params.get("next") ?? "/";
const failed = params.get("error") === "failed";
</script>

<template>
  <main class="page narrow signin">
    <div class="brand"><Icon name="note" :size="34" /></div>
    <h1>{{ t.siteName }}</h1>
    <p>{{ t.signinLead }}</p>
    <p v-if="failed" class="error">{{ t.signinFailed }}</p>
    <a class="button primary" :href="`/auth/login?next=${encodeURIComponent(next)}`">{{ t.signInGoogle }}</a>
    <p class="hint">{{ t.signinOldLink }}</p>
    <p><a href="/c/public">{{ t.tryDemo }}</a></p>
    <LanguageSwitch />
    <SiteCredit />
  </main>
</template>
