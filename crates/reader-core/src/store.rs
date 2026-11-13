use crate::{
    epub::{inspect_epub, EPUB_LIMIT},
    model::*,
    txt::parse_text,
};
use anyhow::{bail, Context, Result};
use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub const TXT_LIMIT: u64 = 24 * 1024 * 1024;
const INDEX_LIMIT: u64 = 32 * 1024 * 1024;

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn load_catalog(root: &Path) -> Result<LibraryState> {
    let file = File::open(root.join("library.json"))?;
    if file.metadata()?.len() > INDEX_LIMIT {
        bail!("书架索引过大。");
    }
    let mut value: Value = serde_json::from_reader(file)?;
    value["settings"] = serde_json::to_value(ReaderSettings::normalize(&value["settings"]))?;
    let mut state: LibraryState = serde_json::from_value(value)?;
    if state.version != 1 {
        bail!("书架数据版本无法识别。");
    }
    let mut ids = std::collections::HashSet::new();
    for book in &mut state.books {
        if !valid_id(&book.id)
            || !matches!(book.format.as_str(), "txt" | "epub")
            || !ids.insert(book.id.clone())
        {
            bail!("书架记录格式异常。");
        }
        book.progress = ReadingProgress::normalize(&serde_json::to_value(&book.progress)?);
    }
    Ok(state)
}

pub struct LibraryStore {
    pub root: PathBuf,
    pub state: LibraryState,
}

impl LibraryStore {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("books"))?;
        let mut store = Self {
            root,
            state: LibraryState::default(),
        };
        if store.root.join("library.json").exists() {
            match load_catalog(&store.root) {
                Ok(state) => {
                    store.state = state;
                    return Ok(store);
                }
                Err(error) => {
                    let backup = store.root.join(format!(
                        "library.json.backup-{}",
                        Utc::now().timestamp_millis()
                    ));
                    fs::rename(store.root.join("library.json"), backup)?;
                    store.log(&format!("索引已备份，开始恢复：{error:#}"));
                    let sources: Vec<_> = fs::read_dir(store.root.join("books"))?
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .collect();
                    for source in sources {
                        let id = source.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("");
                        if valid_id(id) && id != "sample" && matches!(extension, "txt" | "epub") {
                            if let Err(error) = store.import_file(&source) {
                                store.log(&format!("单本恢复失败：{error:#}"));
                            }
                        }
                    }
                }
            }
        }
        store.install_sample()?;
        store.persist()?;
        Ok(store)
    }

    pub fn log(&self, message: &str) {
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join("reader.log"))
        {
            let _ = writeln!(file, "{} {message}", now());
        }
    }

    fn book_path(&self, id: &str, extension: &str) -> Result<PathBuf> {
        if !valid_id(id) {
            bail!("书籍编号无效。");
        }
        Ok(self.root.join("books").join(format!("{id}.{extension}")))
    }

    pub fn get_book(&self, id: &str) -> Result<&BookRecord> {
        if !valid_id(id) {
            bail!("书籍编号无效。");
        }
        self.state
            .books
            .iter()
            .find(|b| b.id == id)
            .context("这本书已不在书架中。")
    }

    pub fn persist(&self) -> Result<()> {
        // 调用方串行持有书架锁；临时文件与索引在同一文件系统，替换前刷盘。
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)?;
        serde_json::to_writer_pretty(&mut temporary, &self.state)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(self.root.join("library.json"))
            .map_err(|e| e.error)?;
        Ok(())
    }

    fn install_sample(&mut self) -> Result<()> {
        let parsed = parse_text(include_bytes!("sample.txt"))?;
        fs::write(self.book_path("sample", "utf8")?, parsed.text.as_bytes())?;
        self.state.books.push(BookRecord {
            id: "sample".into(),
            title: "山间来信".into(),
            author: "隐页原创示例".into(),
            format: "txt".into(),
            size: parsed.text.len() as u64,
            added_at: now(),
            last_opened_at: None,
            progress: ReadingProgress::default(),
            chapters: Some(parsed.chapters),
            text_bytes: Some(parsed.text.len() as u64),
            sample: true,
            tone: 0,
        });
        Ok(())
    }

    pub fn import_file(&mut self, source: &Path) -> Result<BookRecord> {
        let format = source
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let limit = match format.as_str() {
            "txt" => TXT_LIMIT,
            "epub" => EPUB_LIMIT,
            _ => bail!("请选择 TXT 或 EPUB 文件。"),
        };
        let file = File::open(source).context("无法打开这本书。")?;
        let info = file.metadata()?;
        if !info.is_file() || info.len() > limit {
            bail!(
                "{} 文件需要小于 {} MB。",
                format.to_uppercase(),
                limit / 1024 / 1024
            );
        }
        let mut bytes = Vec::with_capacity(info.len() as usize);
        file.take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            bail!("书籍文件过大。");
        }
        let id = format!("{:x}", Sha256::digest(&bytes));
        if let Some(book) = self.state.books.iter().find(|b| b.id == id) {
            return Ok(book.clone());
        }
        let mut book = BookRecord {
            id: id.clone(),
            title: source
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            author: "未知作者".into(),
            format: format.clone(),
            size: bytes.len() as u64,
            added_at: now(),
            last_opened_at: None,
            progress: ReadingProgress::default(),
            chapters: None,
            text_bytes: None,
            sample: false,
            tone: u8::from_str_radix(&id[..2], 16)? % 5,
        };
        if format == "txt" {
            let parsed = parse_text(&bytes)?;
            fs::write(self.book_path(&id, "utf8")?, parsed.text.as_bytes())?;
            book.text_bytes = Some(parsed.text.len() as u64);
            book.chapters = Some(parsed.chapters);
        } else {
            let (title, author) = inspect_epub(&bytes)?;
            if !title.is_empty() {
                book.title = title;
            }
            if !author.is_empty() {
                book.author = author;
            }
        }
        fs::write(self.book_path(&id, &format)?, &bytes)?;
        self.state.books.insert(0, book.clone());
        if let Err(error) = self.persist() {
            self.state.books.remove(0);
            return Err(error);
        }
        Ok(book)
    }

    pub fn open_book(&mut self, id: &str) -> Result<BookRecord> {
        self.get_book(id)?;
        let index = self.state.books.iter().position(|b| b.id == id).unwrap();
        let previous = self.state.books[index].last_opened_at.clone();
        self.state.books[index].last_opened_at = Some(now());
        if let Err(error) = self.persist() {
            self.state.books[index].last_opened_at = previous;
            return Err(error);
        }
        Ok(self.state.books[index].clone())
    }

    pub fn read_epub(&self, id: &str) -> Result<Vec<u8>> {
        if self.get_book(id)?.format != "epub" {
            bail!("这不是 EPUB 书籍。");
        }
        let file = File::open(self.book_path(id, "epub")?)?;
        let mut bytes = Vec::new();
        file.take(EPUB_LIMIT + 1).read_to_end(&mut bytes)?;
        inspect_epub(&bytes)?;
        Ok(bytes)
    }

    pub fn read_chapter(&self, id: &str, index: usize) -> Result<String> {
        let book = self.get_book(id)?;
        let chapter = book
            .chapters
            .as_ref()
            .and_then(|c| c.get(index))
            .filter(|_| book.format == "txt")
            .context("章节不存在。")?;
        let mut file = File::open(self.book_path(id, "utf8")?)?;
        let size = file.metadata()?.len();
        if chapter.start > chapter.end
            || chapter.end > size
            || chapter.end - chapter.start > TXT_LIMIT * 4
        {
            bail!("章节索引损坏，请重新导入书籍。");
        }
        file.seek(SeekFrom::Start(chapter.start))?;
        let mut bytes = vec![0; (chapter.end - chapter.start) as usize];
        file.read_exact(&mut bytes)?;
        String::from_utf8(bytes).context("章节编码异常，请重新导入书籍。")
    }

    pub fn save_progress(&mut self, id: &str, value: &Value) -> Result<()> {
        self.get_book(id)?;
        let index = self.state.books.iter().position(|b| b.id == id).unwrap();
        let previous = self.state.books[index].progress.clone();
        self.state.books[index].progress = ReadingProgress::normalize(value);
        if let Err(error) = self.persist() {
            self.state.books[index].progress = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn save_settings(&mut self, value: &Value) -> Result<ReaderSettings> {
        let previous = self.state.settings.clone();
        self.state.settings = ReaderSettings::normalize(value);
        if let Err(error) = self.persist() {
            self.state.settings = previous;
            return Err(error);
        }
        Ok(self.state.settings.clone())
    }

    pub fn remove_book(&mut self, id: &str) -> Result<()> {
        self.get_book(id)?;
        let index = self.state.books.iter().position(|b| b.id == id).unwrap();
        let removed = self.state.books.remove(index);
        if let Err(error) = self.persist() {
            self.state.books.insert(index, removed);
            return Err(error);
        }
        for extension in ["txt", "epub", "utf8"] {
            let path = self.book_path(id, extension)?;
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    self.log(&format!("清理书籍副本失败：{error}"));
                }
            }
        }
        Ok(())
    }
}

pub fn migrate_legacy(source: &Path, destination: &Path) -> Result<bool> {
    if destination.exists() || !source.join("library.json").is_file() {
        return Ok(false);
    }
    let state = load_catalog(source).context("旧版书架无法读取，未修改旧版数据。")?;
    let parent = destination.parent().context("应用数据目录无效。")?;
    fs::create_dir_all(parent)?;
    let temporary = tempfile::Builder::new()
        .prefix("quietleaf-migration-")
        .tempdir_in(parent)?;
    fs::create_dir(temporary.path().join("books"))?;
    for book in &state.books {
        for extension in ["txt", "epub", "utf8"] {
            let name = format!("{}.{}", book.id, extension);
            let original = source.join("books").join(&name);
            if original.exists() {
                let metadata = fs::symlink_metadata(&original)?;
                if !metadata.is_file() || metadata.len() > TXT_LIMIT * 4 {
                    bail!("旧书架存在异常文件，迁移已取消。");
                }
                fs::copy(original, temporary.path().join("books").join(name))?;
            }
        }
    }
    let mut file = File::create(temporary.path().join("library.json"))?;
    serde_json::to_writer_pretty(&mut file, &state)?;
    file.sync_all()?;
    fs::write(
        temporary.path().join("migration.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"source": source, "copiedAt": now(), "books": state.books.len()}),
        )?,
    )?;
    fs::rename(temporary.path(), destination)?;
    Ok(true)
}
