import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

// 先检查中央目录中的尺寸，再解压 XML，避免错误书籍耗尽内存。
export async function inspectEpub(bytes: Uint8Array): Promise<{ title: string; author: string }> {
  const zip = await JSZip.loadAsync(bytes)
  const files = Object.values(zip.files).filter((file) => !file.dir)
  if (files.length > 3000) throw new Error('这本 EPUB 包含过多文件，暂不支持。')
  let total = 0
  for (const file of files) {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize
    if (typeof size !== 'number' || size > 32 * 1024 * 1024)
      throw new Error('EPUB 内部文件过大或格式异常。')
    total += size
  }
  if (total > 160 * 1024 * 1024) throw new Error('EPUB 解压后的内容过大，暂不支持。')
  const readXml = async (name: string) => {
    const file = zip.file(name)
    if (!file) throw new Error('EPUB 缺少必要的目录文件。')
    const xml = await file.async('string')
    if (xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('EPUB 的目录 XML 格式不受支持。')
    return new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      processEntities: false,
    }).parse(xml)
  }
  const container = await readXml('META-INF/container.xml')
  const roots = container?.container?.rootfiles?.rootfile
  const packagePath = (Array.isArray(roots) ? roots[0] : roots)?.['@_full-path']
  if (typeof packagePath !== 'string' || packagePath.includes('..') || packagePath.startsWith('/'))
    throw new Error('EPUB 的内容路径无效。')
  const data = await readXml(packagePath)
  if (!data?.package?.spine || !data.package.manifest)
    throw new Error('EPUB 缺少阅读顺序或资源清单。')
  const value = (input: unknown) => {
    const first = Array.isArray(input) ? input[0] : input
    const result =
      typeof first === 'object' && first ? (first as Record<string, unknown>)['#text'] : first
    return typeof result === 'string' || typeof result === 'number'
      ? String(result).trim().slice(0, 200)
      : ''
  }
  return {
    title: value(data.package.metadata?.title),
    author: value(data.package.metadata?.creator),
  }
}
