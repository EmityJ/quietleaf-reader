import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const systemDlls = new Set(
  `advapi32 bcrypt bcryptprimitives cabinet cfgmgr32 comctl32 combase comdlg32 crypt32
   cryptbase cryptsp d2d1 d3d11 dcomp dbghelp dnsapi dwmapi dwrite dxgi gdi32 gdiplus hid
   imm32 iphlpapi kernel32 kernelbase mf mfplat mfuuid mpr msimg32 msvcrt ncrypt netapi32
   normaliz ntdll ole32 oleacc oleaut32 opengl32 powrprof propsys psapi rpcrt4 secur32
   setupapi shell32 shcore shlwapi user32 userenv ucrtbase usp10 uxtheme version winhttp
   wininet winmm winscard winspool ws2_32 wtsapi32`
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => `${name}.dll`),
)

// 从 PE 导入表读取实际 DLL 依赖，不依赖开发机 PATH 或额外安装的分析工具。
export function inspectWindowsImage(bytes) {
  const requireRange = (offset, size) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length)
      throw new Error('Windows PE 文件格式异常。')
  }
  requireRange(0, 64)
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('不是 Windows PE 文件。')
  const pe = bytes.readUInt32LE(0x3c)
  requireRange(pe, 24)
  if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Windows PE 签名无效。')
  const arch = { 0x14c: 'ia32', 0x8664: 'x64', 0xaa64: 'arm64' }[bytes.readUInt16LE(pe + 4)]
  if (!arch) throw new Error('不支持的 Windows PE 架构。')
  const optional = pe + 24
  const optionalSize = bytes.readUInt16LE(pe + 20)
  requireRange(optional, optionalSize)
  const magic = bytes.readUInt16LE(optional)
  if (![0x10b, 0x20b].includes(magic)) throw new Error('不支持的 Windows PE 可选头。')
  const directories = optional + (magic === 0x20b ? 112 : 96)
  requireRange(optional, magic === 0x20b ? 112 : 96)
  const count = bytes.readUInt32LE(directories - 4)
  const imageBase =
    magic === 0x20b
      ? Number(bytes.readBigUInt64LE(optional + 24))
      : bytes.readUInt32LE(optional + 28)
  const sections = []
  for (let index = 0; index < bytes.readUInt16LE(pe + 6); index++) {
    const section = optional + optionalSize + index * 40
    requireRange(section, 40)
    sections.push({
      rva: bytes.readUInt32LE(section + 12),
      size: bytes.readUInt32LE(section + 16),
      offset: bytes.readUInt32LE(section + 20),
    })
  }
  const locate = (rva, size = 1) => {
    if (rva < bytes.readUInt32LE(optional + 60)) {
      requireRange(rva, size)
      return rva
    }
    const section = sections.find((s) => rva >= s.rva && rva + size <= s.rva + s.size)
    if (!section) throw new Error('Windows PE 导入表地址无效。')
    const offset = section.offset + rva - section.rva
    requireRange(offset, size)
    return offset
  }
  const imports = new Map()
  for (const [directory, descriptorSize, nameOffset] of [
    [1, 20, 12],
    [13, 32, 4],
  ]) {
    if (directory >= count || directories + (directory + 1) * 8 > optional + optionalSize) continue
    const rva = bytes.readUInt32LE(directories + directory * 8)
    const size = bytes.readUInt32LE(directories + directory * 8 + 4)
    if (!rva || !size) continue
    let terminated = false
    for (let index = 0; index < Math.min(Math.floor(size / descriptorSize), 4096); index++) {
      const offset = locate(rva + index * descriptorSize, descriptorSize)
      if (bytes.subarray(offset, offset + descriptorSize).every((byte) => byte === 0)) {
        terminated = true
        break
      }
      let nameRva = bytes.readUInt32LE(offset + nameOffset)
      if (directory === 13 && !(bytes.readUInt32LE(offset) & 1)) nameRva -= imageBase
      const start = locate(nameRva)
      const end = bytes.indexOf(0, start)
      if (end < start || end - start > 255) throw new Error('Windows DLL 名称无效。')
      locate(nameRva, end - start + 1)
      const name = bytes.toString('ascii', start, end)
      if (!/^[a-z0-9_.-]+\.dll$/i.test(name)) throw new Error('Windows DLL 名称无效。')
      imports.set(name.toLowerCase(), name)
    }
    if (!terminated) throw new Error('Windows PE 导入表没有终止记录。')
  }
  return { arch, imports: [...imports.values()] }
}

export async function collectWindowsRuntime(directory, executable, bytes) {
  const image = inspectWindowsImage(bytes)
  const files = new Map(
    (await readdir(directory, { withFileTypes: true }))
      .filter((f) => f.isFile() && /\.dll$/i.test(f.name))
      .map((f) => [f.name.toLowerCase(), f.name]),
  )
  const bundled = new Map()
  const imports = { [executable]: image.imports }
  const pending = [...image.imports]
  for (const name of pending) {
    const key = name.toLowerCase()
    if (systemDlls.has(key) || /^(?:api|ext)-ms-/i.test(name) || bundled.has(key)) continue
    const file = files.get(key)
    if (!file)
      throw new Error(
        `Windows 发布包缺少 ${name}。请重新构建或将依赖放入构建目录，不能发布不完整的压缩包。`,
      )
    const content = await readFile(path.join(directory, file))
    const dependency = inspectWindowsImage(content)
    if (dependency.arch !== image.arch) throw new Error(`${file} 与主程序的架构不一致。`)
    bundled.set(key, { name: file, bytes: content })
    imports[file] = dependency.imports
    pending.push(...dependency.imports)
  }
  return { arch: image.arch, dlls: [...bundled.values()], imports }
}
