import { _electron as electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const metadata = JSON.parse(await readFile('package.json', 'utf8'))
const executablePath = path.resolve(
  process.argv[2] || `release/${metadata.version}/linux-unpacked/quietleaf`,
)
const root = path.resolve('.test-data', `linux-x11-${Date.now()}`)
await mkdir(root, { recursive: true })
const env = {
  ...process.env,
  XDG_SESSION_TYPE: 'x11',
  QUIETLEAF_USER_DATA: path.join(root, 'profile'),
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, env })
try {
  await app.evaluate(({ screen }) => {
    screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
  })
  const page = await app.firstWindow()
  const shell = page.locator('.app-shell')
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.reader.getWindowState())).nativeOpacity).toBe(true)
  const windowId = await app.evaluate(
    ({ BrowserWindow }) =>
      `0x${BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE().toString(16)}`,
  )
  const nativeOpacity = () =>
    execFileSync('/usr/bin/xprop', ['-id', windowId, '_NET_WM_WINDOW_OPACITY'], {
      encoding: 'utf8',
    })
  await page.getByRole('button', { name: '阅读 山间来信', exact: true }).click()
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
  const slider = page.getByRole('slider', { name: '整窗透明度', exact: true })
  const changeOpacity = async (value) => {
    await slider.evaluate((element, value) => {
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await expect.poll(nativeOpacity).toContain(String(Math.round(Number(value) * 0xffffffff)))
    await expect(shell).toHaveCSS('opacity', '1')
  }
  await changeOpacity('0.24')
  await changeOpacity('0.01')
  await changeOpacity('0.24')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
  await page.mouse.move(150, 200)
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  )
  await page.mouse.move(-30, -30)
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false)
  expect((await page.evaluate(() => window.reader.getWindowState())).concealed).toBe(true)
  // 隐藏后的窗口不能依赖页面 pointerenter，系统坐标必须能独立恢复。
  await app.evaluate(({ screen }, bounds) => {
    screen.getCursorScreenPoint = () => ({ x: bounds.x + 150, y: bounds.y + 200 })
  }, bounds)
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true)
  await expect(shell).toHaveCSS('opacity', '1')
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
  ).toEqual(bounds)
  expect(nativeOpacity()).toContain('1030792151')
  expect((await page.evaluate(() => window.reader.getLibrary())).settings.windowOpacity).toBe(0.24)
  await page.keyboard.press('Control+Alt+0')
  await expect.poll(nativeOpacity).toContain('4294967295')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('background')
  await page.getByRole('button', { name: '背景全透明，文字清晰', exact: true }).click()
  await expect.poll(nativeOpacity).toContain('4294967295')
  await expect(shell).toHaveCSS('opacity', '1')
  await expect(page.locator('.text-article')).toHaveCSS('opacity', '1')
  await expect(shell).toHaveCSS('background-color', 'rgba(248, 246, 238, 0)')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await app.evaluate(({ screen }) => {
    screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false)
  await app.evaluate(({ screen }, bounds) => {
    screen.getCursorScreenPoint = () => ({ x: bounds.x + 150, y: bounds.y + 200 })
  }, bounds)
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true)
  console.log(
    'Linux X11 检查通过：整窗 1%/24%/100%、背景全透明且文字清晰、两种模式原生隐藏与原区域恢复、设置保留。',
  )
} finally {
  await app.close()
}
