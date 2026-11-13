use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfi: Option<String>,
    #[serde(default)]
    pub percent: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub start: u64,
    pub end: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub size: u64,
    pub added_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
    pub progress: ReadingProgress,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapters: Option<Vec<Chapter>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sample: bool,
    #[serde(default)]
    pub tone: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    pub font_size: u32,
    pub line_height: f64,
    pub font_family: String,
    pub theme: String,
    pub transparency_mode: String,
    pub background_opacity: f64,
    pub text_opacity: f64,
    pub window_opacity: f64,
    pub auto_hide: bool,
    pub hide_delay: u64,
    pub always_on_top: bool,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font_size: 20,
            line_height: 1.9,
            font_family: "serif".into(),
            theme: "paper".into(),
            transparency_mode: "background".into(),
            background_opacity: 0.12,
            text_opacity: 1.0,
            window_opacity: 1.0,
            auto_hide: true,
            hide_delay: 500,
            always_on_top: true,
        }
    }
}

fn number(value: &Value, min: f64, max: f64, fallback: f64) -> f64 {
    value
        .as_f64()
        .filter(|n| n.is_finite())
        .map(|n| n.clamp(min, max))
        .unwrap_or(fallback)
}

impl ReaderSettings {
    pub fn normalize(v: &Value) -> Self {
        let d = Self::default();
        let old_background = if v.get("transparencyMode").is_none() {
            &v["windowOpacity"]
        } else {
            &Value::Null
        };
        Self {
            font_size: number(&v["fontSize"], 14.0, 32.0, d.font_size as f64).round() as u32,
            line_height: number(&v["lineHeight"], 1.3, 2.6, d.line_height),
            font_family: if v["fontFamily"] == "sans" {
                "sans"
            } else {
                "serif"
            }
            .into(),
            theme: match v["theme"].as_str() {
                Some("sage") => "sage",
                Some("night") => "night",
                _ => "paper",
            }
            .into(),
            transparency_mode: if v["transparencyMode"] == "window" {
                "window"
            } else {
                "background"
            }
            .into(),
            background_opacity: number(
                v.get("backgroundOpacity")
                    .filter(|n| !n.is_null())
                    .unwrap_or(old_background),
                0.0,
                1.0,
                d.background_opacity,
            ),
            text_opacity: number(&v["textOpacity"], 0.2, 1.0, d.text_opacity),
            window_opacity: number(&v["windowOpacity"], 0.01, 1.0, d.window_opacity),
            auto_hide: v["autoHide"].as_bool().unwrap_or(d.auto_hide),
            hide_delay: number(&v["hideDelay"], 200.0, 2000.0, d.hide_delay as f64).round() as u64,
            always_on_top: v["alwaysOnTop"].as_bool().unwrap_or(d.always_on_top),
        }
    }

    pub fn effective_opacity(&self) -> f64 {
        if self.transparency_mode == "background" {
            1.0
        } else {
            self.window_opacity
        }
    }
}

impl ReadingProgress {
    pub fn normalize(v: &Value) -> Self {
        Self {
            chapter_index: Some(number(&v["chapterIndex"], 0.0, 100000.0, 0.0).floor() as usize),
            fraction: Some(number(&v["fraction"], 0.0, 1.0, 0.0)),
            percent: number(&v["percent"], 0.0, 100.0, 0.0),
            cfi: v["cfi"]
                .as_str()
                .filter(|s| s.encode_utf16().count() <= 4096)
                .map(str::to_owned),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibraryState {
    pub version: u32,
    pub books: Vec<BookRecord>,
    pub settings: ReaderSettings,
}

impl Default for LibraryState {
    fn default() -> Self {
        Self {
            version: 1,
            books: Vec::new(),
            settings: ReaderSettings::default(),
        }
    }
}

pub fn valid_id(id: &str) -> bool {
    id == "sample"
        || (id.len() == 64
            && id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}
