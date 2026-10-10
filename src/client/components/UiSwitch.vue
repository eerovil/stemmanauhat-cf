<script setup lang="ts">
// PROTOTYPE ONLY: flip between the three designs. Remembered on the device.
import { ui, UIS } from "../ui";
function choose(u: string) {
  localStorage.setItem("stemmanauhat:ui", u);
  location.reload();
}
</script>

<template>
  <div class="ui-switch" role="group" aria-label="Ulkoasu (kokeilu)">
    <button v-for="u in UIS" :key="u" type="button" :class="{ on: u === ui }" @click="choose(u)">{{ u.toUpperCase() }}</button>
  </div>
</template>
