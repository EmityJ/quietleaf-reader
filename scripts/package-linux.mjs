import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arch = process.argv[2]
if (!['x64', 'arm64'].includes(arch)) throw new Error('请指定 Linux 架构：x64 或 arm64。')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Linux 打包命令失败：${command}，退出码 ${result.status}`)
  return result.stdout
}

// Windows 仅借助已安装的 WSL 封装 DEB，不运行目标架构程序。
if (process.platform === 'win32') {
  const linuxRoot = run('wsl.exe', ['--exec', 'wslpath', '-a', root], { encoding: 'utf8' }).trim()
  run('wsl.exe', ['--exec', 'python3', `${linuxRoot}/scripts/package-linux.py`, linuxRoot, arch], {
    stdio: 'inherit',
  })
} else if (process.platform === 'linux') {
  run('python3', [path.join(root, 'scripts/package-linux.py'), root, arch], { stdio: 'inherit' })
} else {
  throw new Error('DEB 封装需要 Linux，Windows 可使用已安装的 WSL。')
}
