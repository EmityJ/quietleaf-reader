export type BookFormat = 'txt' | 'epub'
export type Theme = 'paper' | 'sage' | 'night'

export interface ReadingProgress {
  chapterIndex?: number
  fraction?: number
  cfi?: string
  percent: number
}

export interface Chapter {
  id: string
  title: string
  start: number
  end: number
}

export interface BookRecord {
  id: string
  title: string
  author: string
  format: BookFormat
  size: number
  addedAt: string
  lastOpenedAt?: string
  progress: ReadingProgress
  chapters?: Chapter[]
  textBytes?: number
  sample?: boolean
  tone: number
}

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  fontFamily: 'serif' | 'sans'
  theme: Theme
  transparencyMode: 'background' | 'window'
  backgroundOpacity: number
  textOpacity: number
  windowOpacity: number
  autoHide: boolean
  hideDelay: number
  alwaysOnTop: boolean
}

export interface LibraryState {
  version: 1
  books: BookRecord[]
  settings: ReaderSettings
}

export interface WindowState {
  floating: boolean
  concealed: boolean
  bossHidden: boolean
  shortcutAvailable: boolean
  nativeOpacity: boolean
  autoHideAvailable?: boolean
  platform: string
  arch: string
  session: string
}

export interface BookContent {
  book: BookRecord
  bytes?: Uint8Array
}

export interface ReaderAPI {
  getLibrary(): Promise<LibraryState>
  importBooks(): Promise<{ books: BookRecord[]; errors: string[] }>
  openBook(id: string): Promise<BookContent>
  readChapter(id: string, index: number): Promise<string>
  removeBook(id: string): Promise<void>
  saveProgress(id: string, progress: ReadingProgress): Promise<void>
  saveSettings(settings: ReaderSettings): Promise<ReaderSettings>
  setFloating(value: boolean): Promise<WindowState>
  getWindowState(): Promise<WindowState>
  setHovered(value: boolean): void
  previewWindowOpacity(value: number): void
  setInteractionLock(value: boolean): void
  wakeWindow(): void
  bossHide(): void
  minimize(): void
  close(): void
  quit(): void
  onWindowState(callback: (state: WindowState) => void): () => void
  onResetOpacity(callback: () => void): () => void
}

declare global {
  interface Window {
    reader: ReaderAPI
  }
}
