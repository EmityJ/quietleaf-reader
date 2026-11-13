import type { ReaderSettings, ReadingProgress } from '../src/shared/types'

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 20,
  lineHeight: 1.9,
  fontFamily: 'serif',
  theme: 'paper',
  transparencyMode: 'background',
  backgroundOpacity: 0.12,
  textOpacity: 1,
  windowOpacity: 1,
  autoHide: true,
  hideDelay: 500,
  alwaysOnTop: true,
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function normalizeSettings(input: Partial<ReaderSettings> = {}): ReaderSettings {
  return {
    fontSize: Math.round(clamp(input.fontSize, 14, 32, DEFAULT_SETTINGS.fontSize)),
    lineHeight: clamp(input.lineHeight, 1.3, 2.6, DEFAULT_SETTINGS.lineHeight),
    fontFamily: input.fontFamily === 'sans' ? 'sans' : 'serif',
    theme: ['paper', 'sage', 'night'].includes(input.theme ?? '') ? input.theme! : 'paper',
    transparencyMode: input.transparencyMode === 'window' ? 'window' : 'background',
    // 旧版只有整窗透明度：升级后沿用其数值作为背景透明度，恢复正文清晰度。
    backgroundOpacity: clamp(
      input.backgroundOpacity ??
        (input.transparencyMode === undefined ? input.windowOpacity : undefined),
      0,
      1,
      DEFAULT_SETTINGS.backgroundOpacity,
    ),
    textOpacity: clamp(input.textOpacity, 0.2, 1, DEFAULT_SETTINGS.textOpacity),
    windowOpacity: clamp(input.windowOpacity, 0.01, 1, DEFAULT_SETTINGS.windowOpacity),
    autoHide: typeof input.autoHide === 'boolean' ? input.autoHide : DEFAULT_SETTINGS.autoHide,
    hideDelay: Math.round(clamp(input.hideDelay, 200, 2000, DEFAULT_SETTINGS.hideDelay)),
    alwaysOnTop:
      typeof input.alwaysOnTop === 'boolean' ? input.alwaysOnTop : DEFAULT_SETTINGS.alwaysOnTop,
  }
}

export function normalizeProgress(input: ReadingProgress): ReadingProgress {
  return {
    percent: clamp(input?.percent, 0, 100, 0),
    chapterIndex: Math.floor(clamp(input?.chapterIndex, 0, 100000, 0)),
    fraction: clamp(input?.fraction, 0, 1, 0),
    ...(typeof input?.cfi === 'string' && input.cfi.length <= 4096 ? { cfi: input.cfi } : {}),
  }
}

// 移出透明与老板键隐藏分开处理，悬停只恢复前者。
export class StealthController {
  floating = false
  concealed = false
  bossHidden = false
  locked = false
  hovered = true
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private settings: Pick<ReaderSettings, 'autoHide' | 'hideDelay'>,
    private effects: { conceal(): void; reveal(): void; bossHide(): void; changed(): void },
  ) {}

  private cancel() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  configure(settings: Pick<ReaderSettings, 'autoHide' | 'hideDelay'>) {
    this.settings = settings
    this.cancel()
    if (!settings.autoHide && this.concealed) this.reveal()
    else this.schedule()
  }

  setFloating(value: boolean) {
    this.cancel()
    this.floating = value
    if (this.concealed || this.bossHidden) this.reveal()
    this.effects.changed()
  }

  setHovered(value: boolean) {
    this.hovered = value
    if (value) {
      this.cancel()
      if (this.concealed) this.reveal()
    } else this.schedule()
  }
  setLocked(value: boolean) {
    this.locked = value
    value ? this.cancel() : this.schedule()
  }

  private schedule() {
    this.cancel()
    if (
      !this.floating ||
      !this.settings.autoHide ||
      this.locked ||
      this.hovered ||
      this.concealed ||
      this.bossHidden
    )
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.concealed = true
      this.effects.conceal()
      this.effects.changed()
    }, this.settings.hideDelay)
  }

  reveal() {
    this.cancel()
    this.concealed = false
    this.bossHidden = false
    this.hovered = true
    this.effects.reveal()
    this.effects.changed()
  }

  hideByBossKey() {
    this.cancel()
    this.concealed = false
    this.bossHidden = true
    this.effects.bossHide()
    this.effects.changed()
  }

  dispose() {
    this.cancel()
  }
}
