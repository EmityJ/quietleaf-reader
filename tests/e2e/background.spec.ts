import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeEpub } from '../fixtures'

test('背景与正文独立透明，TXT 和 EPUB 的透明像素与清晰文字同时保留', async () => {
  const root = path.resolve('.test-data', `background-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const epubPath = path.join(root, '透明正文.epub')
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
    const cursorInside = () =>
      app.evaluate(({ screen, BrowserWindow }) => {
        screen.getCursorScreenPoint = () => {
          const bounds = BrowserWindow.getAllWindows()[0].getBounds()
          return { x: bounds.x + 150, y: bounds.y + 200 }
        }
      })
    await cursorInside()
    const page = await app.firstWindow()
    const shell = page.locator('.app-shell')
    const toggle = () => page.getByRole('button', { name: '调整窗口透明度' }).click()
    const change = async (name: string, value: string) => {
      await page.getByRole('slider', { name, exact: true }).evaluate((element, value) => {
        ;(element as HTMLInputElement).value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
    }
    const pixels = async (selector: string, name: string) => {
      const bounds = (await page.locator(selector).boundingBox())!
      const screenshot = await page.screenshot({
        path: path.join(root, `${name}.png`),
        omitBackground: true,
        scale: 'css',
        clip: {
          x: bounds.x + 5,
          y: bounds.y + 5,
          width: bounds.width - 10,
          height: Math.min(210, bounds.height - 10),
        },
      })
      return app.evaluate(({ nativeImage }, encoded) => {
        const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toBitmap()
        let min = 255,
          max = 0
        for (let index = 3; index < bitmap.length; index += 4) {
          min = Math.min(min, bitmap[index])
          max = Math.max(max, bitmap[index])
        }
        return { min, max }
      }, screenshot.toString('base64'))
    }
    await page.getByRole('button', { name: '阅读 山间来信', exact: true }).click()
    await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
    await toggle()
    await expect(page.getByRole('combobox', { name: '透明方式', exact: true })).toHaveValue(
      'background',
    )
    await page.getByRole('button', { name: '背景全透明，文字清晰', exact: true }).click()
    await toggle()
    await expect(shell).toHaveCSS('opacity', '1')
    await expect(page.locator('.text-article')).toHaveCSS('opacity', '1')
    expect(await pixels('.text-article', '01-TXT背景0文字100')).toEqual({ min: 0, max: 255 })
    await toggle()
    await change('背景透明度', '0.25')
    await toggle()
    expect(await pixels('.text-article', '02-TXT背景25文字100')).toEqual({ min: 64, max: 255 })
    await toggle()
    await change('背景透明度', '0')
    await change('文字可见度', '0.5')
    await toggle()
    await expect(page.locator('.text-article')).toHaveCSS('opacity', '0.5')
    expect(await pixels('.text-article', '03-TXT背景0文字50')).toEqual({ min: 0, max: 128 })
    await toggle()
    await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
    await change('整窗透明度', '0.24')
    await toggle()
    await expect(shell).toHaveCSS('opacity', '0.24')
    expect((await pixels('.text-article', '04-整窗模式24')).max).toBe(61)
    await toggle()
    await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('background')
    await page.getByRole('button', { name: '背景全透明，文字清晰', exact: true }).click()
    await toggle()
    await expect(shell).toHaveCSS('opacity', '1')
    await expect
      .poll(() =>
        page
          .evaluate(() => window.reader.getLibrary())
          .then((state) => state.settings.backgroundOpacity),
      )
      .toBe(0)
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
    })
    await expect(shell).toHaveCSS('opacity', '0')
    await cursorInside()
    await expect(shell).toHaveCSS('opacity', '1')
    expect(await pixels('.text-article', '05-移入恢复清晰正文')).toEqual({ min: 0, max: 255 })
    await page.getByRole('button', { name: '退出悬浮模式', exact: true }).click()
    await page.getByRole('button', { name: '返回书架' }).click()
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, epubPath)
    await page.getByRole('button', { name: '导入书籍', exact: true }).click()
    await page.getByRole('button', { name: '阅读 测试电子书', exact: true }).click()
    await expect(page.locator('.epub-area iframe')).toBeVisible()
    await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
    await expect
      .poll(() => page.locator('.epub-area iframe').contentFrame().locator('body').textContent())
      .toContain('测试阅读')
    expect(await pixels('.epub-area', '06-EPUB背景0文字100')).toEqual({ min: 0, max: 255 })
    await toggle()
    await change('文字可见度', '0.5')
    await toggle()
    expect(await pixels('.epub-area', '07-EPUB背景0文字50')).toEqual({ min: 0, max: 128 })
  } finally {
    await app.close()
  }
})
