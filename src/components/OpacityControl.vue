<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
defineProps<{
  mode: 'background' | 'window'
  backgroundOpacity: number
  textOpacity: number
  windowOpacity: number
  floating: boolean
}>()
const emit = defineEmits<{
  'update:mode': [value: 'background' | 'window']
  'update:backgroundOpacity': [value: number]
  'update:textOpacity': [value: number]
  'update:windowOpacity': [value: number]
  'open-change': [value: boolean]
  'clear-background': []
  reset: []
}>()
const root = ref<HTMLElement>()
const open = ref(false)
function setOpen(value: boolean) {
  open.value = value
  emit('open-change', value)
}
function closeOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) setOpen(false)
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') setOpen(false)
}
onMounted(() => {
  document.addEventListener('pointerdown', closeOutside)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOutside)
  document.removeEventListener('keydown', onKey)
  emit('open-change', false)
})
</script>
<template>
  <div ref="root" class="opacity-control">
    <button
      class="icon-button"
      :class="{
        selected:
          open || (mode === 'background' ? floating && backgroundOpacity < 1 : windowOpacity < 1),
      }"
      aria-label="调整窗口透明度"
      :aria-expanded="open"
      title="背景与文字透明度"
      @click="setOpen(!open)"
    >
      <Icon name="eye" :size="19" />
    </button>
    <section v-if="open" class="opacity-popover" role="dialog" aria-label="透明度调节">
      <label class="opacity-mode">
        透明方式
        <select
          :value="mode"
          aria-label="透明方式"
          @change="
            emit(
              'update:mode',
              ($event.target as HTMLSelectElement).value as 'background' | 'window',
            )
          "
        >
          <option value="background">背景透明，文字清晰</option>
          <option value="window">整窗一起透明</option>
        </select>
      </label>
      <template v-if="mode === 'background'">
        <label class="opacity-heading" for="background-opacity">
          <span>背景透明度</span>
          <output>{{ Math.round(backgroundOpacity * 100) }}%</output>
        </label>
        <input
          id="background-opacity"
          :value="backgroundOpacity"
          aria-label="背景透明度"
          type="range"
          min="0"
          max="1"
          step="0.01"
          @input="
            emit('update:backgroundOpacity', Number(($event.target as HTMLInputElement).value))
          "
        />
        <div class="opacity-scale">
          <span>0% · 完全透出</span>
          <span>100% · 实色</span>
        </div>
        <label class="opacity-heading" for="text-opacity">
          <span>文字可见度</span>
          <output>{{ Math.round(textOpacity * 100) }}%</output>
        </label>
        <input
          id="text-opacity"
          :value="textOpacity"
          aria-label="文字可见度"
          type="range"
          min="0.2"
          max="1"
          step="0.01"
          @input="emit('update:textOpacity', Number(($event.target as HTMLInputElement).value))"
        />
        <div class="opacity-scale">
          <span>20% · 更淡</span>
          <span>100% · 清晰</span>
        </div>
        <p class="opacity-note">
          {{
            floating
              ? '背景与文字分别调节，底下可放其他窗口。'
              : '进入悬浮阅读后，背景透明效果生效。'
          }}
        </p>
        <button class="text-button opacity-preset" @click="emit('clear-background')">
          背景全透明，文字清晰
        </button>
      </template>
      <template v-else>
        <label class="opacity-heading" for="quick-opacity">
          <span>整窗透明度</span>
          <output>{{ Math.round(windowOpacity * 100) }}%</output>
        </label>
        <input
          id="quick-opacity"
          :value="windowOpacity"
          aria-label="整窗透明度"
          type="range"
          min="0.01"
          max="1"
          step="0.01"
          @input="emit('update:windowOpacity', Number(($event.target as HTMLInputElement).value))"
        />
        <div class="opacity-scale">
          <span>1%</span>
          <span>100%</span>
        </div>
        <p class="opacity-note">文字、背景和工具栏会一起变淡。</p>
      </template>
      <button class="text-button" @click="emit('reset')">恢复不透明</button>
    </section>
  </div>
</template>
