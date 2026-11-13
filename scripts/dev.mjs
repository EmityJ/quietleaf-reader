import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'
import './build-electron.mjs'

const server = await createServer()
await server.listen()
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true })
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  child.kill()
  await server.close()
}
child.on('exit', async (code) => {
  await stop()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => {
  void stop()
})
process.on('SIGTERM', () => {
  void stop()
})
