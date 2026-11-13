import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { clamp } from './domain'

export const OPACITY_PROPERTY = '_NET_WM_WINDOW_OPACITY'
type XpropRunner = (args: string[]) => Promise<string>
const execute = promisify(execFile)

async function runXprop(args: string[]) {
  const { stdout } = await execute('/usr/bin/xprop', args, {
    encoding: 'utf8',
    timeout: 1500,
    maxBuffer: 64 * 1024,
  })
  return stdout
}

// 页面 alpha 不包括窗口管理器外框，X11 使用 EWMH 整窗透明度统一合成。
export class X11OpacityController {
  available = false
  private windowId = ''
  private desired?: number
  private timer?: ReturnType<typeof setTimeout>
  private writing = false
  private disposed = false

  constructor(
    private report: (message: string) => void,
    private run: XpropRunner = runXprop,
  ) {}

  async initialize(handle: Buffer, opacity: number) {
    try {
      if (handle.length < 4 || handle.readUInt32LE() === 0) throw new Error('X11 窗口句柄无效。')
      this.windowId = `0x${handle.readUInt32LE().toString(16)}`
      const supported = await this.run(['-root', '_NET_SUPPORTED'])
      if (!new RegExp(`\\b${OPACITY_PROPERTY}\\b`).test(supported)) {
        this.report('X11 窗口管理器未声明整窗透明支持，保留页面透明方式。')
        return
      }
      await this.write(opacity)
      this.available = true
      this.report('已启用 X11 整窗透明度，页面不再重复降低透明度。')
    } catch (error) {
      this.report(`X11 整窗透明度不可用，保留页面透明方式：${String(error)}`)
    }
  }

  update(opacity: number) {
    if (!this.available || this.disposed) return
    this.desired = clamp(opacity, 0.01, 1, 1)
    this.schedule()
  }

  private schedule() {
    if (this.timer || this.writing || this.disposed) return
    // 合并快速拖动滑块产生的请求，避免在飞腾处理器上连续启动大量进程。
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, 50)
  }

  private async flush() {
    const opacity = this.desired
    if (opacity === undefined || this.disposed) return
    this.desired = undefined
    this.writing = true
    try {
      await this.write(opacity)
    } catch (error) {
      // 保留现有合成方式，下次调节或恢复不透明时重试。
      this.report(`X11 整窗透明度更新失败：${String(error)}`)
    } finally {
      this.writing = false
      if (this.desired !== undefined) this.schedule()
    }
  }

  private write(opacity: number) {
    const cardinal = Math.round(clamp(opacity, 0.01, 1, 1) * 0xffffffff)
    return this.run([
      '-id',
      this.windowId,
      '-f',
      OPACITY_PROPERTY,
      '32c',
      '-set',
      OPACITY_PROPERTY,
      String(cardinal),
    ])
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.desired = undefined
  }
}
