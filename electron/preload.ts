import { contextBridge, ipcRenderer } from 'electron'
import type { ReaderAPI, WindowState } from '../src/shared/types'

const api: ReaderAPI = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  importBooks: () => ipcRenderer.invoke('library:import'),
  openBook: (id) => ipcRenderer.invoke('book:open', id),
  readChapter: (id, index) => ipcRenderer.invoke('book:chapter', id, index),
  removeBook: (id) => ipcRenderer.invoke('book:remove', id),
  saveProgress: (id, progress) => ipcRenderer.invoke('book:progress', id, progress),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setFloating: (value) => ipcRenderer.invoke('window:floating', value),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  setHovered: (value) => ipcRenderer.send('window:hover', value),
  previewWindowOpacity: (value) => ipcRenderer.send('window:opacity', value),
  setInteractionLock: (value) => ipcRenderer.send('window:lock', value),
  wakeWindow: () => ipcRenderer.send('window:wake'),
  bossHide: () => ipcRenderer.send('window:boss'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.send('window:quit'),
  onWindowState: (callback) => {
    const listener = (_event: unknown, state: WindowState) => callback(state)
    ipcRenderer.on('window:changed', listener)
    return () => ipcRenderer.removeListener('window:changed', listener)
  },
  onResetOpacity: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window:reset-opacity', listener)
    return () => ipcRenderer.removeListener('window:reset-opacity', listener)
  },
}

// 电子书的子框架不应拿到本机文件读写接口。
if (process.isMainFrame) contextBridge.exposeInMainWorld('reader', api)
