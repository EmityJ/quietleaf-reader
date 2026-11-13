use crate::platform::Platform;
use anyhow::{bail, Context, Result};
use quietleaf_core::{migrate_legacy, LibraryStore, ReaderSettings};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct Runtime {
    library: Mutex<LibraryStore>,
    desktop: Mutex<Desktop>,
    stopping: AtomicBool,
    tick_queued: AtomicBool,
}

#[derive(Clone, Copy)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Bounds {
    fn read(window: &WebviewWindow) -> tauri::Result<Self> {
        let p = window.outer_position()?;
        let s = window.outer_size()?;
        Ok(Self {
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
        })
    }
    fn contains(&self, p: (f64, f64)) -> bool {
        p.0 >= self.x as f64
            && p.1 >= self.y as f64
            && p.0 < self.x as f64 + self.width as f64
            && p.1 < self.y as f64 + self.height as f64
    }
    fn apply(mut self, window: &WebviewWindow) -> tauri::Result<()> {
        let monitors = window.available_monitors()?;
        let monitor = monitors
            .iter()
            .find(|m| {
                let p = m.position();
                let s = m.size();
                self.x >= p.x
                    && self.y >= p.y
                    && (self.x as i64) < p.x as i64 + s.width as i64
                    && (self.y as i64) < p.y as i64 + s.height as i64
            })
            .or_else(|| monitors.first());
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            self.width = self.width.min(area.size.width);
            self.height = self.height.min(area.size.height);
            self.x = self.x.clamp(
                area.position.x,
                area.position.x + (area.size.width - self.width) as i32,
            );
            self.y = self.y.clamp(
                area.position.y,
                area.position.y + (area.size.height - self.height) as i32,
            );
        }
        window.set_size(PhysicalSize::new(self.width, self.height))?;
        window.set_position(PhysicalPosition::new(self.x, self.y))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    floating: bool,
    concealed: bool,
    boss_hidden: bool,
    shortcut_available: bool,
    native_opacity: bool,
    auto_hide_available: bool,
    platform: &'static str,
    arch: &'static str,
    session: String,
}

struct Desktop {
    platform: Platform,
    settings: ReaderSettings,
    floating: bool,
    concealed: bool,
    boss_hidden: bool,
    hovered: bool,
    renderer_locked: bool,
    dialog_locks: usize,
    left_at: Option<Instant>,
    normal: Option<Bounds>,
    floating_bounds: Option<Bounds>,
    hidden_bounds: Option<Bounds>,
    tray_available: bool,
    shortcut_available: bool,
}

impl Desktop {
    fn new(window: &WebviewWindow, settings: ReaderSettings) -> Self {
        Self {
            platform: Platform::new(window),
            settings,
            floating: false,
            concealed: false,
            boss_hidden: false,
            hovered: true,
            renderer_locked: false,
            dialog_locks: 0,
            left_at: None,
            normal: None,
            floating_bounds: None,
            hidden_bounds: None,
            tray_available: false,
            shortcut_available: false,
        }
    }
    fn state(&self) -> WindowState {
        WindowState {
            floating: self.floating,
            concealed: self.concealed,
            boss_hidden: self.boss_hidden,
            shortcut_available: self.shortcut_available,
            native_opacity: self.platform.native_opacity(),
            auto_hide_available: self.platform.can_track_cursor(),
            platform: if cfg!(windows) {
                "win32"
            } else {
                std::env::consts::OS
            },
            arch: if cfg!(target_arch = "aarch64") {
                "arm64"
            } else if cfg!(target_arch = "x86_64") {
                "x64"
            } else {
                std::env::consts::ARCH
            },
            session: std::env::var("XDG_SESSION_TYPE")
                .unwrap_or_else(|_| if cfg!(windows) { "Windows" } else { "未知" }.into()),
        }
    }
    fn broadcast(&self, window: &WebviewWindow) {
        let _ = window.emit("window:changed", self.state());
    }
    fn opacity(&self, window: &WebviewWindow) -> Result<()> {
        self.platform
            .set_opacity(window, self.settings.effective_opacity())
    }
    fn reveal(&mut self, window: &WebviewWindow, focus: bool) -> Result<()> {
        self.concealed = false;
        self.boss_hidden = false;
        self.hovered = true;
        self.left_at = None;
        self.hidden_bounds = None;
        if focus {
            window.unminimize()?;
            window.show()?;
            window.set_focus()?;
        } else if !window.is_visible()? {
            self.platform.show_inactive(window)?;
        }
        self.opacity(window)?;
        self.broadcast(window);
        Ok(())
    }
    fn boss_hide(&mut self, window: &WebviewWindow) -> Result<()> {
        self.concealed = false;
        self.boss_hidden = true;
        self.left_at = None;
        self.hidden_bounds = None;
        if self.tray_available || self.shortcut_available {
            window.hide()?;
        } else {
            window.minimize()?;
        }
        self.broadcast(window);
        Ok(())
    }
    fn set_floating(&mut self, window: &WebviewWindow, value: bool) -> Result<()> {
        if self.floating == value {
            return Ok(());
        }
        let bounds = Bounds::read(window)?;
        let scale = window.scale_factor()?;
        if value {
            self.normal = Some(bounds);
        } else {
            self.floating_bounds = Some(bounds);
        }
        self.floating = value;
        window.set_min_size(Some(tauri::LogicalSize::new(
            if value { 320.0 } else { 850.0 },
            if value { 380.0 } else { 580.0 },
        )))?;
        let desired = if value {
            self.floating_bounds.unwrap_or(Bounds {
                x: bounds.x + bounds.width as i32 - (450.0 * scale) as i32,
                y: bounds.y + (40.0 * scale) as i32,
                width: (450.0 * scale) as u32,
                height: (620.0 * scale) as u32,
            })
        } else {
            self.normal.unwrap_or(Bounds {
                width: (1180.0 * scale) as u32,
                height: (780.0 * scale) as u32,
                ..bounds
            })
        };
        desired.apply(window)?;
        window.set_always_on_top(value && self.settings.always_on_top)?;
        self.reveal(window, true)
    }
    fn tick(&mut self, window: &WebviewWindow) -> Result<()> {
        if self.boss_hidden
            || !self.floating
            || !self.settings.auto_hide
            || !self.platform.can_track_cursor()
        {
            return Ok(());
        }
        if self.renderer_locked || self.dialog_locks > 0 {
            self.left_at = None;
            return Ok(());
        }
        let Some(point) = self.platform.cursor(window) else {
            return Ok(());
        };
        let bounds = if self.concealed {
            self.hidden_bounds.context("隐藏窗口区域丢失。")?
        } else {
            Bounds::read(window)?
        };
        self.hovered = bounds.contains(point);
        if self.hovered {
            self.left_at = None;
            if self.concealed {
                self.reveal(window, false)?;
            }
        } else if !self.concealed {
            let left = self.left_at.get_or_insert_with(Instant::now);
            if left.elapsed() >= Duration::from_millis(self.settings.hide_delay) {
                self.hidden_bounds = Some(bounds);
                window.hide()?;
                self.concealed = true;
                self.left_at = None;
                self.broadcast(window);
            }
        }
        Ok(())
    }
}

fn trusted(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        bail!("请求来源无效。");
    }
    if !app_url(&window.url()?) {
        bail!("请求地址无效。");
    }
    Ok(())
}

fn app_url(url: &tauri::Url) -> bool {
    let local = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost");
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5173);
    local || development
}

fn id(payload: &Value) -> Result<&str> {
    payload["id"].as_str().context("缺少书籍编号。")
}
fn result<T>(result: Result<T>) -> std::result::Result<T, String> {
    result.map_err(|e| format!("{e:#}"))
}

async fn main_action(
    app: tauri::AppHandle,
    action: String,
    payload: Value,
) -> std::result::Result<Value, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(result(window_action(&handle, &action, &payload)));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

fn window_action(app: &tauri::AppHandle, action: &str, payload: &Value) -> Result<Value> {
    let runtime = app.state::<Runtime>();
    let window = app.get_webview_window("main").context("主窗口不可用。");
    let window = window?;
    let mut desktop = runtime
        .desktop
        .lock()
        .map_err(|_| anyhow::anyhow!("窗口状态不可用。"))?;
    match action {
        "state" => {}
        "floating" => desktop.set_floating(&window, payload.as_bool().unwrap_or(false))?,
        "hover" => {
            if !desktop.platform.can_track_cursor() {
                desktop.hovered = payload.as_bool().unwrap_or(false);
            }
        }
        "lock" => {
            desktop.renderer_locked = payload.as_bool().unwrap_or(false);
            desktop.left_at = None;
        }
        "dialog-open" => {
            desktop.dialog_locks += 1;
            desktop.left_at = None;
        }
        "dialog-close" => {
            desktop.dialog_locks = desktop.dialog_locks.saturating_sub(1);
            desktop.left_at = None;
        }
        "opacity" => desktop.platform.set_opacity(
            &window,
            payload.as_f64().filter(|v| v.is_finite()).unwrap_or(1.0),
        )?,
        "settings" => {
            desktop.settings = serde_json::from_value(payload.clone())?;
            desktop.left_at = None;
            window.set_always_on_top(desktop.floating && desktop.settings.always_on_top)?;
            if !desktop.settings.auto_hide && desktop.concealed {
                desktop.reveal(&window, false)?;
            }
            desktop.opacity(&window)?;
        }
        "wake" => desktop.reveal(&window, true)?,
        "boss" => desktop.boss_hide(&window)?,
        "toggle-boss" => {
            if desktop.concealed
                || desktop.boss_hidden
                || !window.is_visible()?
                || window.is_minimized()?
            {
                desktop.reveal(&window, true)?;
            } else {
                desktop.boss_hide(&window)?;
            }
        }
        "reset-opacity" => {
            desktop.settings.window_opacity = 1.0;
            desktop.settings.background_opacity = 1.0;
            desktop.settings.text_opacity = 1.0;
            runtime
                .library
                .lock()
                .map_err(|_| anyhow::anyhow!("书架不可用。"))?
                .save_settings(&serde_json::to_value(&desktop.settings)?)?;
            desktop.reveal(&window, true)?;
            window.emit("window:reset-opacity", ())?;
        }
        "minimize" => window.minimize()?,
        "drag" => window.start_dragging()?,
        "close" => {
            if desktop.tray_available {
                desktop.boss_hide(&window)?;
            } else {
                app.exit(0);
            }
        }
        "quit" => app.exit(0),
        _ => bail!("不支持的窗口操作。"),
    }
    Ok(serde_json::to_value(desktop.state())?)
}

#[tauri::command]
async fn reader_command(
    app: tauri::AppHandle,
    window: WebviewWindow,
    action: String,
    payload: Option<Value>,
) -> std::result::Result<Value, String> {
    result(trusted(&window))?;
    let payload = payload.unwrap_or(Value::Null);
    if let Some(action) = action.strip_prefix("window:") {
        return main_action(app, action.into(), payload).await;
    }
    if action == "library:import" {
        main_action(app.clone(), "dialog-open".into(), Value::Null).await?;
        let handle = app.clone();
        let imported = tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
            let files = handle
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("添加到书架")
                .add_filter("电子书", &["txt", "epub"])
                .blocking_pick_files()
                .unwrap_or_default();
            let runtime = handle.state::<Runtime>();
            let mut store = runtime
                .library
                .lock()
                .map_err(|_| anyhow::anyhow!("书架不可用。"))?;
            let mut books = Vec::new();
            let mut errors = Vec::new();
            for file in files {
                match file
                    .into_path()
                    .map_err(anyhow::Error::from)
                    .and_then(|path| {
                        store.import_file(&path).map_err(|e| {
                            anyhow::anyhow!(
                                "{}：{e:#}",
                                path.file_name().unwrap_or_default().to_string_lossy()
                            )
                        })
                    }) {
                    Ok(book) => books.push(book),
                    Err(error) => errors.push(error.to_string()),
                }
            }
            Ok(json!({"books": books, "errors": errors}))
        })
        .await;
        let unlock = main_action(app, "dialog-close".into(), Value::Null).await;
        let value = result(imported.map_err(anyhow::Error::from).and_then(|r| r))?;
        unlock?;
        return Ok(value);
    }
    let handle = app.clone();
    let settings = action == "settings:save";
    let value = tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
        let runtime = handle.state::<Runtime>();
        let mut store = runtime
            .library
            .lock()
            .map_err(|_| anyhow::anyhow!("书架不可用。"))?;
        match action.as_str() {
            "library:get" => Ok(serde_json::to_value(&store.state)?),
            "book:open" => Ok(json!({"book": store.open_book(id(&payload)?)?})),
            "book:chapter" => Ok(json!(store.read_chapter(
                id(&payload)?,
                payload["index"]
                    .as_u64()
                    .and_then(|i| usize::try_from(i).ok())
                    .context("章节不存在。")?
            )?)),
            "book:remove" => {
                store.remove_book(id(&payload)?)?;
                Ok(Value::Null)
            }
            "book:progress" => {
                store.save_progress(id(&payload)?, &payload["progress"])?;
                Ok(Value::Null)
            }
            "settings:save" => Ok(serde_json::to_value(store.save_settings(&payload)?)?),
            _ => bail!("不支持的阅读器操作。"),
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let value = result(value)?;
    if settings {
        main_action(app, "settings".into(), value.clone()).await?;
    }
    Ok(value)
}

#[tauri::command]
async fn read_epub(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> std::result::Result<tauri::ipc::Response, String> {
    result(trusted(&window))?;
    result(
        tauri::async_runtime::spawn_blocking(move || -> Result<_> {
            let runtime = app.state::<Runtime>();
            let store = runtime
                .library
                .lock()
                .map_err(|_| anyhow::anyhow!("书架不可用。"))?;
            // 使用二进制 IPC，避免把最大 80 MB 的书籍展开成 JSON 数字数组。
            Ok(tauri::ipc::Response::new(store.read_epub(&id)?))
        })
        .await
        .map_err(anyhow::Error::from)
        .and_then(|r| r),
    )
}

fn legacy_directory() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("QUIETLEAF_LEGACY_DATA") {
        return Some(path.into());
    }
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("quietleaf-reader"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config")))
            .map(|p| p.join("quietleaf-reader"))
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        image::Image,
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let show = MenuItem::with_id(app, "show", "打开隐页", true, None::<&str>)?;
    let normal = MenuItem::with_id(app, "normal", "退出悬浮模式", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "恢复不透明并显示", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &normal, &reset, &separator, &quit])?;
    TrayIconBuilder::with_id("reader-tray")
        .icon(Image::from_bytes(include_bytes!(
            "../../resources/tray.png"
        ))?)
        .tooltip("隐页阅读 Rust · Ctrl+Shift+Space 显示或隐藏")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let (action, payload) = match event.id.as_ref() {
                "show" => ("wake", Value::Null),
                "normal" => ("floating", Value::Bool(false)),
                "reset" => ("reset-opacity", Value::Null),
                "quit" => ("quit", Value::Null),
                _ => return,
            };
            if let Err(error) = window_action(app, action, &payload) {
                log_error(app, &error);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = window_action(tray.app_handle(), "wake", &Value::Null) {
                    log_error(tray.app_handle(), &error);
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn log_error(app: &tauri::AppHandle, error: &anyhow::Error) {
    if let Some(runtime) = app.try_state::<Runtime>() {
        if let Ok(store) = runtime.library.lock() {
            store.log(&format!("{error:#}"));
        }
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11") {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = window_action(app, "wake", &Value::Null);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![reader_command, read_epub])
        .setup(|app| {
            let root = std::env::var_os("QUIETLEAF_RUST_DATA")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_config_dir()?);
            let migration = legacy_directory().map(|source| migrate_legacy(&source, &root));
            let store = LibraryStore::open(root)?;
            if let Some(Err(error)) = migration {
                store.log(&format!("旧版书架迁移失败，旧数据未修改：{error:#}"));
            }
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("隐页阅读 Rust")
                    .inner_size(1180.0, 780.0)
                    .min_inner_size(850.0, 580.0)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .visible(false)
                    .background_color(tauri::window::Color(0, 0, 0, 0))
                    .disable_drag_drop_handler()
                    .on_navigation(|url| app_url(url) || matches!(url.scheme(), "blob" | "about"))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
                    .build()?;
            let desktop = Desktop::new(&window, store.state.settings.clone());
            app.manage(Runtime {
                library: Mutex::new(store),
                desktop: Mutex::new(desktop),
                stopping: AtomicBool::new(false),
                tick_queued: AtomicBool::new(false),
            });
            let shortcut =
                app.global_shortcut()
                    .on_shortcut("Ctrl+Shift+Space", |app, _, event| {
                        if event.state == ShortcutState::Pressed {
                            let handle = app.clone();
                            let _ = app.run_on_main_thread(move || {
                                if let Err(error) =
                                    window_action(&handle, "toggle-boss", &Value::Null)
                                {
                                    log_error(&handle, &error);
                                }
                            });
                        }
                    });
            let _ = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+0", |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            let _ = window_action(&handle, "reset-opacity", &Value::Null);
                        });
                    }
                });
            let tray = setup_tray(app);
            {
                let runtime = app.state::<Runtime>();
                let mut desktop = runtime.desktop.lock().unwrap();
                desktop.shortcut_available = shortcut.is_ok();
                desktop.tray_available = tray.is_ok();
                if let Err(error) = desktop.opacity(&window) {
                    log_error(app.handle(), &error);
                }
            }
            if let Err(error) = shortcut {
                log_error(app.handle(), &anyhow::anyhow!("老板键注册失败：{error}"));
            }
            if let Err(error) = tray {
                log_error(app.handle(), &anyhow::anyhow!("托盘不可用：{error}"));
            }
            window.show()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                while !handle.state::<Runtime>().stopping.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(100));
                    // 主线程忙碌时只保留一个待执行检查，避免积压光标轮询消息。
                    if handle
                        .state::<Runtime>()
                        .tick_queued
                        .swap(true, Ordering::Relaxed)
                    {
                        continue;
                    }
                    let app = handle.clone();
                    if handle
                        .run_on_main_thread(move || {
                            let runtime = app.state::<Runtime>();
                            if let Some(window) = app.get_webview_window("main") {
                                let outcome = runtime.desktop.lock().map(|mut d| d.tick(&window));
                                if let Ok(Err(error)) = outcome {
                                    log_error(&app, &error);
                                }
                            }
                            runtime.tick_queued.store(false, Ordering::Relaxed);
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if let Some(runtime) = app.try_state::<Runtime>() {
                    let tray = runtime
                        .desktop
                        .lock()
                        .map(|d| d.tray_available)
                        .unwrap_or(false);
                    if tray {
                        api.prevent_close();
                        let _ = window_action(app, "boss", &Value::Null);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("无法启动隐页阅读 Rust")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(runtime) = app.try_state::<Runtime>() {
                    runtime.stopping.store(true, Ordering::Relaxed);
                }
            }
        });
}
