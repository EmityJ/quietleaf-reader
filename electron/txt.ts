import type { Chapter } from '../src/shared/types'

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

const heading =
  /^(?:第[零〇一二三四五六七八九十百千万两\d]{1,12}[章节回卷部篇集][^\n]{0,55}|(?:序章|序言|前言|楔子|尾声|后记|终章)[^\n]{0,30}|chapter\s+\d+[^\n]{0,55})$/i

export function parseText(bytes: Uint8Array): { text: string; chapters: Chapter[] } {
  const text = decodeText(bytes)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
  if (!text.trim()) throw new Error('这份 TXT 没有可阅读的文字。')
  const boundaries: { offset: number; title: string }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const title = line.trim()
    if (heading.test(title)) boundaries.push({ offset, title })
    offset += line.length + 1
  }
  if (!boundaries.length || boundaries[0].offset > 0)
    boundaries.unshift({ offset: 0, title: boundaries.length ? '开篇' : '正文' })
  const chunks: { text: string; title: string }[] = []
  for (let index = 0; index < boundaries.length; index++) {
    let section = text.slice(boundaries[index].offset, boundaries[index + 1]?.offset ?? text.length)
    let part = 1
    while (section.length) {
      let cut = Math.min(section.length, 18000)
      if (cut < section.length) {
        const newline = section.lastIndexOf('\n', cut)
        if (newline > cut / 2) cut = newline + 1
        // 分块不能切开 UTF-16 代理对，否则 UTF-8 字节索引会失效。
        else if (/[\uD800-\uDBFF]/.test(section[cut - 1])) cut--
      }
      chunks.push({
        text: section.slice(0, cut),
        title: boundaries[index].title + (part > 1 ? ` · 续 ${part}` : ''),
      })
      section = section.slice(cut)
      part++
    }
  }
  let byteOffset = 0
  const chapters = chunks.map((chunk, index) => {
    const start = byteOffset
    byteOffset += Buffer.byteLength(chunk.text, 'utf8')
    return { id: `chapter-${index}`, title: chunk.title, start, end: byteOffset }
  })
  return { text, chapters }
}
