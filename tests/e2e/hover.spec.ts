import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeEpub } from '../fixtures'

test('右上开关、移出全透明、原区域恢复与用户透明度保留', async () => {
  const root = path.resolve('.test-data', `hover-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const epubPath = path.join(root, '悬浮测试.epub')
  await writeFile(epubPath, await makeEpub())
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.QUIETLEAF_USER_DATA = path.join(root, 'profile')
  const app = await electron.launch({ args: [path.resolve('dist/electron/main.cjs')], env })
  try {
    // CDP 鼠标不移动系统光标；通过独立坐标输入验证主进程的区域恢复。
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
    })
    const page = await app.firstWindow()
    const shell = page.locator('.app-shell')
    await page.getByRole('button', { name: '阅读 山间来信', exact: true }).click()
    await page.getByRole('button', { name: '调整窗口透明度' }).click()
    await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
    await page.getByRole('slider', { name: '整窗透明度', exact: true }).evaluate((element) => {
      ;(element as HTMLInputElement).value = '0.24'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.getByRole('button', { name: '调整窗口透明度' }).click()
    await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
    await expect(shell).toHaveClass(/is-floating/)
    const autoHide = page.getByRole('button', { name: '鼠标移出自动隐藏', exact: true })
    await expect(autoHide).toHaveAttribute('aria-pressed', 'true')
    const autoBounds = (await autoHide.boundingBox())!
    const opacityBounds = (await page
      .getByRole('button', { name: '调整窗口透明度' })
      .boundingBox())!
    expect(autoBounds.x + autoBounds.width).toBeLessThanOrEqual(opacityBounds.x)
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    )
    await page.mouse.move(150, 200)
    await page.screenshot({ path: path.join(root, '01-悬浮开关.png'), omitBackground: true })
    await page.mouse.move(-30, -30)
    await expect(shell).toHaveCSS('opacity', '0')
    const screenshot = await page.screenshot({
      path: path.join(root, '02-完全透明.png'),
      omitBackground: true,
    })
    const maxAlpha = await app.evaluate(({ nativeImage }, encoded) => {
      const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toBitmap()
      let max = 0
      for (let index = 3; index < bitmap.length; index += 4) max = Math.max(max, bitmap[index])
      return max
    }, screenshot.toString('base64'))
    expect(maxAlpha).toBe(0)
    expect(
      await app.evaluate(({ BrowserWindow }) => ({
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0].isVisible(),
        bounds: BrowserWindow.getAllWindows()[0].getBounds(),
      })),
    ).toEqual({ count: 1, visible: true, bounds })
    expect((await page.evaluate(() => window.reader.getLibrary())).settings.windowOpacity).toBe(
      0.24,
    )
    await page.mouse.move(150, 200)
    await expect(shell).toHaveCSS('opacity', '0.24')

    await autoHide.click()
    await expect(autoHide).toHaveAttribute('aria-pressed', 'false')
    await expect
      .poll(() =>
        page.evaluate(() => window.reader.getLibrary()).then((state) => state.settings.autoHide),
      )
      .toBe(false)
    await page.mouse.move(-30, -30)
    await page.waitForTimeout(750)
    await expect(shell).toHaveCSS('opacity', '0.24')
    await page.mouse.move(150, 200)
    await autoHide.click()
    await page.getByRole('button', { name: '调整窗口透明度' }).click()
    await page.mouse.move(-30, -30)
    await page.waitForTimeout(750)
    await expect(shell).toHaveCSS('opacity', '0.24')
    await page.mouse.move(150, 200)
    await page.getByRole('button', { name: '调整窗口透明度' }).click()

    await page.mouse.move(-30, -30)
    await expect(shell).toHaveCSS('opacity', '0')
    // 模拟系统光标回到原窗口，覆盖透明像素不接收 pointerenter 时的恢复入口。
    await app.evaluate(({ screen, BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows()[0].getBounds()
      screen.getCursorScreenPoint = () => ({ x: bounds.x + 150, y: bounds.y + 200 })
    })
    await expect(shell).toHaveCSS('opacity', '0.24')
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
    })
    await page.mouse.move(150, 200)
    await page.getByRole('button', { name: '退出悬浮模式', exact: true }).click()
    await page.getByRole('button', { name: '返回书架' }).click()
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, epubPath)
    await page.getByRole('button', { name: '导入书籍', exact: true }).click()
    await page.getByRole('button', { name: '阅读 测试电子书', exact: true }).click()
    await expect(page.locator('.epub-area iframe')).toBeVisible()
    await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
    await page.mouse.move(150, 200)
    await page.mouse.move(-30, -30)
    await expect(shell).toHaveCSS('opacity', '0')
    await page.mouse.move(150, 200)
    await expect(shell).toHaveCSS('opacity', '0.24')
    await expect
      .poll(() =>
        page.evaluate(() => window.reader.getWindowState()).then((state) => state.concealed),
      )
      .toBe(false)
  } finally {
    await app.close()
  }
})
