import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { collectWindowsRuntime } from './windows-runtime.mjs'

const root = process.cwd()
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const target = process.argv[2]
if (target && !['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu'].includes(target))
  throw new Error('不支持的 Rust 发布架构。')
if (!['win32', 'linux'].includes(process.platform))
  throw new Error('当前只提供 Windows 和 Linux 打包。')
const platform = process.platform === 'win32' ? 'win' : 'linux'
const arch = target?.startsWith('aarch64') ? 'arm64' : target ? 'x64' : process.arch
const executable = platform === 'win' ? 'quietleaf-rust.exe' : 'quietleaf-rust'
const buildDirectory = path.join(root, 'target', ...(target ? [target] : []), 'release')
const bytes = await readFile(path.join(buildDirectory, executable))
const output = path.join(root, 'release', 'rust', version)
await mkdir(output, { recursive: true })
const stem = `quietleaf-rust-${version}-${platform}-${arch}`
const instructions = `隐页阅读 Rust ${version}\n\n请完整解压后运行 ${executable}，EXE 和随附 DLL 必须保留在同一目录，不能只复制 EXE。\n书架位于独立的 local.quietleaf.reader.rust 配置目录。首次启动会复制旧版 quietleaf-reader 书架，旧版数据保持不变。\nWindows 需要 Microsoft Edge WebView2 Runtime。WebView2Loader.dll 是随应用分发的加载器，与系统 WebView2 Runtime 不同；GNU 构建的压缩包已附带该 DLL。\nUOS/Linux 需要 WebKitGTK 4.1、GTK 3 和 Ayatana AppIndicator；便携包仍依赖系统动态库。\nUOS ARM64 的目标为专业版 1070、飞腾 FT-2000、X11。\n`
const artifacts = []
const report = { version, platform, arch, target: target || 'native', bytes: bytes.length }
if (platform === 'win') {
  const runtime = await collectWindowsRuntime(buildDirectory, executable, bytes)
  if (runtime.arch !== arch) throw new Error('Windows 可执行文件的架构与发布架构不一致。')
  const zip = new JSZip()
  zip.file(executable, bytes)
  for (const dll of runtime.dlls) zip.file(dll.name, dll.bytes)
  zip.file('使用说明.txt', instructions)
  report.windowsImports = runtime.imports
  report.bundledDlls = runtime.dlls.map((dll) => ({
    name: dll.name,
    bytes: dll.bytes.length,
    sha256: createHash('sha256').update(dll.bytes).digest('hex'),
  }))
  const file = path.join(output, `${stem}.zip`)
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  artifacts.push(file)
} else {
  const machine =
    bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      ? bytes.readUInt16LE(18)
      : 0
  if (machine !== (arch === 'arm64' ? 183 : 62))
    throw new Error('可执行文件的 ELF 架构与发布架构不一致。')
  const symbols = spawnSync('readelf', ['--version-info', path.join(buildDirectory, executable)], {
    encoding: 'utf8',
  })
  if (symbols.status !== 0) throw new Error('请安装 binutils，使用 readelf 记录运行库要求。')
  report.glibcMinimum = [...new Set(symbols.stdout.match(/GLIBC_\d+(?:\.\d+)+/g) || [])]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .at(-1)
  const staging = path.join(output, stem)
  await mkdir(staging, { recursive: true })
  await copyFile(path.join(buildDirectory, executable), path.join(staging, executable))
  await writeFile(path.join(staging, '使用说明.txt'), instructions)
  const tar = path.join(output, `${stem}.tar.gz`)
  const packed = spawnSync('tar', ['-czf', tar, '-C', output, stem], { stdio: 'inherit' })
  if (packed.status !== 0) throw new Error('生成 Rust 便携包失败。')
  artifacts.push(tar)
  const bundle = path.join(buildDirectory, 'bundle', 'deb')
  const { readdir } = await import('node:fs/promises')
  if (existsSync(bundle)) {
    const expected = arch === 'arm64' ? '_arm64.deb' : '_amd64.deb'
    const debs = (await readdir(bundle)).filter(
      (name) => name.endsWith(expected) && name.includes(`_${version}_`),
    )
    if (debs.length !== 1) throw new Error('DEB 目录中没有唯一匹配的安装包。')
    const destination = path.join(output, `${stem}.deb`)
    await copyFile(path.join(bundle, debs[0]), destination)
    artifacts.push(destination)
  } else throw new Error('缺少 DEB，请先执行对应架构的 tauri build --bundles deb。')
}
const hashes = await Promise.all(
  artifacts.map(
    async (file) =>
      `${createHash('sha256')
        .update(await readFile(file))
        .digest('hex')}  ${path.basename(file)}`,
  ),
)
await writeFile(path.join(output, `${stem}.sha256`), hashes.join('\n') + '\n')
await writeFile(path.join(output, `${stem}-build.json`), JSON.stringify(report, null, 2) + '\n')
for (const artifact of artifacts) process.stdout.write(`${artifact}\n`)
