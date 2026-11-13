import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  Tray,
} from 'electron'
import type { IpcMainInvokeEvent, Rectangle } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { appendFile } from 'node:fs/promises'
import { LibraryStore } from './store'
import { StealthController } from './domain'
import { X11OpacityController } from './x11-opacity'
import { effectiveWindowOpacity } from '../src/shared/transparency'
import type { WindowState, ReaderSettings, ReadingProgress } from '../src/shared/types'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'quietleaf',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])
if (process.env.QUIETLEAF_USER_DATA)
  app.setPath('userData', path.resolve(process.env.QUIETLEAF_USER_DATA))
const x11Session =
  process.platform === 'linux' &&
  Boolean(process.env.DISPLAY) &&
  (process.env.XDG_SESSION_TYPE === 'x11' || !process.env.WAYLAND_DISPLAY)
if (x11Session) app.commandLine.appendSwitch('ozone-platform', 'x11')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
if (devUrl && new URL(devUrl).origin !== 'http://127.0.0.1:5173')
  throw new Error('开发服务器地址无效。')
let mainWindow: BrowserWindow
let hoverTimer: ReturnType<typeof setInterval> | undefined
let visibleHoverTimer: ReturnType<typeof setInterval> | undefined
let x11Opacity: X11OpacityController | undefined
let tray: Tray | undefined
let store: LibraryStore
let stealth: StealthController
let quitting = false
let shortcutAvailable = false
let rendererLocked = false
let dialogLocked = false
let persistedBeforeQuit = false
let normalBounds: Rectangle | undefined
let floatingBounds: Rectangle | undefined
const shortcut = 'CommandOrControl+Shift+Space'

function state(): WindowState {
  return {
    floating: stealth.floating,
    concealed: stealth.concealed,
    bossHidden: stealth.bossHidden,
    shortcutAvailable,
    nativeOpacity: x11Opacity?.available ?? false,
    platform: process.platform,
    arch: process.arch,
    session: process.env.XDG_SESSION_TYPE || (process.platform === 'win32' ? 'Windows' : '未知'),
  }
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('window:changed', state())
}

function trusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
    throw new Error('不允许子页面访问本机接口。')
  if (event.sender !== mainWindow.webContents) throw new Error('请求来源无效。')
  const url = new URL(event.senderFrame.url)
  if (
    devUrl
      ? url.origin !== new URL(devUrl).origin
      : url.protocol !== 'quietleaf:' || url.host !== 'reader'
  )
    throw new Error('请求地址无效。')
}

function secureWindow(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => {
    void log(`阅读进程退出：${details.reason}`)
  })
}

async function log(message: string) {
  try {
    await appendFile(
      path.join(app.getPath('userData'), 'reader.log'),
      `${new Date().toISOString()} ${message}\n`,
    )
  } catch {
    /* 日志失败不阻塞关闭。 */
  }
}

function stopHoverWatch() {
  clearInterval(hoverTimer)
  hoverTimer = undefined
}

function stopVisibleHoverWatch() {
  clearInterval(visibleHoverTimer)
  visibleHoverTimer = undefined
}

function syncVisibleHoverWatch() {
  stopVisibleHoverWatch()
  if (
    !(process.platform === 'win32' || x11Session) ||
    !stealth.floating ||
    stealth.concealed ||
    stealth.bossHidden ||
    !store.state.settings.autoHide ||
    store.state.settings.transparencyMode !== 'background'
  )
    return
  // 全透明背景可能把鼠标事件交给底下的窗口，改用几何区域判断真实移入移出。
  visibleHoverTimer = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      stopVisibleHoverWatch()
      return
    }
    const point = screen.getCursorScreenPoint()
    const bounds = mainWindow.getBounds()
    const inside =
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height
    if (inside !== stealth.hovered) stealth.setHovered(inside)
  }, 100)
}

function watchConcealedWindow() {
  stopHoverWatch()
  stopVisibleHoverWatch()
  const originalBounds = mainWindow.getBounds()
  // Linux 真正隐藏原生窗口，移除合成器外框；恢复使用隐藏前的区域。
  if (x11Session) mainWindow.hide()
  hoverTimer = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      stopHoverWatch()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const bounds = x11Session ? originalBounds : mainWindow.getBounds()
    if (
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height
    )
      stealth.setHovered(true)
  }, 100)
}

function fitBounds(bounds: Rectangle) {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  }
}

function changeFloating(value: boolean) {
  if (value === stealth.floating) return state()
  const bounds = mainWindow.getBounds()
  if (value) normalBounds = bounds
  else floatingBounds = bounds
  stealth.setFloating(value)
  mainWindow.setMinimumSize(value ? 320 : 850, value ? 380 : 580)
  mainWindow.setBounds(
    fitBounds(
      value
        ? floatingBounds || {
            x: bounds.x + bounds.width - 450,
            y: bounds.y + 40,
            width: 450,
            height: 620,
          }
        : normalBounds || { ...bounds, width: 1180, height: 780 },
    ),
  )
  mainWindow.setAlwaysOnTop(value && store.state.settings.alwaysOnTop)
  mainWindow.show()
  syncVisibleHoverWatch()
  broadcast()
  return state()
}

function parseInWorker(bytes: Uint8Array) {
  return new Promise<ReturnType<typeof import('./txt').parseText>>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'parse-worker.cjs'))
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('TXT 解析超时，请尝试较小的文件。'))
    }, 30000)
    worker.once('message', (message) => {
      clearTimeout(timer)
      void worker.terminate()
      message.error ? reject(new Error(message.error)) : resolve(message.result)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.postMessage(bytes)
  })
}

async function boot() {
  store = new LibraryStore(app.getPath('userData'), parseInWorker)
  await store.init()
  const rendererRoot = path.resolve(__dirname, '../renderer')
  protocol.handle('quietleaf', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'reader') return new Response('无效地址', { status: 403 })
    const target = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname))
    const relative = path.relative(rendererRoot, target)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      return new Response('无效路径', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const fileRelative =
      url.protocol === 'file:' ? path.relative(rendererRoot, fileURLToPath(url)) : undefined
    const isAppFile =
      fileRelative !== undefined && !fileRelative.startsWith('..') && !path.isAbsolute(fileRelative)
    const allowed =
      ['quietleaf:', 'blob:', 'data:', 'devtools:'].includes(url.protocol) ||
      isAppFile ||
      Boolean(devUrl && (url.origin === devUrl || url.origin === 'ws://127.0.0.1:5173'))
    callback({ cancel: !allowed })
  })
  const preload = path.join(__dirname, 'preload.cjs')
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 850,
    minHeight: 580,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    title: '隐页阅读',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  })
  secureWindow(mainWindow)
  stealth = new StealthController(store.state.settings, {
    conceal: watchConcealedWindow,
    reveal: () => {
      stopHoverWatch()
      if (!mainWindow.isVisible()) mainWindow.showInactive()
      syncVisibleHoverWatch()
    },
    bossHide: () => {
      stopHoverWatch()
      stopVisibleHoverWatch()
      if (tray || shortcutAvailable) mainWindow.hide()
      else mainWindow.minimize()
    },
    changed: broadcast,
  })

  const handle = (name: string, handler: (...args: any[]) => unknown) => {
    ipcMain.handle(name, (event, ...args) => {
      trusted(event)
      return handler(...args)
    })
  }
  handle('library:get', () => store.state)
  handle('library:import', async () => {
    dialogLocked = true
    stealth.setLocked(true)
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '添加到书架',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '电子书', extensions: ['epub', 'txt'] }],
      })
      const books = []
      const errors = []
      for (const filePath of result.filePaths) {
        try {
          books.push(await store.importFile(filePath))
        } catch (error) {
          errors.push(
            `${path.basename(filePath)}：${error instanceof Error ? error.message : '导入失败。'}`,
          )
        }
      }
      return { books, errors }
    } finally {
      dialogLocked = false
      stealth.setLocked(rendererLocked)
    }
  })
  handle('book:open', (id: string) => store.openBook(id))
  handle('book:chapter', (id: string, index: number) => store.readChapter(id, index))
  handle('book:remove', (id: string) => store.removeBook(id))
  handle('book:progress', (id: string, progress: ReadingProgress) =>
    store.saveProgress(id, progress),
  )
  handle('settings:save', async (settings: ReaderSettings) => {
    const saved = await store.saveSettings(settings)
    x11Opacity?.update(effectiveWindowOpacity(saved))
    stealth.configure(saved)
    mainWindow.setAlwaysOnTop(stealth.floating && saved.alwaysOnTop)
    syncVisibleHoverWatch()
    return saved
  })
  handle('window:floating', (value: boolean) => changeFloating(value === true))
  handle('window:state', state)
  const on = (name: string, handler: (...args: any[]) => void) =>
    ipcMain.on(name, (event, ...args) => {
      try {
        trusted(event)
        handler(...args)
      } catch (error) {
        void log(String(error))
      }
    })
  on('window:hover', (value) => {
    if (!visibleHoverTimer) stealth.setHovered(value === true)
  })
  on('window:opacity', (value) => x11Opacity?.update(value))
  on('window:lock', (value) => {
    rendererLocked = value === true
    stealth.setLocked(rendererLocked || dialogLocked)
  })
  on('window:wake', () => stealth.reveal())
  on('window:boss', () => stealth.hideByBossKey())
  on('window:minimize', () => mainWindow.minimize())
  on('window:close', () => mainWindow.close())
  on('window:quit', () => app.quit())
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault()
      stealth.hideByBossKey()
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  shortcutAvailable = globalShortcut.register(shortcut, () => {
    if (stealth.concealed || !mainWindow.isVisible() || mainWindow.isMinimized()) {
      stealth.reveal()
      mainWindow.restore()
      mainWindow.focus()
    } else stealth.hideByBossKey()
  })
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')))
    tray.setToolTip('隐页阅读 · Ctrl+Shift+Space 显示或隐藏')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开隐页',
          click: () => {
            stealth.reveal()
            mainWindow.restore()
            mainWindow.focus()
          },
        },
        { label: '退出悬浮模式', click: () => changeFloating(false) },
        {
          label: '恢复不透明并显示',
          click: () => {
            x11Opacity?.update(1)
            mainWindow.webContents.send('window:reset-opacity')
            stealth.reveal()
            mainWindow.restore()
            mainWindow.focus()
          },
        },
        { type: 'separator' },
        { label: '退出应用', click: () => app.quit() },
      ]),
    )
    tray.on('click', () => {
      stealth.reveal()
      mainWindow.restore()
      mainWindow.focus()
    })
  } catch (error) {
    void log(`托盘不可用：${String(error)}`)
  }

  if (x11Session) {
    x11Opacity = new X11OpacityController((message) => {
      void log(message)
    })
    await x11Opacity.initialize(
      mainWindow.getNativeWindowHandle(),
      effectiveWindowOpacity(store.state.settings),
    )
  }
  await mainWindow.loadURL(devUrl || 'quietleaf://reader/index.html')
  void log(`启动 ${JSON.stringify(state())} Electron ${process.versions.electron}`)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      stealth.reveal()
      mainWindow.restore()
      mainWindow.focus()
    }
  })
  app
    .whenReady()
    .then(boot)
    .catch(async (error) => {
      await log(`启动失败：${String(error)}`)
      dialog.showErrorBox('隐页无法启动', String(error))
      app.quit()
    })
}
app.on('before-quit', (event) => {
  quitting = true
  stopHoverWatch()
  stopVisibleHoverWatch()
  x11Opacity?.dispose()
  stealth?.dispose()
  if (store && !persistedBeforeQuit) {
    event.preventDefault()
    void store
      .persist()
      .catch((error) => log(`退出时保存失败：${String(error)}`))
      .finally(() => {
        persistedBeforeQuit = true
        app.quit()
      })
  }
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray?.destroy()
})
app.on('window-all-closed', () => app.quit())
