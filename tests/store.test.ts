import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import { LibraryStore } from '../electron/store'
import { inspectEpub } from '../electron/epub'
import { makeEpub } from './fixtures'

async function temporary(t: { after(fn: () => Promise<void>): void }) {
  await mkdir(path.join(process.cwd(), '.test-data'), { recursive: true })
  const dir = await mkdtemp(path.join(process.cwd(), '.test-data', 'unit-'))
  t.after(async () => {
    const resolved = path.resolve(dir)
    assert.ok(resolved.startsWith(path.join(process.cwd(), '.test-data') + path.sep))
    await rm(resolved, { recursive: true, force: true })
  })
  return dir
}

test('书架初始化示例，空书架重启不会重新塞入示例', async (t) => {
  const root = await temporary(t)
  const store = new LibraryStore(root)
  await store.init()
  assert.equal(store.state.books[0].sample, true)
  assert.match(await store.readChapter('sample', 0), /第一章/)
  await store.removeBook('sample')
  const reopened = new LibraryStore(root)
  await reopened.init()
  assert.equal(reopened.state.books.length, 0)
})

test('导入并发去重、章节读取、位置设置与删除原件保护', async (t) => {
  const root = await temporary(t)
  const source = path.join(root, '原始小说.txt')
  await writeFile(source, '第一章 山间\n你好🌿\n第二章 远方\n后文')
  const store = new LibraryStore(path.join(root, 'app'))
  await store.init()
  const [book, duplicate] = await Promise.all([store.importFile(source), store.importFile(source)])
  assert.equal(book.id, duplicate.id)
  assert.equal(store.state.books.filter((item) => !item.sample).length, 1)
  assert.equal(await store.readChapter(book.id, 1), '第二章 远方\n后文')
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      store.saveProgress(book.id, { percent: index * 10, chapterIndex: 1, fraction: index / 10 }),
    ),
  )
  await store.saveSettings({ ...store.state.settings, fontSize: 26 })
  const reopened = new LibraryStore(path.join(root, 'app'))
  await reopened.init()
  assert.equal(reopened.getBook(book.id).progress.percent, 70)
  assert.equal(reopened.state.settings.fontSize, 26)
  await reopened.removeBook(book.id)
  assert.ok((await stat(source)).isFile())
  assert.equal(
    (
      JSON.parse(await readFile(path.join(root, 'app/library.json'), 'utf8')) as {
        books: unknown[]
      }
    ).books.length,
    1,
  )
})

test('导入 EPUB 元数据、保留二进制并拒绝畸形压缩文件', async (t) => {
  const root = await temporary(t)
  const source = path.join(root, 'book.epub')
  const bytes = await makeEpub()
  await writeFile(source, bytes)
  const store = new LibraryStore(path.join(root, 'app'))
  await store.init()
  const book = await store.importFile(source)
  assert.equal(book.title, '测试电子书')
  assert.equal(book.author, '测试作者')
  assert.deepEqual(Buffer.from((await store.openBook(book.id)).bytes!), bytes)
  await assert.rejects(inspectEpub(Buffer.from('这不是压缩文件')))
})

test('旧版资料升级后保留书籍和进度，只迁移透明度偏好', async (t) => {
  const root = await temporary(t)
  const source = path.join(root, '升级小说.txt')
  await writeFile(source, '第一章 升级\n保存我的进度。')
  const store = new LibraryStore(path.join(root, 'app'))
  await store.init()
  const book = await store.importFile(source)
  await store.saveProgress(book.id, { percent: 64, chapterIndex: 0, fraction: 0.64 })
  const oldSettings: Record<string, unknown> = { ...store.state.settings, windowOpacity: 0.24 }
  delete oldSettings.transparencyMode
  delete oldSettings.backgroundOpacity
  delete oldSettings.textOpacity
  await writeFile(
    path.join(root, 'app/library.json'),
    JSON.stringify({ ...store.state, settings: oldSettings }),
  )
  const reopened = new LibraryStore(path.join(root, 'app'))
  await reopened.init()
  assert.equal(reopened.getBook(book.id).progress.percent, 64)
  assert.match(await reopened.readChapter(book.id, 0), /保存我的进度/)
  assert.equal(reopened.state.settings.backgroundOpacity, 0.24)
  assert.equal(reopened.state.settings.textOpacity, 1)
  assert.equal(reopened.state.settings.transparencyMode, 'background')
})

test('EPUB 内部超大文件在解压前拒绝', async () => {
  await assert.rejects(inspectEpub(await makeEpub({ large: true })), /内部文件过大/)
})

test('无效编号、越界章节与不支持的文件类型不能读写磁盘', async (t) => {
  const root = await temporary(t)
  const store = new LibraryStore(root)
  await store.init()
  await assert.rejects(store.openBook('../../outside'), /编号无效/)
  await assert.rejects(store.readChapter('sample', -1), /章节不存在/)
  await assert.rejects(store.readChapter('sample', 100000), /章节不存在/)
  await assert.rejects(store.importFile(path.join(root, 'book.exe')), /请选择/)
})

test('损坏索引备份后可从保留的书籍副本恢复', async (t) => {
  const root = await temporary(t)
  const store = new LibraryStore(root)
  await store.init()
  const source = path.join(root, '恢复测试.txt')
  await writeFile(source, '第一章 回来\n内容仍在')
  const imported = await store.importFile(source)
  await writeFile(path.join(root, 'library.json'), '{broken')
  const reopened = new LibraryStore(root)
  await reopened.init()
  assert.ok(reopened.state.books.some((book) => book.id === imported.id))
  assert.match(await reopened.readChapter(imported.id, 0), /内容仍在/)
})
