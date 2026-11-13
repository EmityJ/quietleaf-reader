<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ePub from 'epubjs'
import type Book from 'epubjs/types/book'
import type Rendition from 'epubjs/types/rendition'
import type { BookContent, ReaderSettings, ReadingProgress } from '../shared/types'
import Icon from './Icon.vue'
import { restrictEpubDocument } from '../shared/epub-security'

const props = defineProps<{ content: BookContent; settings: ReaderSettings; floating: boolean }>()
const emit = defineEmits<{
  progress: [progress: ReadingProgress]
  error: [message: string]
  ready: []
  resetOpacity: []
}>()
const chapterIndex = ref(
  Math.max(
    0,
    Math.min(
      props.content.book.progress.chapterIndex ?? 0,
      (props.content.book.chapters?.length ?? 1) - 1,
    ),
  ),
)
const text = ref('')
const loading = ref(true)
const tocOpen = ref(false)
const scrollArea = ref<HTMLElement>()
const epubArea = ref<HTMLElement>()
const epubToc = ref<{ label: string; href: string; depth: number }[]>([])
const currentTitle = ref('')
const percent = ref(props.content.book.progress.percent)
const search = ref('')
const matches = ref<number[]>([])
const matchIndex = ref(-1)
let book: Book | undefined
let rendition: Rendition | undefined
let observer: ResizeObserver | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let lastProgress: ReadingProgress | undefined
let disposed = false
let loadGeneration = 0
let restoring = false
const epubIndex = ref(0)
const epubCount = ref(1)
const isTxt = computed(() => props.content.book.format === 'txt')
const paragraphs = computed(() => {
  const lines = text.value.split(/\n/)
  return (lines[0]?.trim() === chapterTitle.value ? lines.slice(1) : lines).filter((line) =>
    line.trim(),
  )
})
const chapterTitle = computed(() =>
  isTxt.value
    ? props.content.book.chapters?.[chapterIndex.value]?.title || '正文'
    : currentTitle.value || props.content.book.title,
)
const chapterPosition = computed(() =>
  isTxt.value
    ? `${chapterIndex.value + 1} / ${props.content.book.chapters?.length || 1}`
    : `${epubIndex.value + 1} / ${epubCount.value}`,
)
const style = computed(() => ({
  fontSize: `${props.settings.fontSize}px`,
  lineHeight: props.settings.lineHeight,
  fontFamily:
    props.settings.fontFamily === 'serif'
      ? "'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', serif"
      : "'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif",
}))
const textOpacity = computed(() =>
  props.floating && props.settings.transparencyMode === 'background'
    ? props.settings.textOpacity
    : 1,
)

function save(progress: ReadingProgress) {
  percent.value = progress.percent
  lastProgress = progress
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 350)
}
function flush() {
  clearTimeout(saveTimer)
  if (lastProgress) {
    emit('progress', lastProgress)
    lastProgress = undefined
  }
}

function onScroll() {
  if (!isTxt.value || loading.value || restoring || !scrollArea.value) return
  const element = scrollArea.value
  const fraction =
    element.scrollHeight <= element.clientHeight + 2
      ? 1
      : Math.min(1, element.scrollTop / (element.scrollHeight - element.clientHeight))
  const chapter = props.content.book.chapters![chapterIndex.value]
  save({
    chapterIndex: chapterIndex.value,
    fraction,
    percent:
      ((chapter.start + (chapter.end - chapter.start) * fraction) /
        (props.content.book.textBytes || 1)) *
      100,
  })
}

async function loadChapter(index: number, fraction = 0) {
  const chapters = props.content.book.chapters || []
  if (index < 0 || index >= chapters.length) return
  const generation = ++loadGeneration
  loading.value = true
  search.value = ''
  matches.value = []
  try {
    const result = await window.reader.readChapter(props.content.book.id, index)
    if (disposed || generation !== loadGeneration) return
    chapterIndex.value = index
    text.value = result
    await nextTick()
    const element = scrollArea.value!
    restoring = true
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight) * fraction
    requestAnimationFrame(() => {
      restoring = false
    })
    save({
      chapterIndex: index,
      fraction,
      percent:
        ((chapters[index].start + (chapters[index].end - chapters[index].start) * fraction) /
          (props.content.book.textBytes || 1)) *
        100,
    })
    loading.value = false
    emit('ready')
  } catch (error) {
    loading.value = false
    emit('error', String(error))
  }
}

function applyEpubTheme() {
  if (!rendition) return
  const color =
    props.settings.theme === 'night'
      ? '#dce1d5'
      : props.floating && props.settings.transparencyMode === 'background'
        ? '#1d261e'
        : '#354238'
  rendition.themes.default({
    body: {
      color: `${color} !important`,
      background: 'transparent !important',
      'font-size': `${props.settings.fontSize}px !important`,
      'font-family': `${props.settings.fontFamily === 'serif' ? 'serif' : 'sans-serif'} !important`,
      'line-height': `${props.settings.lineHeight} !important`,
      padding: '0 !important',
    },
    html: { background: 'transparent !important' },
    '*': { 'background-color': 'transparent !important' },
    p: { 'line-height': `${props.settings.lineHeight} !important` },
    img: { 'max-width': '100% !important', height: 'auto' },
    a: { color: '#718a63 !important' },
  })
}

async function loadEpub() {
  try {
    const bytes = props.content.bytes
    if (!bytes) throw new Error('未能读取 EPUB 内容。')
    book = ePub(bytes.slice().buffer as ArrayBuffer, { replacements: 'blobUrl' })
    book.spine.hooks.content.register(restrictEpubDocument)
    await book.ready
    if (disposed) return
    const flatten = (items: any[], depth = 0): typeof epubToc.value =>
      items.flatMap((item) => [
        { label: String(item.label).trim(), href: item.href, depth },
        ...flatten(item.subitems || [], depth + 1),
      ])
    epubToc.value = flatten(book.navigation.toc)
    epubCount.value = Math.max(
      1,
      (book.spine as unknown as { spineItems: unknown[] }).spineItems.length,
    )
    rendition = book.renderTo(epubArea.value!, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      allowScriptedContent: false,
    })
    applyEpubTheme()
    rendition.on('relocated', (location: any) => {
      if (disposed) return
      epubIndex.value = location.start.index || 0
      const item = epubToc.value.find((entry) => entry.href.split('#')[0] === location.start.href)
      currentTitle.value = item?.label || props.content.book.title
      const displayed = location.start.displayed
      const sectionProgress = displayed?.total ? (displayed.page - 1) / displayed.total : 0
      save({
        cfi: location.start.cfi,
        percent: location.atEnd
          ? 100
          : Math.min(99.9, ((epubIndex.value + sectionProgress) / epubCount.value) * 100),
      })
    })
    rendition.on('displayError', () =>
      emit('error', '这本 EPUB 无法显示。可能包含加密内容或不受支持的排版。'),
    )
    rendition.on('keydown', (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Digit0') {
        event.preventDefault()
        emit('resetOpacity')
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        void next()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        void previous()
      }
      if (event.key === 'Escape') {
        tocOpen.value = false
      }
    })
    try {
      await rendition.display(props.content.book.progress.cfi || undefined)
    } catch {
      await rendition.display()
      emit('error', '原阅读位置已失效，已回到开篇。')
    }
    loading.value = false
    observer = new ResizeObserver(() => {
      if (!disposed && rendition && epubArea.value)
        rendition.resize(epubArea.value.clientWidth, epubArea.value.clientHeight)
    })
    observer.observe(epubArea.value!)
    emit('ready')
  } catch (error) {
    if (!disposed) {
      loading.value = false
      emit('error', `打开 EPUB 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function previous() {
  if (isTxt.value) await loadChapter(chapterIndex.value - 1)
  else
    try {
      await rendition?.prev()
    } catch {
      emit('error', '已到达本书开篇。')
    }
}
async function next() {
  if (isTxt.value) {
    if (chapterIndex.value >= (props.content.book.chapters?.length || 1) - 1) {
      if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
      save({ chapterIndex: chapterIndex.value, fraction: 1, percent: 100 })
      flush()
    } else await loadChapter(chapterIndex.value + 1)
  } else
    try {
      await rendition?.next()
    } catch {
      emit('error', '已到达本书末尾。')
    }
}
async function jump(target: string | number) {
  tocOpen.value = false
  if (typeof target === 'number') await loadChapter(target)
  else
    try {
      await rendition?.display(target)
    } catch {
      emit('error', '无法跳转到这一章节。')
    }
}

function findNext() {
  const needle = search.value.trim()
  if (!needle) return
  if (!matches.value.length) {
    matches.value = paragraphs.value
      .map((paragraph, index) => (paragraph.includes(needle) ? index : -1))
      .filter((index) => index >= 0)
  }
  if (!matches.value.length) {
    emit('error', '当前章节没有找到这段文字。')
    return
  }
  matchIndex.value = (matchIndex.value + 1) % matches.value.length
  scrollArea.value
    ?.querySelector(`[data-paragraph="${matches.value[matchIndex.value]}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

watch(search, () => {
  matches.value = []
  matchIndex.value = -1
})
watch(
  () => [
    props.settings.fontSize,
    props.settings.lineHeight,
    props.settings.fontFamily,
    props.settings.theme,
    props.settings.transparencyMode,
    props.floating,
  ],
  async () => {
    if (isTxt.value) {
      const element = scrollArea.value
      if (!element) return
      const fraction = Math.max(
        0,
        element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
      )
      restoring = true
      await nextTick()
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight) * fraction
      requestAnimationFrame(() => {
        restoring = false
      })
    } else applyEpubTheme()
  },
  { flush: 'pre' },
)

function onKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.closest('input, select, textarea')) return
  if (event.key === 'ArrowRight') void next()
  if (event.key === 'ArrowLeft') void previous()
  if (event.key === 'Escape') tocOpen.value = false
}
function onVisibility() {
  if (document.hidden) flush()
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  if (isTxt.value) void loadChapter(chapterIndex.value, props.content.book.progress.fraction ?? 0)
  else void loadEpub()
})
onBeforeUnmount(() => {
  disposed = true
  loadGeneration++
  flush()
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
  book?.destroy()
})
defineExpose({ flush })
</script>

<template>
  <div class="reader" :class="{ floating }">
    <div class="reader-tools">
      <button class="text-button" @click="tocOpen = !tocOpen" :aria-expanded="tocOpen">
        <Icon name="menu" :size="17" />
        目录
      </button>
      <span class="reader-chapter-title">{{ chapterTitle }}</span>
      <span class="reader-format">{{ content.book.format.toUpperCase() }}</span>
    </div>
    <div v-if="tocOpen" class="toc-panel" aria-label="章节目录">
      <div class="toc-heading">
        章节目录
        <button class="icon-button" aria-label="关闭目录" @click="tocOpen = false">
          <Icon name="close" :size="16" />
        </button>
      </div>
      <div class="toc-list">
        <template v-if="isTxt">
          <button
            v-for="(chapter, index) in content.book.chapters"
            :key="chapter.id"
            :class="{ active: chapterIndex === index }"
            @click="jump(index)"
          >
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            {{ chapter.title }}
          </button>
        </template>
        <template v-else>
          <button
            v-for="(item, index) in epubToc"
            :key="index"
            :style="{ paddingLeft: `${16 + item.depth * 14}px` }"
            @click="jump(item.href)"
          >
            {{ item.label }}
          </button>
          <p v-if="!epubToc.length" class="empty-hint">这本书没有提供目录。</p>
        </template>
      </div>
    </div>
    <div class="reader-body">
      <div v-if="loading" class="reader-loading">
        <span class="spinner"></span>
        正在翻开这一页…
      </div>
      <div
        v-if="isTxt"
        ref="scrollArea"
        class="text-scroll"
        data-testid="text-scroll"
        @scroll.passive="onScroll"
      >
        <article class="text-article" :style="{ ...style, opacity: textOpacity }">
          <div class="chapter-eyebrow">CHAPTER {{ String(chapterIndex + 1).padStart(2, '0') }}</div>
          <h1>{{ chapterTitle }}</h1>
          <p
            v-for="(paragraph, index) in paragraphs"
            :key="index"
            :data-paragraph="index"
            :class="{ 'search-match': search.trim() && paragraph.includes(search.trim()) }"
          >
            {{ paragraph || '\u00a0' }}
          </p>
          <div class="chapter-end">· · ·</div>
        </article>
      </div>
      <div v-else ref="epubArea" class="epub-area" :style="{ opacity: textOpacity }"></div>
    </div>
    <form v-if="isTxt && !floating" class="chapter-search" @submit.prevent="findNext">
      <Icon name="search" :size="15" />
      <input v-model="search" aria-label="查找当前章节" placeholder="在当前章节中查找…" />
      <span v-if="matches.length">{{ matchIndex + 1 }}/{{ matches.length }}</span>
      <button type="submit" class="text-button">查找</button>
    </form>
    <div class="reader-footer">
      <button
        class="text-button"
        aria-label="上一章或上一页"
        @click="previous"
        :disabled="isTxt && chapterIndex === 0"
      >
        <Icon name="back" :size="17" />
        <span>{{ isTxt ? '上一章' : '上一页' }}</span>
      </button>
      <div class="reading-position">
        <span>{{ Math.round(percent) }}%</span>
        <i>·</i>
        <span>{{ chapterPosition }}</span>
      </div>
      <button
        class="text-button"
        :aria-label="
          isTxt && chapterIndex === (content.book.chapters?.length || 1) - 1
            ? '标记读完'
            : '下一章或下一页'
        "
        @click="next"
        :disabled="
          isTxt && chapterIndex === (content.book.chapters?.length || 1) - 1 && percent >= 100
        "
      >
        <span>
          {{
            isTxt
              ? chapterIndex === (content.book.chapters?.length || 1) - 1
                ? percent >= 100
                  ? '已读完'
                  : '标记读完'
                : '下一章'
              : '下一页'
          }}
        </span>
        <Icon
          :name="
            isTxt && chapterIndex === (content.book.chapters?.length || 1) - 1 ? 'check' : 'arrow'
          "
          :size="17"
        />
      </button>
    </div>
  </div>
</template>
