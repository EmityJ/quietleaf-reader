// 在章节进入 iframe 前移除主动内容；iframe 仍保持不允许脚本的沙箱。
export function restrictEpubDocument(document: Document): void {
  const blocked = new Set([
    'script',
    'iframe',
    'frame',
    'frameset',
    'object',
    'embed',
    'applet',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'foreignobject',
    'animate',
    'animatemotion',
    'animatetransform',
    'set',
  ])
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const tag = element.localName.toLowerCase()
    if (blocked.has(tag) || (tag === 'meta' && element.hasAttribute('http-equiv'))) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase()
      const value = attribute.value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase()
      if (name.startsWith('on') || ['srcdoc', 'formaction', 'action', 'target'].includes(name)) {
        element.removeAttributeNode(attribute)
      } else if (['href', 'src', 'poster', 'data'].includes(name)) {
        // 允许书内相对路径和 epub.js 生成的 blob 资源，外部地址不可导航。
        const scheme = /^([a-z][a-z0-9+.-]*):/.exec(value)?.[1]
        const imageData =
          name === 'src' &&
          tag === 'img' &&
          /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(value)
        if (value.startsWith('//') || (scheme && scheme !== 'blob' && !imageData)) {
          element.removeAttributeNode(attribute)
        }
      }
    }
  }
}
