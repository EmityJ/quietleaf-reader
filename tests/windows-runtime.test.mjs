import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { collectWindowsRuntime, inspectWindowsImage } from '../scripts/windows-runtime.mjs'

// 最小 PE 样本同时包含普通和延迟导入，避免测试依赖本机 Rust 编译结果。
function fixture(imports = [], delayed = [], machine = 0x8664) {
  const bytes = Buffer.alloc(4096)
  bytes.writeUInt16LE(0x5a4d, 0)
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.writeUInt32LE(0x4550, 0x80)
  bytes.writeUInt16LE(machine, 0x84)
  bytes.writeUInt16LE(1, 0x86)
  bytes.writeUInt16LE(240, 0x94)
  const optional = 0x98
  bytes.writeUInt16LE(0x20b, optional)
  bytes.writeBigUInt64LE(0x140000000n, optional + 24)
  bytes.writeUInt32LE(512, optional + 60)
  bytes.writeUInt32LE(16, optional + 108)
  const section = optional + 240
  bytes.writeUInt32LE(3584, section + 8)
  bytes.writeUInt32LE(4096, section + 12)
  bytes.writeUInt32LE(3584, section + 16)
  bytes.writeUInt32LE(512, section + 20)
  let nameOffset = 2048
  for (const [names, directory, offset, stride, nameField] of [
    [imports, 1, 512, 20, 12],
    [delayed, 13, 1024, 32, 4],
  ]) {
    if (!names.length) continue
    bytes.writeUInt32LE(offset + 3584, optional + 112 + directory * 8)
    bytes.writeUInt32LE((names.length + 1) * stride, optional + 116 + directory * 8)
    names.forEach((name, index) => {
      if (directory === 13) bytes.writeUInt32LE(1, offset + index * stride)
      bytes.writeUInt32LE(nameOffset + 3584, offset + index * stride + nameField)
      nameOffset += bytes.write(`${name}\0`, nameOffset, 'ascii')
    })
  }
  return bytes
}

async function temporary(t) {
  const base = path.resolve('.test-data', 'windows-runtime')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'case-'))
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(base + path.sep))
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

test('读取普通与延迟 DLL 导入，大小写不同的重复依赖只保留一份', () => {
  assert.deepEqual(
    inspectWindowsImage(
      fixture(['KERNEL32.dll', 'WebView2Loader.dll'], ['kernel32.dll', 'ole32.dll']),
    ),
    { arch: 'x64', imports: ['kernel32.dll', 'WebView2Loader.dll', 'ole32.dll'] },
  )
  assert.throws(() => inspectWindowsImage(Buffer.from('不是 PE')), /PE/)
})

test('缺少 WebView2Loader.dll 时阻止打包', async (t) => {
  const directory = await temporary(t)
  await assert.rejects(
    collectWindowsRuntime(directory, 'reader.exe', fixture(['WebView2Loader.dll'])),
    /缺少 WebView2Loader.dll/,
  )
})

test('递归收集依赖且不打包系统 DLL 或无关文件', async (t) => {
  const directory = await temporary(t)
  await writeFile(
    path.join(directory, 'WebView2Loader.dll'),
    fixture(['KERNEL32.dll'], ['helper.dll']),
  )
  await writeFile(path.join(directory, 'helper.dll'), fixture(['ole32.dll', 'WebView2Loader.dll']))
  await writeFile(path.join(directory, 'unrelated.dll'), Buffer.from('不应读取'))
  const runtime = await collectWindowsRuntime(
    directory,
    'reader.exe',
    fixture(['WebView2Loader.dll', 'api-ms-win-core-synch-l1-2-0.dll']),
  )
  assert.deepEqual(
    runtime.dlls.map((dll) => dll.name),
    ['WebView2Loader.dll', 'helper.dll'],
  )
  assert.deepEqual(runtime.imports['helper.dll'], ['ole32.dll', 'WebView2Loader.dll'])
})

test('拒绝打包与 EXE 架构不同的 DLL', async (t) => {
  const directory = await temporary(t)
  await writeFile(path.join(directory, 'WebView2Loader.dll'), fixture([], [], 0xaa64))
  await assert.rejects(
    collectWindowsRuntime(directory, 'reader.exe', fixture(['WebView2Loader.dll'])),
    /架构不一致/,
  )
})

test('静态链接加载器的构建不要求附加 DLL', async (t) => {
  const directory = await temporary(t)
  const runtime = await collectWindowsRuntime(directory, 'reader.exe', fixture(['KERNEL32.dll']))
  assert.equal(runtime.dlls.length, 0)
})
