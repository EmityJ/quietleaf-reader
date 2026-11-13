import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const executablePath = path.resolve(
  process.argv[2] || `release/${packageInfo.version}/win-unpacked/quietleaf.exe`,
)
const root = path.resolve('.test-data', `packaged-${Date.now()}`)
await mkdir(root, { recursive: true })
const source = path.join(root, '安装包测试.txt')
await writeFile(
  source,
  '第一章 安装包\n这是从打包后的应用导入的文字。\n第二章 工作线程\n解析与本地存储均应正常。',
)
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
env.QUIETLEAF_USER_DATA = path.join(root, 'profile')
const app = await electron.launch({ executablePath, env })
try {
  await app.evaluate(({ screen }) => {
    screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 })
  })
  await expect
    .poll(() => app.windows().some((window) => window.url().includes('index.html')))
    .toBe(true)
  const page = app.windows().find((window) => window.url().includes('index.html'))
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
  await page.getByRole('button', { name: '导入书籍', exact: true }).click()
  await page.getByRole('button', { name: '阅读 安装包测试', exact: true }).click()
  await expect(page.locator('.text-article h1')).toContainText('第一章 安装包')
  await page.getByRole('button', { name: '下一章或下一页' }).click()
  await expect(page.locator('.text-article h1')).toContainText('第二章 工作线程')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('window')
  await page.getByRole('slider', { name: '整窗透明度', exact: true }).evaluate((element) => {
    element.value = '0.24'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.locator('.app-shell')).toHaveCSS('opacity', '0.24')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page.getByRole('button', { name: '进入悬浮阅读', exact: true }).click()
  await expect(page.getByRole('button', { name: '鼠标移出自动隐藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.mouse.move(150, 200)
  await page.mouse.move(-30, -30)
  await expect(page.locator('.app-shell')).toHaveCSS('opacity', '0')
  expect(app.windows()).toHaveLength(1)
  await page.mouse.move(150, 200)
  await expect(page.locator('.app-shell')).toHaveCSS('opacity', '0.24')
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await page
    .getByRole('dialog', { name: '透明度调节' })
    .getByRole('button', { name: '恢复不透明' })
    .click()
  await expect(page.locator('.app-shell')).toHaveCSS('opacity', '1')
  await app.evaluate(({ screen, BrowserWindow }) => {
    screen.getCursorScreenPoint = () => {
      const bounds = BrowserWindow.getAllWindows()[0].getBounds()
      return { x: bounds.x + 150, y: bounds.y + 200 }
    }
  })
  await page.getByRole('combobox', { name: '透明方式', exact: true }).selectOption('background')
  await page.getByRole('button', { name: '背景全透明，文字清晰', exact: true }).click()
  await page.getByRole('button', { name: '调整窗口透明度' }).click()
  await expect(page.locator('.app-shell')).toHaveCSS('opacity', '1')
  await expect(page.locator('.app-shell')).toHaveCSS('background-color', 'rgba(248, 246, 238, 0)')
  await expect(page.locator('.text-article')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: path.join(root, '安装包运行.png') })
  console.log('Windows 安装包检查通过：导入和阅读、整窗透明、移出恢复、背景全透明且文字清晰。')
} finally {
  await app.close()
}
