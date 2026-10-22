<script setup lang="ts">
// Who made the site, and where its source code is (#119).
import { t } from "../i18n";
const SOURCE_URL = "https://github.com/eerovil/stemmanauhat-cf";
</script>

<template>
  <p class="site-credit">{{ t.madeBy }} Eero Vilpponen · <a :href="SOURCE_URL" target="_blank" rel="noopener">{{ t.sourceCode }}</a></p>
</template>
