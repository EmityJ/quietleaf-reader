import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import {
  DEFAULT_SETTINGS,
  normalizeProgress,
  normalizeSettings,
  StealthController,
} from '../electron/domain'
import { parseText } from '../electron/txt'
import { effectiveWindowOpacity } from '../src/shared/transparency'

test('TXT 编码兼容 UTF-8 BOM 与 UTF-16 双字节顺序', () => {
  const text = '第一章 山间\n\n你好，世界🌿'
  const le = Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')])
  const be = Buffer.from(le)
  be.swap16()
  for (const bytes of [Buffer.from('\uFEFF' + text), le, be])
    assert.equal(parseText(bytes).text, text)
})

test('TXT 的 GB18030 回退保留中文', () => {
  assert.equal(parseText(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])).text, '你好')
})

test('中文章节与开篇按 UTF-8 字节位置索引', () => {
  const result = parseText(Buffer.from('开头🌿\r\n第一章 山风\r\n你好\r\n第二章 远方\r\n再见'))
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.title),
    ['开篇', '第一章 山风', '第二章 远方'],
  )
  const buffer = Buffer.from(result.text)
  assert.equal(
    buffer.subarray(result.chapters[1].start, result.chapters[1].end).toString(),
    '第一章 山风\n你好\n',
  )
  assert.equal(result.chapters.at(-1)!.end, buffer.length)
})

test('长段落分块不会切开 emoji，拼接可恢复原文', () => {
  const original = '字'.repeat(17999) + '🌿' + '后文'.repeat(20000)
  const result = parseText(Buffer.from(original))
  assert.ok(result.chapters.length > 2)
  const bytes = Buffer.from(result.text)
  const chunks = result.chapters.map((chapter) =>
    bytes.subarray(chapter.start, chapter.end).toString(),
  )
  assert.equal(chunks.join(''), original)
  assert.ok(chunks.every((text) => !text.includes('\ufffd')))
})

test('空白文件拒绝导入，普通文件产生正文索引', () => {
  assert.throws(() => parseText(Buffer.from(' \n\n ')), /没有可阅读/)
  assert.equal(parseText(Buffer.from('一份没有章节的文字')).chapters[0].title, '正文')
})

test('设置和位置拒绝非有限数字，约束透明度和延迟', () => {
  const result = normalizeSettings({
    fontSize: Infinity,
    hideDelay: -1,
    windowOpacity: -4,
  })
  assert.equal(result.fontSize, DEFAULT_SETTINGS.fontSize)
  assert.equal(result.hideDelay, 200)
  assert.equal(result.windowOpacity, 0.01)
  assert.equal(normalizeProgress({ percent: NaN, chapterIndex: -4, fraction: 3 }).percent, 0)
  assert.equal(normalizeProgress({ percent: 120, cfi: 'x'.repeat(5000) }).cfi, undefined)
})

test('旧版整窗透明度迁移为背景透明度，正文恢复清晰，保留整窗选项', () => {
  const migrated = normalizeSettings({ windowOpacity: 0.24 })
  assert.equal(migrated.transparencyMode, 'background')
  assert.equal(migrated.backgroundOpacity, 0.24)
  assert.equal(migrated.textOpacity, 1)
  assert.equal(effectiveWindowOpacity(migrated), 1)
  assert.equal(normalizeSettings({ backgroundOpacity: 0.24 }).backgroundOpacity, 0.24)
  assert.equal(
    effectiveWindowOpacity(normalizeSettings({ transparencyMode: 'window', windowOpacity: 0.6 })),
    0.6,
  )
  assert.equal(normalizeSettings({ windowOpacity: NaN }).windowOpacity, 1)
})

test('背景允许完全透明，文字保持可找回的下限，各参数独立保存', () => {
  const value = normalizeSettings({
    transparencyMode: 'background',
    backgroundOpacity: 0,
    textOpacity: 0.7,
    windowOpacity: 0.01,
  })
  assert.equal(value.backgroundOpacity, 0)
  assert.equal(value.textOpacity, 0.7)
  assert.equal(value.windowOpacity, 0.01)
  assert.equal(effectiveWindowOpacity(value), 1)
  assert.equal(normalizeSettings({ textOpacity: -2 }).textOpacity, 0.2)
})

function controller() {
  const calls: string[] = []
  const state = new StealthController(
    { autoHide: true, hideDelay: 15 },
    {
      conceal: () => calls.push('conceal'),
      reveal: () => calls.push('reveal'),
      bossHide: () => calls.push('boss'),
      changed: () => {},
    },
  )
  return { state, calls }
}

test('悬浮移出延时透明，再次移入立即恢复且可重复', async () => {
  const { state, calls } = controller()
  state.setFloating(true)
  state.setHovered(false)
  await delay(35)
  assert.equal(state.concealed, true)
  state.setHovered(true)
  assert.equal(state.concealed, false)
  assert.deepEqual(calls, ['conceal', 'reveal'])
  state.setHovered(false)
  await delay(35)
  assert.equal(state.concealed, true)
  state.setHovered(true)
  assert.equal(state.concealed, false)
  assert.deepEqual(calls, ['conceal', 'reveal', 'conceal', 'reveal'])
  state.dispose()
})

test('移入、交互锁与退出悬浮会取消挂起的隐藏', async () => {
  const { state, calls } = controller()
  state.setFloating(true)
  state.setHovered(false)
  state.setHovered(true)
  await delay(30)
  state.setHovered(false)
  state.setLocked(true)
  await delay(30)
  state.setLocked(false)
  state.setFloating(false)
  await delay(30)
  assert.deepEqual(calls, [])
  state.dispose()
})

test('老板键取消自动隐藏，关闭自动隐藏可恢复透明状态', async () => {
  const { state, calls } = controller()
  state.setFloating(true)
  state.setHovered(false)
  state.hideByBossKey()
  await delay(30)
  assert.equal(state.bossHidden, true)
  assert.deepEqual(calls, ['boss'])
  state.reveal()
  state.setHovered(false)
  await delay(30)
  state.configure({ autoHide: false, hideDelay: 15 })
  assert.equal(state.concealed, false)
  assert.equal(state.bossHidden, false)
  state.dispose()
})

test('老板键隐藏不能被鼠标移入恢复', async () => {
  const { state, calls } = controller()
  state.setFloating(true)
  state.setHovered(false)
  await delay(35)
  state.hideByBossKey()
  state.setHovered(true)
  assert.equal(state.bossHidden, true)
  assert.equal(state.concealed, false)
  assert.deepEqual(calls, ['conceal', 'boss'])
  state.dispose()
})

test('关闭自动隐藏时移出保持可见，重新开启按延迟透明', async () => {
  const { state, calls } = controller()
  state.setFloating(true)
  state.configure({ autoHide: false, hideDelay: 15 })
  state.setHovered(false)
  await delay(35)
  assert.equal(state.concealed, false)
  state.configure({ autoHide: true, hideDelay: 15 })
  await delay(35)
  assert.equal(state.concealed, true)
  state.setFloating(false)
  assert.equal(state.concealed, false)
  assert.deepEqual(calls, ['conceal', 'reveal'])
  state.dispose()
})
