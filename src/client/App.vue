<script setup lang="ts">
import UiSwitch from "./components/UiSwitch.vue";
import Admin from "./views/Admin.vue";
import Home from "./views/Home.vue";
import Player from "./views/Player.vue";
import SignIn from "./views/SignIn.vue";
import SongList from "./views/SongList.vue";

// Every page is a full page load, so the Worker's access check runs on each.
const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
</script>

<template>
  <UiSwitch />
  <SignIn v-if="parts[0] === 'signin'" />
  <Admin v-else-if="parts[0] === 'admin'" />
  <Player v-else-if="parts[0] === 'c' && parts.length >= 3" :choir="parts[1]!" :slug="parts[2]!" />
  <SongList v-else-if="parts[0] === 'c' && parts.length === 2" :choir="parts[1]!" />
  <Home v-else />
</template>
