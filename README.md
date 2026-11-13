# 隐页阅读

现已加入 **Rust + Tauri 2 桌面版本**，复用现有阅读界面，使用独立书架并支持首次复制旧版数据。开发、打包和 UOS 依赖见 [Rust 版本说明](docs/Rust版本说明.md)。Windows 当前开发机可运行 `npm run dev:rust:local`，标准环境使用 `npm run dev:rust`。

基于 Electron、Vue 3 与 TypeScript 的离线阅读器，支持 TXT、EPUB 和透明悬浮阅读。开发目标为 Windows x64 与统信 UOS 专业版 1070 ARM64，UOS 飞腾实机适配仍需验收。

## 本地启动

需要 Node.js 22.12 或更新版本，推荐 Node.js 24。使用项目锁定的依赖：

```powershell
npm ci
npx install-electron
npm run dev
```

Electron 44 的运行时由 `install-electron` 下载；如果已经下载，可跳过这一行。`npm run dev` 同时启动本地 Vite 服务和 Electron 窗口，服务仅监听 127.0.0.1。

构建后直接运行：

```powershell
npm run build
npm start
```

## 操作

- 导入 EPUB/TXT：点击“导入书籍”，或按 Ctrl+O。
- 阅读：点击封面；目录用于跳转章节，左右方向键切换章节或 EPUB 页面。
- TXT 搜索：使用阅读页底部的当前章节查找。
- 悬浮：打开书籍后，点击右上角悬浮按钮。
- 背景透明、文字清晰：进入悬浮阅读，点击眼睛图标，默认分别调节背景透明度（0%–100%）和文字可见度（20%–100%）。背景默认 12%、文字默认 100%；“背景全透明，文字清晰”预设可透出底下的 Word 或其他窗口。
- 整窗透明：在同一面板选择“整窗一起透明”，保留原先标题栏、按钮、正文与背景统一变淡的方式，范围 1%–100%。
- 恢复不透明：按 Ctrl+Alt+0，或使用透明度弹层和托盘菜单中的恢复入口。
- 自动隐藏：在悬浮模式右上角、整窗透明度按钮左侧，点击鼠标图标开关；开启后鼠标移出按设定延迟让整个窗口变为 0% 透明度，不显示任何提示。鼠标移回原窗口区域，恢复原先设置的透明度；设置与透明度弹层打开时暂停隐藏。
- 老板键：Ctrl+Shift+Space 显示或隐藏，也可通过托盘菜单恢复。
- 关闭窗口：托盘可用时收起到后台；从托盘菜单或阅读偏好中退出应用。

书架内提供一份原创示例 TXT。导入文件按内容去重，原件不被移动；从书架移除只删除应用管理的副本。

## 检查与打包

```powershell
npm test
npm run build
npm run test:e2e
npm run pack:win
node scripts/smoke-packaged.mjs
```

Windows ZIP 输出到 `release/版本号/`，解压后运行 `quietleaf.exe`，保留同目录的运行文件。桌面流程测试会启动 Electron，测试数据位于 `.test-data/`。

在新的 Linux 环境执行：

```bash
npm ci
npx install-electron
npm run pack:linux:x64
npm run pack:linux:arm64
```

Linux 输出 DEB、tar.gz、SHA256 校验文件与构建检查 JSON。Linux 封装需要 Python 3、dpkg-deb 和 readelf；Windows 执行同一打包命令时使用现有 WSL 的默认发行版，并要求其中具备这些工具。本次已使用 Ubuntu 22.04 WSL 生成 0.1.4 ARM64 包，安装步骤见 [UOS ARM64 安装说明](docs/UOS-ARM64安装说明.md)。

0.1.3 针对 UOS X11 的系统外框残留进行适配：支持 EWMH 整窗透明度的窗口管理器使用系统合成，页面不重复淡化；鼠标移出时隐藏原生窗口，移回原窗口区域后恢复。DEB 新增 `x11-utils` 依赖，提供 `xprop`。Linux X11 回归可在安装 xvfb、xauth、openbox、xcompmgr、x11-utils 后运行 `bash scripts/test-linux-x11.sh`，需要先构建 Linux x64 目录。

0.1.4 默认采用独立背景模式，在 X11 中保持系统整窗透明度为 100%，在页面中分别绘制背景和正文；整窗模式继续使用上面的系统合成。旧设置的整窗透明度自动转作背景透明度，书籍、阅读进度和数据目录不变。

生成 ARM64 包不等于已通过 UOS ARM64 验证。CentOS 6 不适合构建本项目，请另建 UOS 1070 x86_64 或受支持的 Ubuntu/Debian 桌面虚拟机。

持续集成配置位于 `.github/workflows/ci.yml`，提供 Windows x64、Linux x64 与 Linux ARM64 检查；这份本地配置尚未自动上传或触发远端任务。

## 本机数据

应用使用 Electron 的 `userData` 目录：Windows 通常为 `%APPDATA%/quietleaf-reader`，Linux 通常为 `~/.config/quietleaf-reader`。目录包含 `library.json`、`books/` 和 `reader.log`。如需备份，退出应用后复制整个目录。

TXT 支持 UTF-8、带 BOM 的 UTF-16 和 GB18030 自动回退。单本 TXT 上限 24 MB，EPUB 上限 80 MB；复杂固定版式、DRM 和音视频不在首版范围内。

## 开发文档

- [开发计划](docs/开发计划.md)
- [UOS 验收清单](docs/UOS验收清单.md)
- [本地验证记录](docs/验证记录.md)

主进程位于 `electron/`，负责文件管理、窗口与托盘。界面位于 `src/`，电子书子页面不暴露本机接口；设置和进度均保存到本地。
