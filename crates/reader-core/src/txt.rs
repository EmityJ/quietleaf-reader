use crate::Chapter;
use anyhow::{bail, Result};
use encoding_rs::{GB18030, UTF_16BE, UTF_16LE};
use regex::Regex;
use std::sync::OnceLock;

pub struct ParsedText {
    pub text: String,
    pub chapters: Vec<Chapter>,
}

pub fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        UTF_16LE
            .decode_without_bom_handling(&bytes[2..])
            .0
            .into_owned()
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        UTF_16BE
            .decode_without_bom_handling(&bytes[2..])
            .0
            .into_owned()
    } else {
        match std::str::from_utf8(bytes) {
            Ok(text) => text.to_owned(),
            Err(_) => GB18030.decode_without_bom_handling(bytes).0.into_owned(),
        }
    }
}

pub fn parse_text(bytes: &[u8]) -> Result<ParsedText> {
    let text = decode_text(bytes)
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\0', "");
    if text.trim().is_empty() {
        bail!("这份 TXT 没有可阅读的文字。");
    }
    static HEADING: OnceLock<Regex> = OnceLock::new();
    let heading = HEADING.get_or_init(|| Regex::new(r"(?i)^(?:第[零〇一二三四五六七八九十百千万两0-9]{1,12}[章节回卷部篇集][^\n]{0,55}|(?:序章|序言|前言|楔子|尾声|后记|终章)[^\n]{0,30}|chapter\s+[0-9]+[^\n]{0,55})$").expect("固定章节表达式有效"));
    let mut boundaries = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let title = line.trim();
        if heading.is_match(title) {
            boundaries.push((offset, title.to_owned()));
        }
        offset += line.len();
    }
    if boundaries.first().map(|b| b.0) != Some(0) {
        boundaries.insert(
            0,
            (
                0,
                if boundaries.is_empty() {
                    "正文"
                } else {
                    "开篇"
                }
                .into(),
            ),
        );
    }
    let mut chapters = Vec::new();
    for (index, (start, title)) in boundaries.iter().enumerate() {
        let end = boundaries.get(index + 1).map(|b| b.0).unwrap_or(text.len());
        let mut cursor = *start;
        let mut part = 1;
        while cursor < end {
            let section = &text[cursor..end];
            let mut units = 0;
            let mut cut = section.len();
            let mut last_newline = None;
            // 保持旧版按 UTF-16 长度分块的规则，但持久化索引使用 UTF-8 字节。
            for (byte, ch) in section.char_indices() {
                if units + ch.len_utf16() > 18000 {
                    cut = byte;
                    break;
                }
                units += ch.len_utf16();
                if ch == '\n' {
                    last_newline = Some((byte + 1, units));
                }
            }
            if cut < section.len() {
                if let Some((byte, count)) = last_newline.filter(|(_, count)| *count > units / 2) {
                    let _ = count;
                    cut = byte;
                }
            }
            chapters.push(Chapter {
                id: format!("chapter-{}", chapters.len()),
                title: if part == 1 {
                    title.clone()
                } else {
                    format!("{title} · 续 {part}")
                },
                start: cursor as u64,
                end: (cursor + cut) as u64,
            });
            cursor += cut;
            part += 1;
        }
    }
    Ok(ParsedText { text, chapters })
}
