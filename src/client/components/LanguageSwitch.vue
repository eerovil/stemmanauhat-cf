<script setup lang="ts">
// The EN | FI switch: the choice is remembered on this device.
import { lang, LANGS, setLang, t } from "../i18n";
</script>

<template>
  <div class="segmented two language" role="group" :aria-label="t.language">
    <button v-for="l in LANGS" :key="l" type="button" :class="{ on: lang === l }" :aria-pressed="lang === l"
      @click="setLang(l)">{{ l.toUpperCase() }}</button>
  </div>
</template>
