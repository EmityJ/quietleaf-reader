import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, open, rm, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { BookRecord, LibraryState, ReadingProgress, ReaderSettings } from '../src/shared/types'
import { DEFAULT_SETTINGS, normalizeProgress, normalizeSettings } from './domain'
import { inspectEpub } from './epub'
import { parseText } from './txt'
import { SAMPLE_TEXT } from './sample'

export type TxtParser =
  typeof parseText | ((bytes: Uint8Array) => Promise<ReturnType<typeof parseText>>)

export class LibraryStore {
  state: LibraryState = { version: 1, books: [], settings: { ...DEFAULT_SETTINGS } }
  private writes = Promise.resolve()
  private imports = Promise.resolve()
  constructor(
    readonly root: string,
    private parseTxt: TxtParser = parseText,
  ) {}
  private get catalogPath() {
    return path.join(this.root, 'library.json')
  }
  private bookPath(id: string, extension: string) {
    return path.join(this.root, 'books', `${id}.${extension}`)
  }

  async init() {
    await mkdir(path.join(this.root, 'books'), { recursive: true })
    try {
      const loaded = JSON.parse(await readFile(this.catalogPath, 'utf8')) as LibraryState
      if (loaded.version !== 1 || !Array.isArray(loaded.books))
        throw new Error('书架数据版本无法识别。')
      loaded.books.forEach((book) => {
        if (
          !this.isId(book.id) ||
          !['txt', 'epub'].includes(book.format) ||
          typeof book.title !== 'string'
        )
          throw new Error('书架记录格式异常。')
        book.progress = normalizeProgress(book.progress)
      })
      this.state = { version: 1, books: loaded.books, settings: normalizeSettings(loaded.settings) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // 损坏的索引先保留备份，书籍原件始终保存在 books 目录中。
        await rename(this.catalogPath, `${this.catalogPath}.backup-${Date.now()}`)
        for (const name of await readdir(path.join(this.root, 'books'))) {
          if (/^[a-f0-9]{64}\.(txt|epub)$/.test(name)) {
            try {
              await this.importFile(path.join(this.root, 'books', name))
            } catch {
              /* 单本失败不影响恢复其他书籍。 */
            }
          }
        }
      }
      if (!this.state.books.some((book) => book.id === 'sample')) await this.installSample()
      await this.persist()
    }
  }

  private async installSample() {
    const parsed = parseText(Buffer.from(SAMPLE_TEXT))
    await writeFile(this.bookPath('sample', 'utf8'), parsed.text, 'utf8')
    this.state.books.push({
      id: 'sample',
      title: '山间来信',
      author: '隐页原创示例',
      format: 'txt',
      size: Buffer.byteLength(SAMPLE_TEXT),
      addedAt: new Date().toISOString(),
      progress: { percent: 0 },
      chapters: parsed.chapters,
      textBytes: Buffer.byteLength(parsed.text),
      sample: true,
      tone: 0,
    })
  }

  private isId(id: unknown): id is string {
    return id === 'sample' || (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))
  }
  getBook(id: string) {
    if (!this.isId(id)) throw new Error('书籍编号无效。')
    const book = this.state.books.find((item) => item.id === id)
    if (!book) throw new Error('这本书已不在书架中。')
    return book
  }

  persist() {
    const snapshot = JSON.stringify(this.state, null, 2)
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        await writeFile(`${this.catalogPath}.tmp`, snapshot, 'utf8')
        await rename(`${this.catalogPath}.tmp`, this.catalogPath)
      })
    this.writes = write
    return write
  }

  importFile(filePath: string): Promise<BookRecord> {
    // 导入串行提交，避免相同文件的并发请求生成重复记录。
    const result = this.imports.catch(() => {}).then(() => this.doImport(filePath))
    this.imports = result.then(
      () => {},
      () => {},
    )
    return result
  }

  private async doImport(filePath: string): Promise<BookRecord> {
    const extension = path.extname(filePath).slice(1).toLowerCase()
    if (extension !== 'txt' && extension !== 'epub') throw new Error('请选择 TXT 或 EPUB 文件。')
    const info = await stat(filePath)
    const limit = extension === 'txt' ? 24 * 1024 * 1024 : 80 * 1024 * 1024
    if (!info.isFile() || info.size > limit)
      throw new Error(
        extension === 'txt' ? 'TXT 文件需要小于 24 MB。' : 'EPUB 文件需要小于 80 MB。',
      )
    const bytes = await readFile(filePath)
    const id = createHash('sha256').update(bytes).digest('hex')
    const existing = this.state.books.find((book) => book.id === id)
    if (existing) return existing
    let metadata = { title: path.basename(filePath, path.extname(filePath)), author: '未知作者' }
    let chapters: BookRecord['chapters']
    let textBytes: number | undefined
    if (extension === 'txt') {
      const parsed = await this.parseTxt(bytes)
      chapters = parsed.chapters
      textBytes = Buffer.byteLength(parsed.text)
      await writeFile(this.bookPath(id, 'utf8'), parsed.text, 'utf8')
    } else {
      const epub = await inspectEpub(bytes)
      metadata = { title: epub.title || metadata.title, author: epub.author || metadata.author }
    }
    await writeFile(this.bookPath(id, extension), bytes)
    const book: BookRecord = {
      id,
      ...metadata,
      format: extension,
      size: bytes.length,
      addedAt: new Date().toISOString(),
      progress: { percent: 0 },
      chapters,
      textBytes,
      tone: parseInt(id.slice(0, 2), 16) % 5,
    }
    this.state.books.unshift(book)
    try {
      await this.persist()
    } catch (error) {
      this.state.books = this.state.books.filter((item) => item.id !== id)
      throw error
    }
    return book
  }

  async openBook(id: string) {
    const book = this.getBook(id)
    const bytes =
      book.format === 'epub' ? new Uint8Array(await readFile(this.bookPath(id, 'epub'))) : undefined
    book.lastOpenedAt = new Date().toISOString()
    await this.persist()
    return { book, bytes }
  }

  async readChapter(id: string, index: number) {
    const book = this.getBook(id)
    if (book.format !== 'txt' || !Number.isInteger(index) || !book.chapters?.[index])
      throw new Error('章节不存在。')
    const chapter = book.chapters[index]
    const file = await open(this.bookPath(id, 'utf8'), 'r')
    try {
      const buffer = Buffer.alloc(chapter.end - chapter.start)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, chapter.start)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await file.close()
    }
  }

  async saveProgress(id: string, progress: ReadingProgress) {
    this.getBook(id).progress = normalizeProgress(progress)
    await this.persist()
  }
  async saveSettings(settings: ReaderSettings) {
    this.state.settings = normalizeSettings(settings)
    await this.persist()
    return this.state.settings
  }
  async removeBook(id: string) {
    const book = this.getBook(id)
    this.state.books = this.state.books.filter((item) => item.id !== id)
    try {
      await this.persist()
    } catch (error) {
      this.state.books.push(book)
      throw error
    }
    await Promise.all(
      ['txt', 'epub', 'utf8'].map((extension) => rm(this.bookPath(id, extension), { force: true })),
    )
  }
}
