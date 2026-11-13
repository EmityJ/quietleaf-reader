import type { ReaderSettings } from './types'

// 背景模式保持整窗不透明，只在绘制背景与正文时分别使用 alpha。
export function effectiveWindowOpacity(
  settings: Pick<ReaderSettings, 'transparencyMode' | 'windowOpacity'>,
) {
  return settings.transparencyMode === 'background' ? 1 : settings.windowOpacity
}
