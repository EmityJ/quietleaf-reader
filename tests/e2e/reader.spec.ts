import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeEpub } from '../fixtures'

test('离线导入、阅读恢复、透明悬浮和移入恢复流程', async () => {
  const root = path.resolve('.test-data', `e2e-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const txtPath = path.join(root, '测试小说.txt')
  const epubPath = path.join(root, '测试.epub')
  await writeFile(
    txtPath,
    '第一章 春风\n' +
      '春风拂过山间，这是用于验证滚动与恢复的文字。\n\n'.repeat(45) +
      '第二章 秋水\n这个位置应在重启后恢复。\n',
  )
  await writeFile(epubPath, await makeEpub({ unsafeScript: true }))
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  env.QUIETLEAF_USER_DATA = path.join(root, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  let page: Page
  const launch = async () => {
    app = await electron.launch({ args: [path.resolve('dist/electron/main.cjs')], env })
    // 页面鼠标由 CDP 合成，固定系统光标在窗口外；系统区域检测另有专门流程验证。
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
    })
    app.process().stderr?.on('data', (chunk) => {
      if (String(chunk).includes('ERR_')) console.log(String(chunk))
    })
    await expect
      .poll(() => app!.windows().some((window) => window.url().includes('index.html')))
      .toBe(true)
    page = app.windows().find((window) => window.url().includes('index.html'))!
    await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible()
  }
  try {
    await launch()
    await page!.screenshot({ path: path.join(root, '01-书架.png') })
    await page!.getByRole('button', { name: '阅读 山间来信', exact: true }).click()
    await page!.getByRole('button', { name: '调整窗口透明度' }).click()
    await page!.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
    await page!.getByRole('button', { name: '调整窗口透明度' }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第一章')
    await page!.getByRole('button', { name: '下一章或下一页' }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第二章')
    await page!.getByRole('button', { name: '返回书架' }).click()
    await app!.evaluate(
      ({ dialog }, files) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
      },
      [txtPath, epubPath],
    )
    await page!.getByRole('button', { name: '导入书籍', exact: true }).click()
    await expect(page!.getByRole('button', { name: '阅读 测试小说', exact: true })).toBeVisible()
    await page!.getByRole('textbox', { name: '搜索书架' }).fill('测试电子书')
    await expect(page!.getByRole('button', { name: '阅读 测试电子书', exact: true })).toBeVisible()
    await expect(page!.getByRole('button', { name: '阅读 测试小说', exact: true })).toHaveCount(0)
    await page!.getByRole('button', { name: '清除搜索' }).click()
    await page!.getByRole('button', { name: '阅读 测试小说', exact: true }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第一章')
    await page!.getByRole('textbox', { name: '查找当前章节' }).fill('春风')
    await page!.getByRole('button', { name: '查找', exact: true }).click()
    await expect(page!.locator('.search-match').first()).toBeVisible()
    await page!.getByRole('button', { name: '下一章或下一页' }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第二章 秋水')
    await page!.getByRole('button', { name: '阅读设置', exact: true }).click()
    await page!.getByRole('button', { name: '增大字号', exact: true }).click()
    await page!.getByRole('button', { name: '青苔', exact: false }).click()
    await page!.getByRole('button', { name: '关闭设置' }).click()
    await page!.screenshot({ path: path.join(root, '02-阅读.png') })
    await page!.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
    await expect(page!.locator('.app-shell')).toHaveClass(/is-floating/)
    await page!.mouse.move(150, 200)
    await page!.mouse.move(-30, -30)
    await expect
      .poll(() =>
        page!.evaluate(() => window.reader.getWindowState()).then((value) => value.concealed),
      )
      .toBe(true)
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '0')
    expect(app!.windows()).toHaveLength(1)
    await page!.mouse.move(150, 200)
    await expect
      .poll(() =>
        page!.evaluate(() => window.reader.getWindowState()).then((value) => value.concealed),
      )
      .toBe(false)
    await expect(page!.locator('.app-shell')).toHaveCSS('opacity', '1')
    await page!.mouse.move(150, 200)
    await page!.screenshot({ path: path.join(root, '03-悬浮阅读.png') })
    await page!.getByRole('button', { name: '立即隐藏', exact: true }).click()
    await expect
      .poll(() =>
        page!.evaluate(() => window.reader.getWindowState()).then((value) => value.bossHidden),
      )
      .toBe(true)
    await page!.evaluate(() => window.reader.wakeWindow())
    await page!.getByRole('button', { name: '退出悬浮模式', exact: true }).click()
    await page!.getByRole('button', { name: '返回书架' }).click()
    await page!.getByRole('button', { name: '阅读 测试电子书', exact: true }).click()
    await expect(page!.locator('.epub-area iframe')).toBeVisible()
    await expect
      .poll(() => page!.locator('.epub-area iframe').contentFrame().locator('body').textContent())
      .toContain('测试阅读')
    expect(
      await page!.evaluate(() => ({
        reader: typeof window.reader,
        require: typeof (window as any).require,
        escaped: (window as any).__epubEscaped,
      })),
    ).toEqual({ reader: 'object', require: 'undefined', escaped: undefined })
    expect(
      await page!
        .locator('.epub-area iframe')
        .contentFrame()
        .locator('body')
        .evaluate(() => typeof (window as any).reader),
    ).toBe('undefined')
    await page!.getByRole('button', { name: '目录', exact: true }).click()
    await page!.getByRole('button', { name: '第二章 另一页', exact: true }).click()
    await expect
      .poll(() => page!.locator('.epub-area iframe').contentFrame().locator('body').textContent())
      .toContain('这是第二章')
    await page!.screenshot({ path: path.join(root, '04-EPUB阅读.png') })
    await page!.getByRole('button', { name: '返回书架' }).click()
    await expect
      .poll(() =>
        page!
          .evaluate(() => window.reader.getLibrary())
          .then(
            (library) =>
              library.books.find((book) => book.title === '测试小说')?.progress.chapterIndex,
          ),
      )
      .toBe(1)
    await app!.close()
    app = undefined
    await launch()
    await page!.getByRole('button', { name: '阅读 测试小说', exact: true }).click()
    await expect(page!.locator('.text-article h1')).toContainText('第二章 秋水')
    await expect(page!.locator('.app-shell')).toHaveClass(/theme-sage/)
    await expect(page!.locator('.text-article')).toHaveCSS('font-size', '21px')
    await page!.getByRole('button', { name: '标记读完', exact: true }).click()
    await expect(page!.getByRole('button', { name: '标记读完', exact: true })).toBeDisabled()
    await page!.getByRole('button', { name: '返回书架' }).click()
    await page!.getByRole('button', { name: '已经读完', exact: true }).click()
    await expect(page!.getByRole('button', { name: '阅读 测试小说', exact: true })).toBeVisible()
    await page!.getByRole('button', { name: '我的书架', exact: false }).click()
    await page!.getByRole('button', { name: '阅读 测试电子书', exact: true }).click()
    await expect
      .poll(() => page!.locator('.epub-area iframe').contentFrame().locator('body').textContent())
      .toContain('这是第二章')
    await page!.getByRole('button', { name: '返回书架' }).click()
    await page!.getByRole('button', { name: '移除 测试小说', exact: true }).click()
    await page!.getByRole('button', { name: '移除书籍', exact: true }).click()
    await expect(page!.getByRole('button', { name: '阅读 测试小说', exact: true })).toHaveCount(0)
  } finally {
    if (app) await app.close()
  }
})
