use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ConnectionExt, PropMode},
    rust_connection::RustConnection,
    wrapper::ConnectionExt as _,
};

pub struct Platform {
    #[cfg(target_os = "linux")]
    x11: Option<X11>,
}

#[cfg(target_os = "linux")]
struct X11 {
    connection: RustConnection,
    root: u32,
    window: u32,
    opacity: u32,
    composited: bool,
}

impl Platform {
    pub fn new(window: &WebviewWindow) -> Self {
        #[cfg(target_os = "linux")]
        let x11 = Self::connect_x11(window).ok();
        #[cfg(not(target_os = "linux"))]
        let _ = window;
        Self {
            #[cfg(target_os = "linux")]
            x11,
        }
    }

    #[cfg(target_os = "linux")]
    fn connect_x11(window: &WebviewWindow) -> anyhow::Result<X11> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        let window = match window.window_handle()?.as_raw() {
            RawWindowHandle::Xlib(handle) => handle.window as u32,
            RawWindowHandle::Xcb(handle) => handle.window.get(),
            _ => anyhow::bail!("当前不是 X11 窗口。"),
        };
        let (connection, screen) = x11rb::connect(None)?;
        let root = connection.setup().roots[screen].root;
        let opacity = connection
            .intern_atom(false, b"_NET_WM_WINDOW_OPACITY")?
            .reply()?
            .atom;
        let selection = connection
            .intern_atom(false, format!("_NET_WM_CM_S{screen}").as_bytes())?
            .reply()?
            .atom;
        let composited = connection.get_selection_owner(selection)?.reply()?.owner != 0;
        Ok(X11 {
            connection,
            root,
            window,
            opacity,
            composited,
        })
    }

    pub fn native_opacity(&self) -> bool {
        #[cfg(windows)]
        {
            true
        }
        #[cfg(target_os = "linux")]
        {
            self.x11.as_ref().is_some_and(|x| x.composited)
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            false
        }
    }

    pub fn can_track_cursor(&self) -> bool {
        #[cfg(windows)]
        {
            true
        }
        #[cfg(target_os = "linux")]
        {
            self.x11.is_some()
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            false
        }
    }

    pub fn cursor(&self, window: &WebviewWindow) -> Option<(f64, f64)> {
        #[cfg(target_os = "linux")]
        {
            let _ = window;
            let x = self.x11.as_ref()?;
            let pointer = x.connection.query_pointer(x.root).ok()?.reply().ok()?;
            Some((pointer.root_x as f64, pointer.root_y as f64))
        }
        #[cfg(not(target_os = "linux"))]
        {
            window.cursor_position().ok().map(|p| (p.x, p.y))
        }
    }

    pub fn set_opacity(&self, window: &WebviewWindow, opacity: f64) -> anyhow::Result<()> {
        let opacity = opacity.clamp(0.01, 1.0);
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
                LWA_ALPHA, WS_EX_LAYERED,
            };
            let hwnd = window.hwnd()?.0 as _;
            // 整窗透明与网页背景 alpha 分开处理，背景模式始终使用 255。
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED as isize);
                if SetLayeredWindowAttributes(hwnd, 0, (opacity * 255.0).round() as u8, LWA_ALPHA)
                    == 0
                {
                    anyhow::bail!("无法调整整窗透明度：{}", std::io::Error::last_os_error());
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            let _ = window;
            if let Some(x) = self.x11.as_ref().filter(|x| x.composited) {
                x.connection
                    .change_property32(
                        PropMode::REPLACE,
                        x.window,
                        x.opacity,
                        AtomEnum::CARDINAL,
                        &[(opacity * u32::MAX as f64).round() as u32],
                    )?
                    .check()?;
                x.connection.flush()?;
            }
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = (window, opacity);
        }
        Ok(())
    }

    pub fn show_inactive(&self, window: &WebviewWindow) -> tauri::Result<()> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
            unsafe {
                ShowWindow(window.hwnd()?.0 as _, SW_SHOWNOACTIVATE);
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            // GTK 显示窗口前暂时禁止接收焦点，避免移回阅读区抢走办公软件输入。
            window.set_focusable(false)?;
            let result = window.show();
            let _ = window.set_focusable(true);
            result
        }
    }
}
