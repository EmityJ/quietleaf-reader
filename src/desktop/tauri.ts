import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { BookContent, ReaderAPI, WindowState } from '../shared/types'

export async function installTauriBridge(): Promise<void> {
  if (!isTauri() || window !== window.top) return

  const windowListeners = new Set<(state: WindowState) => void>()
  const resetListeners = new Set<() => void>()
  await listen<WindowState>('window:changed', ({ payload }) => {
    for (const callback of windowListeners) callback(payload)
  })
  await listen('window:reset-opacity', () => {
    for (const callback of resetListeners) callback()
  })

  const request = <T>(action: string, payload: unknown = null): Promise<T> =>
    invoke<T>('reader_command', { action, payload }).catch((error: unknown) => {
      throw new Error(String(error))
    })

  // 数据操作按发起顺序提交，关闭窗口之前等待尚未完成的进度和设置写入。
  let pending: Promise<unknown> = Promise.resolve()
  const data = <T>(action: string, payload: unknown = null): Promise<T> => {
    const operation = pending.catch(() => {}).then(() => request<T>(action, payload))
    pending = operation
    return operation
  }
  const send = (action: string, payload: unknown = null) => {
    void request(`window:${action}`, payload).catch((error: unknown) => {
      globalThis.dispatchEvent(new CustomEvent('reader:error', { detail: String(error) }))
    })
  }
  const finish = (action: string) => {
    void pending
      .catch(() => {})
      .then(() => request(`window:${action}`))
      .catch((error: unknown) => {
        globalThis.dispatchEvent(new CustomEvent('reader:error', { detail: String(error) }))
      })
  }

  const api: ReaderAPI = {
    getLibrary: () => data('library:get'),
    importBooks: () => data('library:import'),
    async openBook(id) {
      const content = await data<BookContent>('book:open', { id })
      if (content.book.format === 'epub') {
        const bytes = await invoke<ArrayBuffer | number[]>('read_epub', { id })
        content.bytes = new Uint8Array(bytes)
      }
      return content
    },
    readChapter: (id, index) => data('book:chapter', { id, index }),
    removeBook: (id) => data('book:remove', { id }),
    saveProgress: (id, progress) => data('book:progress', { id, progress }),
    saveSettings: (settings) => data('settings:save', settings),
    setFloating: (value) => request('window:floating', value),
    getWindowState: () => request('window:state'),
    setHovered: (value) => send('hover', value),
    previewWindowOpacity: (value) => send('opacity', value),
    setInteractionLock: (value) => send('lock', value),
    wakeWindow: () => send('wake'),
    bossHide: () => finish('boss'),
    minimize: () => send('minimize'),
    close: () => finish('close'),
    quit: () => finish('quit'),
    onWindowState(callback) {
      windowListeners.add(callback)
      return () => windowListeners.delete(callback)
    },
    onResetOpacity(callback) {
      resetListeners.add(callback)
      return () => resetListeners.delete(callback)
    },
  }
  Object.defineProperty(window, 'reader', { value: api, configurable: false, writable: false })

  // WebKitGTK 不识别 Electron 的 app-region，通过桌面后端启动原生拖动。
  document.addEventListener('pointerdown', (event) => {
    const target = event.target
    if (
      event.button === 0 &&
      target instanceof Element &&
      target.closest('.titlebar-drag') &&
      !target.closest('button, input, select, a')
    ) {
      event.preventDefault()
      send('drag')
    }
  })
}
