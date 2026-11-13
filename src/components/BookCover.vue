<script setup lang="ts">
import type { BookRecord } from '../shared/types'
import Icon from './Icon.vue'
defineProps<{ book: BookRecord; compact?: boolean }>()
const labels = ['山色', '余白', '微光', '远行', '静读']
</script>

<template>
  <div class="book-cover" :class="[`tone-${book.tone}`, { compact }]">
    <div class="cover-spine"></div>
    <div class="cover-top">
      <span>QUIETLEAF</span>
      <Icon name="leaf" :size="16" />
    </div>
    <div class="cover-content">
      <span class="cover-kicker">
        {{ book.sample ? '隐页 · 示例读物' : `${book.format.toUpperCase()} · 本地藏书` }}
      </span>
      <strong>{{ book.title }}</strong>
      <i></i>
      <span class="cover-author">{{ book.author }}</span>
    </div>
    <div class="cover-bottom">
      <span>{{ labels[book.tone] }}</span>
      <span>READ AT YOUR PACE</span>
    </div>
    <div class="cover-art">
      <div></div>
      <div></div>
      <div></div>
    </div>
  </div>
</template>
