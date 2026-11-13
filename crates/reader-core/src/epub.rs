use anyhow::{bail, Context, Result};
use roxmltree::Document;
use std::io::{Cursor, Read};
use std::path::{Component, Path};
use zip::ZipArchive;

pub const EPUB_LIMIT: u64 = 80 * 1024 * 1024;

pub fn safe_archive_path(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('\\')
        && !name.contains(':')
        && !name.starts_with('/')
        && Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn read_xml(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String> {
    let file = archive.by_name(name).context("EPUB 缺少必要的目录文件。")?;
    if file.size() > 2 * 1024 * 1024 {
        bail!("EPUB 的目录 XML 过大。");
    }
    let mut xml = String::new();
    file.take(2 * 1024 * 1024 + 1).read_to_string(&mut xml)?;
    let upper = xml.to_ascii_uppercase();
    if xml.len() > 2 * 1024 * 1024 || upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
        bail!("EPUB 的目录 XML 格式不受支持。");
    }
    Ok(xml)
}

pub fn inspect_epub(bytes: &[u8]) -> Result<(String, String)> {
    if bytes.len() as u64 > EPUB_LIMIT {
        bail!("EPUB 文件需要小于 80 MB。");
    }
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).context("这不是有效的 EPUB 压缩文件。")?;
    if archive.len() > 3000 {
        bail!("这本 EPUB 包含过多文件，暂不支持。");
    }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        if !safe_archive_path(file.name().trim_end_matches('/')) {
            bail!("EPUB 内含无效资源路径。");
        }
        if file.is_dir() {
            continue;
        }
        if file.size() > 32 * 1024 * 1024 {
            bail!("EPUB 内部文件过大或格式异常。");
        }
        total = total.checked_add(file.size()).context("EPUB 尺寸异常。")?;
        if total > 160 * 1024 * 1024 {
            bail!("EPUB 解压后的内容过大，暂不支持。");
        }
    }
    let container_xml = read_xml(&mut archive, "META-INF/container.xml")?;
    let container = Document::parse(&container_xml).context("EPUB 容器 XML 无效。")?;
    let package_path = container
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .context("EPUB 缺少内容路径。")?;
    if !safe_archive_path(package_path) {
        bail!("EPUB 的内容路径无效。");
    }
    let package_xml = read_xml(&mut archive, package_path)?;
    let package = Document::parse(&package_xml).context("EPUB 的目录 XML 无效。")?;
    if !package.descendants().any(|n| n.has_tag_name("spine"))
        || !package.descendants().any(|n| n.has_tag_name("manifest"))
    {
        bail!("EPUB 缺少阅读顺序或资源清单。");
    }
    let metadata = package
        .descendants()
        .find(|n| n.has_tag_name("metadata"))
        .context("EPUB 缺少元数据。");
    let value = |name: &str| {
        metadata
            .as_ref()
            .ok()
            .and_then(|m| {
                m.descendants()
                    .find(|n| n.is_element() && n.tag_name().name() == name)
            })
            .and_then(|n| n.text())
            .unwrap_or("")
            .trim()
            .chars()
            .take(200)
            .collect()
    };
    Ok((value("title"), value("creator")))
}
