import { parentPort } from 'node:worker_threads'
import { parseText } from './txt'

parentPort?.on('message', (bytes: Uint8Array) => {
  try {
    parentPort?.postMessage({ result: parseText(bytes) })
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : '解析 TXT 失败。' })
  }
})
