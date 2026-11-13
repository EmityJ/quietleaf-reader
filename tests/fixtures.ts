import JSZip from 'jszip'

export async function makeEpub(
  options: { title?: string; unsafeScript?: boolean; large?: boolean } = {},
) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file(
    'OEBPS/package.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">quietleaf-test</dc:identifier><dc:title>${options.title || '测试电子书'}</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-19T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">第一章 测试阅读</a></li><li><a href="two.xhtml">第二章 另一页</a></li></ol></nav></body></html>',
  )
  const paragraphs = Array.from(
    { length: 16 },
    (_, index) =>
      `<p>这是 EPUB 测试的第 ${index + 1} 段。文字应当正常显示，切换字号与主题后仍能翻页。阅读位置会保存到本机，下次可以继续。</p>`,
  ).join('')
  zip.file(
    'OEBPS/one.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章 测试阅读</h1>${paragraphs}${options.unsafeScript ? '<script>parent.__epubEscaped = true; window.__epubScriptRan = true;</script>' : ''}</body></html>`,
  )
  zip.file(
    'OEBPS/two.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章 另一页</h1><p>这是第二章。翻过这一页，故事仍在继续。</p></body></html>',
  )
  if (options.large) zip.file('oversized.txt', 'a'.repeat(33 * 1024 * 1024))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
