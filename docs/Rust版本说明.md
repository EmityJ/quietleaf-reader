# 隐页阅读 Rust 版

Rust 版使用 Tauri 2、Rust 核心、Vue 3 和 epub.js。书架、文件导入、TXT 解码与章节索引、EPUB 容器检查、进度保存、托盘和窗口控制均由 Rust 实现；阅读界面与 EPUB 排版复用现有代码。

目标平台是 Windows x64，以及 UOS 专业版 1070、飞腾 FT-2000 ARM64、X11。按本次开发要求，跳过 UOS 前置验证，直接实现平台适配和构建配置；这不代表已完成 UOS 实机验收。

## 开发与构建

通用环境需要 Rust stable、Node.js 22.12 以上，以及平台开发依赖。仓库根目录是 Cargo workspace：`crates/reader-core` 为独立核心，`src-tauri` 为桌面应用。

```bash
npm ci
npm run dev:rust
npm run build:rust
```

Windows 标准工具链使用 MSVC，需要 Visual Studio C++ Build Tools 与 WebView2。当前开发机也可以复用相邻 `screen-craft/.tools` 中的 Rust GNU 与 LLVM-MinGW：

```powershell
npm run dev:rust:local
npm run pack:rust:win:local
```

`scripts/rust.ps1` 优先读取本项目 `.tools`，其次读取相邻项目的工具；也可通过 `QUIETLEAF_RUST_TOOLS` 指定工具目录。缓存写到本项目 `.cache/cargo`，产物写到 `target`，不修改工具来源项目。

普通 Windows 构建与压缩包使用：

```powershell
npm run pack:rust:win
```

输出位于 `release/rust/0.1.4/`，包括 Windows ZIP、SHA256 校验和构建信息。打包脚本读取 EXE 与附带 DLL 的普通、延迟导入表，递归收集应用依赖，并在缺少文件或架构不一致时阻止打包。构建信息记录 DLL 文件、哈希与导入清单。

Windows GNU 构建需要随应用附带 `WebView2Loader.dll`，修正后的 ZIP 已包含它。必须完整解压，保持 EXE 和 DLL 位于同一目录。`WebView2Loader.dll` 是加载器；系统 WebView2 Runtime 是另一项运行依赖，ZIP 不包含完整运行时，离线机器应预先安装。

## UOS / Linux

Linux 端依赖 WebKitGTK 4.1、GTK 3 和 Ayatana AppIndicator。必须以目标 UOS 软件仓库中的实际可用库为准。DEB 和 tar.gz 都不会消除系统动态库依赖，不能将较新系统生成的二进制直接视为兼容旧 UOS。

Ubuntu / Debian 构建环境示例：

```bash
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf binutils
npm ci
npm run pack:rust:linux:x64
```

ARM64 应优先在 ARM64 Linux 构建机上执行：

```bash
npm ci
npm run pack:rust:linux:arm64
```

两个架构均输出 DEB、tar.gz、SHA256 和包含 ELF 架构及 glibc 版本要求的构建信息。ARM64 命令不会自动安装交叉编译器或目标系统动态库；在 x64 主机上执行时需自行准备完整交叉编译环境。CI 配置使用原生 ARM64 runner，见 `.github/workflows/rust.yml`，需上传仓库后才会执行。

UOS 安装方式：

```bash
sudo apt install ./quietleaf-rust-0.1.4-linux-arm64.deb
quietleaf-rust
```

X11 通过 Rust 的 X11 连接设置 `_NET_WM_WINDOW_OPACITY`，无需启动 `xprop`。背景模式保持原生整窗透明度为 100%，背景和文字分别控制透明度。开启自动隐藏后，移出延时隐藏原生窗口，移回原窗口区域恢复；老板键隐藏不因鼠标经过而恢复。

Wayland 无法通过本实现获取全桌面鼠标坐标，因此暂不提供移出隐藏、原区域移回恢复；托盘、快捷键等能力由实际桌面环境决定。UOS 首版以 X11 为目标。

## 数据和升级

Rust 版使用系统配置目录下的 `local.quietleaf.reader.rust`，包含 `library.json`、`books/` 与 `reader.log`。首次启动、目标目录尚不存在且能找到旧版 `quietleaf-reader/library.json` 时，会复制旧版已登记的书籍、UTF-8 缓存、章节索引、进度和偏好，再写入迁移记录。两版不会同时写同一书架。

旧版数据不移动、不删除。迁移失败会写入 Rust 版日志，然后建立新书架。书架移除操作只删除应用管理的副本。

可通过环境变量调整路径：

- `QUIETLEAF_RUST_DATA`：Rust 版数据目录。
- `QUIETLEAF_LEGACY_DATA`：首次迁移读取的旧版目录。
- `QUIETLEAF_RUST_TOOLS`：Windows 本地工具包根目录。

TXT 支持 UTF-8、带 BOM 的 UTF-16 和 GB18030 回退，按 UTF-8 字节区间读取章节。保留现有 24 MB TXT、80 MB EPUB 限制，以及 EPUB 内部文件数量、解压尺寸和目录 XML 限制。

## 接口边界

桌面只开放受限阅读器命令、二进制 EPUB 读取和状态事件；书籍读写只接受书架中已有的编号。文件选择由 Rust 端发起，不向界面暴露任意文件路径读取、Shell 或通用文件系统接口。

EPUB iframe 不允许脚本，章节渲染前额外移除脚本、事件属性、嵌入页面、表单、刷新跳转和外部链接，配合内容安全策略限制外部资源。EPUB 通过二进制 IPC 传递，避免大书籍被展开为 JSON 数组。

Tauri Linux 无法仅靠窗口能力区分 iframe 与主页面，因此不能放开书籍脚本或把第三方网页加入主窗口。复杂固定版式、DRM、音视频、云同步和自动更新仍不在本版范围内。
