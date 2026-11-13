<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3V4Z',
  shelf: 'M4 4v16M9 5v14M14 4v16M18 5l3 14M3 20h19',
  clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  check: 'm5 12 4 4L19 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  chevron: 'm9 5 7 7-7 7',
  settings: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  float: 'M20 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M13 12h8v8h-8z',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  pin: 'm16 3 5 5-3 1-4 5v3l-3-3-5 5m2-16 5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  hide: 'm3 3 18 18M10 5h2c6 0 10 7 10 7a20 20 0 0 1-4 4M6 6a20 20 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4',
  cursor: 'm4 3 6 17 3-7 7-3L4 3Zm9 10 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  minus: 'M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  leaf: 'M20 3c-7-1-15 1-15 9a7 7 0 0 0 7 7c8 0 9-9 8-16ZM4 21 15 10',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.book" />
  </svg>
</template>
