<script setup lang="ts">
// Small stroke icons (24 px grid), drawn inline so no icon font is downloaded.
const props = defineProps<{ name: string; size?: number }>();
const PATHS: Record<string, string[]> = {
  play: ["M8 5.5v13l11-6.5z"],
  pause: ["M8 5v14", "M16 5v14"],
  back5: ["M3 12a9 9 0 1 0 2.6-6.4", "M3 4v5h5"],
  loop: ["M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  zoomIn: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-5-5", "M11 8v6", "M8 11h6"],
  zoomOut: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-5-5", "M8 11h6"],
  scroll: ["M3 12h18", "M17 8l4 4-4 4", "M7 8l-4 4 4 4"],
  tap: ["M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"],
  pages: ["M4 5h16", "M4 9h16", "M4 15h16", "M4 19h16"],
  staves: ["M3 5h18", "M3 9h18", "M3 15h12", "M3 19h12", "M18 16l3 3", "M21 16l-3 3"],
  solo: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 21a8 8 0 0 1 16 0"],
  others: ["M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M1 21a8 8 0 0 1 16 0", "M17 4.5a4 4 0 0 1 0 7", "M23 21a8 8 0 0 0-4-6.9"],
  tempo: ["M3.5 18a9 9 0 1 1 17 0", "M12 15l4.5-5"],
  more: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  close: ["M18 6L6 18", "M6 6l12 12"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  note: ["M9 18V5l12-2v13", "M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-5-5"],
};
</script>

<template>
  <svg class="icon" :width="props.size ?? 22" :height="props.size ?? 22" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="d in PATHS[props.name] ?? []" :key="d" :d="d"
      :fill="props.name === 'play' ? 'currentColor' : 'none'" />
  </svg>
</template>
