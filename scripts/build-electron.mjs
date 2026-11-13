import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { generateIcons } from './icons.mjs'

await generateIcons()
await mkdir('dist/electron', { recursive: true })
await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    'parse-worker': 'electron/parse-worker.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  outdir: 'dist/electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
})
await copyFile('resources/icon.png', 'dist/electron/icon.png')
await copyFile('resources/tray.png', 'dist/electron/tray.png')
