import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
function chunk(name, data) {
  const type = Buffer.from(name)
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length)
  type.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), result.length - 4)
  return result
}
function icon(size) {
  const data = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size
      const offset = y * (size * 4 + 1) + 1 + x * 4
      const radius = 0.22
      const dx = Math.max(radius - u, 0, u - (1 - radius))
      const dy = Math.max(radius - v, 0, v - (1 - radius))
      let color = [63, 90, 67, dx * dx + dy * dy < radius * radius ? 255 : 0]
      const leftPage =
        u > 0.21 && u < 0.48 && v > 0.27 + (u - 0.21) * 0.2 && v < 0.7 + (u - 0.21) * 0.2
      const rightPage =
        u > 0.52 && u < 0.79 && v > 0.324 - (u - 0.52) * 0.2 && v < 0.754 - (u - 0.52) * 0.2
      if (leftPage || rightPage) color = [237, 241, 223, 255]
      if (
        u > 0.27 &&
        u < 0.43 &&
        (Math.abs(v - (0.42 + (u - 0.27) * 0.2)) < 0.012 ||
          Math.abs(v - (0.52 + (u - 0.27) * 0.2)) < 0.012)
      )
        color = [139, 158, 131, 255]
      if (
        u > 0.57 &&
        u < 0.73 &&
        (Math.abs(v - (0.46 - (u - 0.57) * 0.2)) < 0.012 ||
          Math.abs(v - (0.56 - (u - 0.57) * 0.2)) < 0.012)
      )
        color = [139, 158, 131, 255]
      data.set(color, offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
export async function generateIcons() {
  await mkdir('resources', { recursive: true })
  const png = icon(256)
  await writeFile('resources/icon.png', png)
  await writeFile('resources/tray.png', icon(32))
  const ico = Buffer.alloc(22)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png.length, 14)
  ico.writeUInt32LE(22, 18)
  await writeFile('resources/icon.ico', Buffer.concat([ico, png]))
}
