<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BookCover from './components/BookCover.vue'
import BookReader from './components/BookReader.vue'
import Icon from './components/Icon.vue'
import OpacityControl from './components/OpacityControl.vue'
import packageInfo from '../package.json'
import { effectiveWindowOpacity } from './shared/transparency'
import type {
  BookContent,
  BookRecord,
  LibraryState,
  ReadingProgress,
  ReaderSettings,
  WindowState,
} from './shared/types'

const window = globalThis.window

const library = ref<LibraryState>()
const settings = ref<ReaderSettings>({
  fontSize: 20,
  lineHeight: 1.9,
  fontFamily: 'serif',
  theme: 'paper',
  transparencyMode: 'background',
  backgroundOpacity: 0.12,
  textOpacity: 1,
  windowOpacity: 1,
  autoHide: true,
  hideDelay: 500,
  alwaysOnTop: true,
})
const windowState = ref<WindowState>({
  floating: false,
  concealed: false,
  bossHidden: false,
  shortcutAvailable: true,
  nativeOpacity: false,
  platform: '',
  arch: '',
  session: '',
})
const view = ref<'shelf' | 'recent' | 'finished'>('shelf')
const format = ref('all')
const query = ref('')
const content = ref<BookContent>()
const reader = ref<InstanceType<typeof BookReader>>()
const settingsOpen = ref(false)
const opacityOpen = ref(false)
const removing = ref<BookRecord>()
const busy = ref(false)
const toast = ref('')
const fatal = ref('')
let toastTimer: ReturnType<typeof setTimeout>
let settingsTimer: ReturnType<typeof setTimeout>
let initialized = false
let offWindow: (() => void) | undefined
let offResetOpacity: (() => void) | undefined
const books = computed(() => library.value?.books || [])
const recent = computed(() =>
  books.value
    .filter((book) => book.lastOpenedAt)
    .sort((a, b) => b.lastOpenedAt!.localeCompare(a.lastOpenedAt!)),
)
const finished = computed(() => books.value.filter((book) => book.progress.percent >= 99.5))
const continueBook = computed(() => recent.value[0] || books.value[0])
const filtered = computed(() => {
  let result =
    view.value === 'recent'
      ? recent.value
      : view.value === 'finished'
        ? finished.value
        : books.value
  if (format.value !== 'all') result = result.filter((book) => book.format === format.value)
  const keyword = query.value.trim().toLocaleLowerCase()
  return keyword
    ? result.filter((book) => `${book.title} ${book.author}`.toLocaleLowerCase().includes(keyword))
    : result
})
const pageTitle = computed(
  () => ({ shelf: '我的书架', recent: '最近阅读', finished: '已经读完' })[view.value],
)
const appStyle = computed(() => ({
  // X11 的窗口管理器统一淡化内容与外框；其他平台在页面根层合成。
  opacity:
    windowState.value.floating && windowState.value.concealed
      ? 0
      : windowState.value.nativeOpacity
        ? 1
        : effectiveWindowOpacity(settings.value),
  '--background-opacity': settings.value.backgroundOpacity,
}))

function notify(message: string) {
  toast.value = message.replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/, '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 4500)
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
async function reloadLibrary() {
  library.value = await window.reader.getLibrary()
}

async function importBooks() {
  busy.value = true
  try {
    const result = await window.reader.importBooks()
    await reloadLibrary()
    if (result.errors.length) notify(result.errors.join('\n'))
    else if (result.books.length)
      notify(`已将 ${result.books.length} 本书放入书架，相同文件会自动合并。`)
  } catch (error) {
    notify(errorText(error))
  } finally {
    busy.value = false
  }
}

async function openBook(book: BookRecord) {
  busy.value = true
  try {
    reader.value?.flush()
    content.value = await window.reader.openBook(book.id)
    await reloadLibrary()
  } catch (error) {
    notify(errorText(error))
  } finally {
    busy.value = false
  }
}

async function saveProgress(progress: ReadingProgress) {
  if (!content.value) return
  const id = content.value.book.id
  const localBook = books.value.find((book) => book.id === id)
  if (localBook) localBook.progress = progress
  try {
    await window.reader.saveProgress(id, progress)
  } catch (error) {
    notify(`进度未能保存：${errorText(error)}`)
  }
}

async function backToShelf() {
  reader.value?.flush()
  if (windowState.value.floating) windowState.value = await window.reader.setFloating(false)
  content.value = undefined
  await reloadLibrary()
}

async function toggleFloating() {
  if (!content.value) {
    notify('先打开一本书，再进入悬浮阅读。')
    return
  }
  settingsOpen.value = false
  try {
    windowState.value = await window.reader.setFloating(!windowState.value.floating)
  } catch (error) {
    notify(errorText(error))
  }
}

async function removeBook() {
  if (!removing.value) return
  const id = removing.value.id
  try {
    await window.reader.removeBook(id)
    removing.value = undefined
    await reloadLibrary()
    notify('已从书架移除，原始文件保持不变。')
  } catch (error) {
    notify(errorText(error))
  }
}

function changeView(value: typeof view.value) {
  view.value = value
  query.value = ''
  format.value = 'all'
}
function persistSettings() {
  clearTimeout(settingsTimer)
  if (initialized)
    void window.reader
      .saveSettings({ ...settings.value })
      .catch((error) => notify(`设置未能保存：${errorText(error)}`))
}
function quitApp() {
  reader.value?.flush()
  persistSettings()
  window.reader.quit()
}
function closeToTray() {
  reader.value?.flush()
  persistSettings()
  window.reader.close()
}
async function navigate(value: typeof view.value) {
  await backToShelf()
  changeView(value)
}
function hideNow() {
  reader.value?.flush()
  window.reader.bossHide()
}
function closeSettings() {
  persistSettings()
  settingsOpen.value = false
}
function applyFloating() {
  persistSettings()
  void toggleFloating()
}
function resetOpacity() {
  settings.value.windowOpacity = 1
  settings.value.backgroundOpacity = 1
  settings.value.textOpacity = 1
  persistSettings()
}
function clearBackground() {
  settings.value.transparencyMode = 'background'
  settings.value.backgroundOpacity = 0
  settings.value.textOpacity = 1
  persistSettings()
}
function toggleAutoHide() {
  if (windowState.value.autoHideAvailable === false && !settings.value.autoHide) {
    notify('当前桌面会话无法检测隐藏窗口的鼠标位置，请使用 X11 会话。')
    return
  }
  settings.value.autoHide = !settings.value.autoHide
  persistSettings()
}
watch(
  () => effectiveWindowOpacity(settings.value),
  (value) => {
    if (initialized) window.reader.previewWindowOpacity(value)
  },
)
watch(
  settings,
  () => {
    if (initialized) {
      clearTimeout(settingsTimer)
      settingsTimer = setTimeout(persistSettings, 180)
    }
  },
  { deep: true },
)
watch([settingsOpen, opacityOpen, busy, removing], () =>
  window.reader?.setInteractionLock(
    settingsOpen.value || opacityOpen.value || busy.value || Boolean(removing.value),
  ),
)

function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Digit0') {
    event.preventDefault()
    resetOpacity()
  }
  if (event.key === 'Escape') {
    settingsOpen.value = false
    removing.value = undefined
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    if (!busy.value) void importBooks()
  }
}

onMounted(async () => {
  if (!window.reader) {
    fatal.value = '请通过桌面应用启动隐页：在项目目录运行 npm run dev。'
    return
  }
  try {
    library.value = await window.reader.getLibrary()
    settings.value = { ...library.value.settings }
    windowState.value = await window.reader.getWindowState()
    offWindow = window.reader.onWindowState((state) => {
      windowState.value = state
    })
    offResetOpacity = window.reader.onResetOpacity(resetOpacity)
    initialized = true
    document.addEventListener('keydown', onKey)
  } catch (error) {
    fatal.value = errorText(error)
  }
})
function onDesktopError(event: Event) {
  notify(String((event as CustomEvent).detail))
}
onMounted(() => globalThis.addEventListener('reader:error', onDesktopError))
onBeforeUnmount(() => {
  globalThis.removeEventListener('reader:error', onDesktopError)
  persistSettings()
  clearTimeout(toastTimer)
  offWindow?.()
  offResetOpacity?.()
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="app-shell"
    :class="[
      { 'is-floating': windowState.floating, 'is-reading': content },
      { 'is-background-mode': settings.transparencyMode === 'background' },
      `theme-${settings.theme}`,
    ]"
    :style="appStyle"
    @pointerenter="window.reader?.setHovered(true)"
    @pointerleave="window.reader?.setHovered(false)"
  >
    <header class="titlebar">
      <div class="titlebar-drag">
        <span class="tiny-brand">
          <Icon name="leaf" :size="16" />
          隐页
        </span>
        <span class="titlebar-divider">/</span>
        <span class="titlebar-caption">{{ content ? content.book.title : '留一页，给自己' }}</span>
      </div>
      <div class="window-actions">
        <button class="icon-button" aria-label="最小化" @click="window.reader.minimize()">
          <Icon name="minus" :size="15" />
        </button>
        <button
          class="icon-button close-window"
          aria-label="关闭到托盘"
          title="关闭到托盘；可用 Ctrl+Shift+Space 恢复"
          @click="closeToTray"
        >
          <Icon name="close" :size="15" />
        </button>
      </div>
    </header>
    <div v-if="fatal" class="fatal-state">
      <Icon name="info" :size="32" />
      <h1>暂时无法打开书架</h1>
      <p>{{ fatal }}</p>
    </div>
    <template v-else>
      <aside v-if="!windowState.floating" class="sidebar">
        <div class="brand">
          <div class="brand-mark"><Icon name="book" :size="24" /></div>
          <div>
            <strong>隐页</strong>
            <span>QUIETLEAF</span>
          </div>
        </div>
        <div class="nav-label">你的阅读空间</div>
        <nav>
          <button :class="{ active: view === 'shelf' && !content }" @click="navigate('shelf')">
            <Icon name="shelf" />
            <span>我的书架</span>
            <small>{{ books.length }}</small>
          </button>
          <button :class="{ active: view === 'recent' && !content }" @click="navigate('recent')">
            <Icon name="clock" />
            <span>最近阅读</span>
          </button>
          <button
            :class="{ active: view === 'finished' && !content }"
            @click="navigate('finished')"
          >
            <Icon name="check" />
            <span>已经读完</span>
          </button>
        </nav>
        <div class="sidebar-note">
          <span class="note-mark">“</span>
          <p>
            在文字的留白里，
            <br />
            找到自己的节奏。
          </p>
          <span>READ AT YOUR PACE</span>
        </div>
        <div class="sidebar-bottom">
          <div class="local-status">
            <i></i>
            本地书架 · 离线保存
          </div>
          <button class="sidebar-settings" @click="settingsOpen = true">
            <Icon name="settings" :size="18" />
            <span>阅读偏好</span>
            <Icon name="chevron" :size="15" />
          </button>
        </div>
      </aside>
      <main class="workspace">
        <template v-if="!content">
          <div class="library-header">
            <div>
              <span class="eyebrow">A LITTLE TIME FOR YOURSELF</span>
              <h1>{{ pageTitle }}</h1>
            </div>
            <button class="button primary" @click="importBooks" :disabled="busy">
              <Icon name="plus" :size="18" />
              {{ busy ? '正在添加…' : '导入书籍' }}
            </button>
          </div>
          <section v-if="view === 'shelf' && continueBook" class="reading-banner">
            <div class="banner-copy">
              <div class="banner-label">
                <span></span>
                {{ continueBook.lastOpenedAt ? '接着上次的故事' : '从一页安静开始' }}
              </div>
              <h2>{{ continueBook.lastOpenedAt ? continueBook.title : '把喧嚣留在页外。' }}</h2>
              <p>
                {{
                  continueBook.lastOpenedAt
                    ? `已读 ${Math.round(continueBook.progress.percent)}% · ${continueBook.author}`
                    : '打开一本书，让片刻闲暇有个温柔的去处。'
                }}
              </p>
              <button class="button banner-button" @click="openBook(continueBook)">
                {{
                  continueBook.lastOpenedAt
                    ? '继续阅读'
                    : continueBook.sample
                      ? '翻开示例读物'
                      : '开始阅读'
                }}
                <Icon name="arrow" :size="17" />
              </button>
            </div>
            <div class="banner-illustration" aria-hidden="true">
              <div class="sun-disc"></div>
              <div class="mountain far"></div>
              <div class="mountain near"></div>
              <div class="book-decoration"><Icon name="book" :size="54" /></div>
              <span>一书一世界</span>
            </div>
          </section>
          <div class="shelf-toolbar">
            <div class="format-tabs" aria-label="格式筛选">
              <button
                v-for="item in [
                  { value: 'all', label: '全部书籍' },
                  { value: 'epub', label: 'EPUB' },
                  { value: 'txt', label: 'TXT' },
                ]"
                :key="item.value"
                :class="{ active: format === item.value }"
                @click="format = item.value"
              >
                {{ item.label }}
                <span v-if="item.value === 'all'">{{ books.length }}</span>
              </button>
            </div>
            <label class="search-box">
              <Icon name="search" :size="17" />
              <input v-model="query" aria-label="搜索书架" placeholder="搜索书名、作者" />
              <button v-if="query" class="icon-button" aria-label="清除搜索" @click="query = ''">
                <Icon name="close" :size="14" />
              </button>
            </label>
          </div>
          <div class="shelf-scroll">
            <div v-if="filtered.length" class="book-grid">
              <article v-for="book in filtered" :key="book.id" class="book-card">
                <button
                  class="cover-button"
                  :aria-label="`阅读 ${book.title}`"
                  @click="openBook(book)"
                >
                  <BookCover :book="book" />
                  <span class="cover-open">
                    <Icon name="book" :size="20" />
                    开始阅读
                  </span>
                </button>
                <div class="book-title-row">
                  <button @click="openBook(book)" class="book-title">{{ book.title }}</button>
                  <button
                    class="remove-book icon-button"
                    :aria-label="`移除 ${book.title}`"
                    @click="removing = book"
                  >
                    <Icon name="trash" :size="15" />
                  </button>
                </div>
                <div class="book-meta">
                  <span>{{ book.author }}</span>
                  <span class="format-badge">{{ book.format.toUpperCase() }}</span>
                </div>
                <div class="book-progress">
                  <span><i :style="{ width: `${book.progress.percent}%` }"></i></span>
                  <small>
                    {{
                      book.progress.percent > 0
                        ? `已读 ${Math.round(book.progress.percent)}%`
                        : book.sample
                          ? '示例读物'
                          : '尚未翻开'
                    }}
                  </small>
                </div>
              </article>
              <button
                v-if="view === 'shelf' && !query && format === 'all'"
                class="add-book-card"
                @click="importBooks"
                :disabled="busy"
              >
                <span><Icon name="plus" :size="26" /></span>
                <strong>下一段故事</strong>
                <small>添加 EPUB 或 TXT</small>
              </button>
            </div>
            <div v-else class="empty-state">
              <div><Icon :name="query ? 'search' : 'book'" :size="34" /></div>
              <h2>
                {{
                  query
                    ? '没有找到这本书'
                    : view === 'finished'
                      ? '每一页，都在慢慢靠近'
                      : view === 'recent'
                        ? '从一本书开始'
                        : '这里还没有书籍'
                }}
              </h2>
              <p>
                {{
                  query
                    ? '换个书名或作者试试。'
                    : view === 'finished'
                      ? '读完的书会留在这里。'
                      : '导入自己的 EPUB 或 TXT，开始安静阅读。'
                }}
              </p>
              <button v-if="!query" class="button secondary" @click="importBooks">导入书籍</button>
            </div>
            <div class="shelf-footnote">
              <Icon name="leaf" :size="14" />
              <span>不赶进度，只享受这一页。</span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="reading-header">
            <div class="reading-heading">
              <button class="icon-button" aria-label="返回书架" @click="backToShelf">
                <Icon name="back" :size="20" />
              </button>
              <div>
                <h2>{{ content.book.title }}</h2>
                <span v-if="!windowState.floating">{{ content.book.author }}</span>
              </div>
            </div>
            <div class="reading-actions">
              <button
                v-if="windowState.floating"
                class="icon-button"
                :class="{ selected: settings.autoHide }"
                :aria-pressed="settings.autoHide"
                aria-label="鼠标移出自动隐藏"
                :title="
                  settings.autoHide
                    ? '移出自动隐藏已开启，点击关闭'
                    : '移出自动隐藏已关闭，点击开启'
                "
                @click="toggleAutoHide"
              >
                <Icon name="cursor" :size="19" />
              </button>
              <OpacityControl
                v-model:mode="settings.transparencyMode"
                v-model:background-opacity="settings.backgroundOpacity"
                v-model:text-opacity="settings.textOpacity"
                v-model:window-opacity="settings.windowOpacity"
                :floating="windowState.floating"
                @clear-background="clearBackground"
                @reset="resetOpacity"
                @open-change="opacityOpen = $event"
              />
              <button
                class="icon-button"
                :class="{ selected: windowState.floating }"
                :aria-label="windowState.floating ? '退出悬浮模式' : '进入悬浮阅读'"
                title="悬浮阅读"
                @click="toggleFloating"
              >
                <Icon :name="windowState.floating ? 'expand' : 'float'" :size="19" />
              </button>
              <button
                class="icon-button"
                :class="{ selected: settingsOpen }"
                aria-label="阅读设置"
                title="阅读设置"
                @click="settingsOpen = !settingsOpen"
              >
                <Icon name="settings" :size="20" />
              </button>
              <button
                class="icon-button"
                aria-label="立即隐藏"
                title="立即隐藏 · Ctrl+Shift+Space 恢复"
                @click="hideNow"
              >
                <Icon name="hide" :size="19" />
              </button>
            </div>
          </div>
          <BookReader
            ref="reader"
            :key="content.book.id"
            :content="content"
            :settings="settings"
            :floating="windowState.floating"
            @progress="saveProgress"
            @error="notify"
            @reset-opacity="resetOpacity"
          />
        </template>
      </main>
      <template v-if="settingsOpen">
        <div class="panel-backdrop" @click="settingsOpen = false"></div>
        <section
          class="settings-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <header>
            <div>
              <span class="eyebrow">MAKE IT YOURS</span>
              <h2 id="settings-title">阅读偏好</h2>
            </div>
            <button class="icon-button" aria-label="关闭设置" @click="closeSettings">
              <Icon name="close" />
            </button>
          </header>
          <div class="settings-scroll">
            <div class="setting-group">
              <h3>纸页与文字</h3>
              <div class="theme-options">
                <button
                  v-for="theme in [
                    { id: 'paper', name: '暖纸' },
                    { id: 'sage', name: '青苔' },
                    { id: 'night', name: '夜读' },
                  ]"
                  :key="theme.id"
                  :class="[`swatch-${theme.id}`, { active: settings.theme === theme.id }]"
                  @click="settings.theme = theme.id as ReaderSettings['theme']"
                >
                  <span>文</span>
                  {{ theme.name }}
                </button>
              </div>
              <label class="setting-row">
                字体
                <select v-model="settings.fontFamily" aria-label="阅读字体">
                  <option value="serif">宋体 / 衬线</option>
                  <option value="sans">黑体 / 无衬线</option>
                </select>
              </label>
              <div class="setting-row">
                <span>字号</span>
                <div class="stepper">
                  <button
                    aria-label="减小字号"
                    :disabled="settings.fontSize <= 14"
                    @click="settings.fontSize--"
                  >
                    −
                  </button>
                  <span>{{ settings.fontSize }}</span>
                  <button
                    aria-label="增大字号"
                    :disabled="settings.fontSize >= 32"
                    @click="settings.fontSize++"
                  >
                    +
                  </button>
                </div>
              </div>
              <label class="range-setting">
                <span>
                  行间距
                  <output>{{ settings.lineHeight.toFixed(1) }}</output>
                </span>
                <input
                  v-model.number="settings.lineHeight"
                  aria-label="行间距"
                  type="range"
                  min="1.3"
                  max="2.6"
                  step="0.1"
                />
              </label>
            </div>
            <div class="setting-group">
              <h3>透明模式</h3>
              <label class="setting-row">
                <span>透明方式</span>
                <select v-model="settings.transparencyMode" aria-label="偏好中的透明方式">
                  <option value="background">背景透明，文字清晰</option>
                  <option value="window">整窗一起透明</option>
                </select>
              </label>
              <template v-if="settings.transparencyMode === 'background'">
                <label class="range-setting">
                  <span>
                    背景透明度
                    <output>{{ Math.round(settings.backgroundOpacity * 100) }}%</output>
                  </span>
                  <input
                    v-model.number="settings.backgroundOpacity"
                    aria-label="偏好中的背景透明度"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                  />
                </label>
                <label class="range-setting">
                  <span>
                    文字可见度
                    <output>{{ Math.round(settings.textOpacity * 100) }}%</output>
                  </span>
                  <input
                    v-model.number="settings.textOpacity"
                    aria-label="偏好中的文字可见度"
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.01"
                  />
                </label>
                <p class="setting-hint">
                  悬浮阅读时透出底下的窗口。背景设为 0% 可完全透出，文字默认 100% 清晰。
                </p>
                <button class="button secondary full-width" @click="clearBackground">
                  背景全透明，文字清晰
                </button>
              </template>
              <label v-else class="range-setting">
                <span>
                  整窗透明度
                  <output>{{ Math.round(settings.windowOpacity * 100) }}%</output>
                </span>
                <input
                  v-model.number="settings.windowOpacity"
                  aria-label="偏好中的整窗透明度"
                  type="range"
                  min="0.01"
                  max="1"
                  step="0.01"
                />
              </label>
              <p v-if="settings.transparencyMode === 'window'" class="setting-hint">
                标题栏、按钮、正文与背景一起变淡。数值越小，整个窗口越透明。
              </p>
              <button class="button secondary full-width" @click="resetOpacity">恢复不透明</button>
            </div>
            <div class="setting-group">
              <h3>悬浮阅读</h3>
              <label class="setting-row">
                <span>窗口置顶</span>
                <input
                  v-model="settings.alwaysOnTop"
                  class="switch"
                  type="checkbox"
                  aria-label="窗口置顶"
                />
              </label>
              <label v-if="settings.autoHide" class="range-setting">
                <span>
                  移出后等待
                  <output>{{ settings.hideDelay }} ms</output>
                </span>
                <input
                  v-model.number="settings.hideDelay"
                  aria-label="隐藏延迟"
                  type="range"
                  min="200"
                  max="2000"
                  step="100"
                />
              </label>
              <p class="setting-hint">
                右上角透明度左侧可开关自动隐藏。移出后整窗透明，移回原窗口区域恢复。打开设置时暂停隐藏。
              </p>
              <button
                class="button secondary full-width"
                :disabled="!content"
                @click="applyFloating"
              >
                <Icon name="float" :size="17" />
                {{ windowState.floating ? '退出悬浮阅读' : '进入悬浮阅读' }}
              </button>
            </div>
            <div class="shortcut-note">
              <Icon name="info" :size="16" />
              <div>
                <strong>随时回来</strong>
                <p>
                  Ctrl + Shift + Space 显示或隐藏
                  <br />
                  Ctrl + O 导入书籍 · ← → 翻页
                  <br />
                  Ctrl + Alt + 0 恢复不透明
                </p>
                <p v-if="!windowState.shortcutAvailable" class="warning-text">
                  全局快捷键被占用，请通过托盘恢复。
                </p>
              </div>
            </div>
            <div class="app-info">
              <span>隐页 {{ packageInfo.version }}</span>
              <span>
                {{ windowState.platform }} · {{ windowState.arch }} · {{ windowState.session }}
              </span>
              <button class="text-button" @click="quitApp">退出应用</button>
            </div>
          </div>
        </section>
      </template>
      <div v-if="removing" class="dialog-backdrop">
        <section
          class="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-title"
        >
          <div class="dialog-icon"><Icon name="book" :size="24" /></div>
          <h2 id="remove-title">移除这本书？</h2>
          <p>
            《{{ removing.title }}》会从书架移除，
            <br />
            你的原始文件不受影响。
          </p>
          <div>
            <button class="button secondary" @click="removing = undefined">再留一会</button>
            <button class="button danger" @click="removeBook">移除书籍</button>
          </div>
        </section>
      </div>
      <div v-if="busy" class="busy-indicator" role="status">
        <span class="spinner"></span>
        正在整理书页…
      </div>
      <div v-if="toast" class="toast" role="status">
        <Icon name="info" :size="17" />
        <span>{{ toast }}</span>
        <button class="icon-button" aria-label="关闭提示" @click="toast = ''">
          <Icon name="close" :size="15" />
        </button>
      </div>
    </template>
  </div>
</template>
