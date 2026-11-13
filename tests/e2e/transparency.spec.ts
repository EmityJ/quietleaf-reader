import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeEpub } from '../fixtures'

test('24% 整窗透明、低透明度恢复与重启持久化', async () => {
  const root = path.resolve('.test-data', `opacity-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const epubPath = path.join(root, '透明测试.epub')
  await writeFile(epubPath, await makeEpub())
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.QUIETLEAF_USER_DATA = path.join(root, 'profile')
  let app: ElectronApplication | undefined
  let page: Page
  const launch = async () => {
    app = await electron.launch({ args: [path.resolve('dist/electron/main.cjs')], env })
    await expect
      .poll(() => app!.windows().some((window) => window.url().includes('index.html')))
      .toBe(true)
    page = app.windows().find((window) => window.url().includes('index.html'))!
    await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible()
  }
  const assertAlpha = async (name: string, expected: number) => {
    const screenshot = await page!.screenshot({
      path: path.join(root, `${name}.png`),
      omitBackground: true,
    })
    const alpha = await app!.evaluate(({ nativeImage }, encoded) => {
      const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toBitmap()
      let max = 0
      for (let index = 3; index < bitmap.length; index += 4) max = Math.max(max, bitmap[index])
      return max
    }, screenshot.toString('base64'))
    // 检查实际像素的最大 alpha，避免只改背景、正文或遗留不透明工具栏。
    expect(alpha).toBeGreaterThanOrEqual(expected - 1)
    expect(alpha).toBeLessThanOrEqual(expected + 1)
  }
  const setOpacity = async (value: string) => {
    await page!.getByRole('button', { name: '调整窗口透明度' }).click()
    const dialog = page!.getByRole('dialog', { name: '透明度调节', exact: true })
    await dialog.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
    await dialog
      .getByRole('slider', { name: '整窗透明度', exact: true })
      .evaluate((element, value) => {
        ;(element as HTMLInputElement).value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', value)
  }
  try {
    await launch()
    await page!.getByRole('button', { name: '阅读 山间来信', exact: true }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第一章')
    await setOpacity('0.24')
    await assertAlpha('01-整窗24%', 61)
    const slider = page!.getByRole('slider', { name: '整窗透明度', exact: true })
    await slider.press('Home')
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '0.01')
    await assertAlpha('02-整窗1%', 3)
    await page!
      .getByRole('dialog', { name: '透明度调节', exact: true })
      .getByRole('button', { name: '恢复不透明' })
      .click()
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '1')
    await assertAlpha('03-恢复100%', 255)
    await page!.getByRole('button', { name: '调整窗口透明度' }).click()
    await setOpacity('0.24')
    await page!.keyboard.press('Control+Alt+0')
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '1')
    await page!.getByRole('button', { name: '调整窗口透明度' }).click()
    await page!.getByRole('button', { name: '返回书架' }).click()
    await app!.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, epubPath)
    await page!.getByRole('button', { name: '导入书籍', exact: true }).click()
    await page!.getByRole('button', { name: '阅读 测试电子书', exact: true }).click()
    await expect(page!.locator('.epub-area iframe')).toBeVisible()
    await setOpacity('0.24')
    await assertAlpha('04-EPUB整窗24%', 61)
    await expect
      .poll(() =>
        page!
          .evaluate(() => window.reader.getLibrary())
          .then((state) => state.settings.windowOpacity),
      )
      .toBe(0.24)
    await app!.close()
    app = undefined
    await launch()
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '0.24')
    await app!.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes('index.html'))!
        .webContents.send('window:reset-opacity')
    })
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '1')
  } finally {
    if (app) await app.close()
  }
})
