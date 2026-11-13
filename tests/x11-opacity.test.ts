import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { OPACITY_PROPERTY, X11OpacityController } from '../electron/x11-opacity'

function handle() {
  const value = Buffer.alloc(8)
  value.writeUInt32LE(0x123456)
  return value
}

test('X11 使用实际窗口句柄和 32 位整窗透明度，1% 与恢复 100% 不重复淡化', async () => {
  const requests: string[][] = []
  const adapter = new X11OpacityController(
    () => {},
    async (args) => {
      requests.push(args)
      return args[0] === '-root' ? `_NET_SUPPORTED(ATOM) = ${OPACITY_PROPERTY}` : ''
    },
  )
  try {
    await adapter.initialize(handle(), 0.24)
    assert.equal(adapter.available, true)
    assert.deepEqual(requests[1], [
      '-id',
      '0x123456',
      '-f',
      OPACITY_PROPERTY,
      '32c',
      '-set',
      OPACITY_PROPERTY,
      '1030792151',
    ])
    adapter.update(0.01)
    await delay(90)
    assert.equal(requests.at(-1)!.at(-1), '42949673')
    adapter.update(1)
    await delay(90)
    assert.equal(requests.at(-1)!.at(-1), '4294967295')
  } finally {
    adapter.dispose()
  }
})

test('缺少 xprop 或窗口管理器不支持时保留页面透明度', async () => {
  for (const mode of ['missing', 'unsupported']) {
    const logs: string[] = []
    const adapter = new X11OpacityController(
      (message) => logs.push(message),
      async () => {
        if (mode === 'missing') throw new Error('ENOENT')
        return '_NET_SUPPORTED(ATOM) = _NET_WM_NAME'
      },
    )
    await adapter.initialize(handle(), 0.24)
    assert.equal(adapter.available, false)
    assert.equal(logs.length, 1)
    adapter.dispose()
  }
})

test('滑块请求合并并按顺序写入，较慢的旧请求不会覆盖最终值', async () => {
  const values: string[] = []
  let writing = 0
  let peak = 0
  const adapter = new X11OpacityController(
    () => {},
    async (args) => {
      if (args[0] === '-root') return OPACITY_PROPERTY
      peak = Math.max(peak, ++writing)
      values.push(args.at(-1)!)
      await delay(60)
      writing--
      return ''
    },
  )
  try {
    await adapter.initialize(handle(), 1)
    adapter.update(0.5)
    adapter.update(0.3)
    await delay(65)
    adapter.update(0.01)
    adapter.update(0.24)
    await delay(200)
    assert.equal(peak, 1)
    assert.equal(values.at(-1), String(Math.round(0.24 * 0xffffffff)))
    assert.ok(values.length <= 3)
  } finally {
    adapter.dispose()
  }
})

test('退出时取消尚未写入的透明度请求', async () => {
  let writes = 0
  const adapter = new X11OpacityController(
    () => {},
    async (args) => {
      if (args[0] === '-root') return OPACITY_PROPERTY
      writes++
      return ''
    },
  )
  await adapter.initialize(handle(), 1)
  adapter.update(0.01)
  adapter.dispose()
  await delay(90)
  assert.equal(writes, 1)
})
