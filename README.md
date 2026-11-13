<div align="center">
  <img src="resources/icon.png" alt="隐页阅读图标" width="80" height="80">
  <h1>隐页阅读</h1>
  <p><strong>留一页，给自己。</strong></p>
  <p>把喜欢的书放进书架，也把一点安静留在桌面。<br>支持 EPUB 与 TXT，记住阅读进度，还能化成桌边的一扇小窗。</p>
  <p>
    <a href="https://github.com/EmityJ/quietleaf-reader/releases/latest"><strong>下载最新版</strong></a>
    · <a href="#三步开始阅读">快速上手</a>
    · <a href="#常见问题">使用帮助</a>
    · <a href="LICENSE">MIT 开源</a>
  </p>
</div>

![隐页阅读书架：导入本地电子书，按最近阅读、已经读完或书名查找](docs/screenshots/library.png)

<p align="center"><sub>打开一本书，让片刻闲暇有个温柔的去处。</sub></p>

## 为日常阅读准备的小细节

- **喜欢的书，放在一起。** 导入 EPUB 和 TXT，用书名、作者或格式找到想读的那一本。
- **读到哪里，下次接着。** 自动保存阅读位置，也能查看最近阅读、把读完的书单独收好。
- **让眼睛舒服一点。** 按自己的习惯调节字体、字号、行距和主题，阅读时随时调整。
- **给桌面留一点空间。** 切换为置顶悬浮小窗，调淡背景、保留清晰文字；需要时一键隐藏。
- **书和记录，都留在本机。** 无需注册，导入自己的书即可离线阅读。

## 下载与安装

**第一次在 Windows 上使用，推荐选择常规版：下载、完整解压，双击就能打开。**

| 你的电脑                      | 下载哪个                                                                                                                                                                                                                                 | 怎么打开                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Windows x64 · 常规版          | [下载 ZIP](https://github.com/EmityJ/quietleaf-reader/releases/download/v0.1.4/quietleaf-0.1.4-win-x64.zip)                                                                                                                              | 完整解压后，双击 `quietleaf.exe`                                 |
| Windows x64 · Rust 版（可选） | [下载 ZIP](https://github.com/EmityJ/quietleaf-reader/releases/download/v0.1.4/quietleaf-rust-0.1.4-win-x64.zip)                                                                                                                         | 完整解压后，双击 `quietleaf-rust.exe`；系统需要 WebView2 Runtime |
| UOS / Linux ARM64 · 常规版    | [DEB 安装包](https://github.com/EmityJ/quietleaf-reader/releases/download/v0.1.4/quietleaf-0.1.4-linux-arm64.deb) · [解压运行包](https://github.com/EmityJ/quietleaf-reader/releases/download/v0.1.4/quietleaf-0.1.4-linux-arm64.tar.gz) | 推荐使用 DEB，按 [UOS 安装说明](docs/UOS-ARM64安装说明.md) 安装  |

上表对应 **v0.1.4**。更多版本与校验文件可在 [下载页面](https://github.com/EmityJ/quietleaf-reader/releases/latest) 找到。页面里的 `Source code` 是源码，日常使用请选择上面的应用包。

> Windows 解压后请保留整个文件夹，不要只把 EXE 拿出来。Rust 版也需要保留随附的 DLL。
>
> UOS ARM64 当前提供测试包，面向统信 UOS 专业版 1070、飞腾与 X11 桌面；目标设备上的兼容性仍待实机验收。

## 三步开始阅读

1. **打开隐页。** 第一次打开时，书架里已有一份原创示例读物，可以先点开试读。
2. **放入自己的书。** 点击右上角「导入书籍」，选择电脑里的 EPUB 或 TXT 文件。
3. **点击封面，开始读。** 用目录跳转章节，用左右方向键翻页；字体、字号和主题可以在「阅读偏好」里调整。

导入会为书架保存一份副本，原来的文件不会被移动。从书架移除书籍，也不会删除你原来的文件。

## 一整页，或桌边的一小窗

<table>
  <tr>
    <th>安静读一整页</th>
    <th>也可以只占一小角</th>
  </tr>
  <tr>
    <td align="center" valign="top" width="68%">
      <img src="docs/screenshots/epub.png" alt="EPUB 阅读界面：目录、正文与翻页按钮" width="680">
    </td>
    <td align="center" valign="top" width="32%">
      <img src="docs/screenshots/floating.png" alt="悬浮阅读小窗：保持阅读内容，减少桌面占用" width="300">
    </td>
  </tr>
</table>

<p align="center"><sub>截图来自常规版（Electron）界面，部分按钮布局可能与当前版本略有差异。</sub></p>

打开一本书后，点击阅读页右上角的「悬浮阅读」，就能把它变成置顶小窗。

- **想让背景淡一点：** 点击眼睛图标，调节背景透明度和文字清晰度。选择「背景全透明，文字清晰」，可以透出下方窗口，同时保留清楚的正文。
- **想在暂时离开时隐藏：** 打开小窗右上角的鼠标图标开关。鼠标移出后，窗口按设定延迟隐藏；移回原来的位置，就会恢复。
- **想马上收起：** 按 `Ctrl + Shift + Space` 隐藏窗口，再按一次恢复。也可以从系统托盘找回。

如果调得太淡、看不清了，按 **`Ctrl + Alt + 0`** 即可恢复不透明。

### 几个顺手的快捷键

| 想做什么                         | 按什么                 |
| -------------------------------- | ---------------------- |
| 导入书籍                         | `Ctrl + O`             |
| 上一章 / 上一页、下一章 / 下一页 | `←` / `→`              |
| 显示或隐藏窗口                   | `Ctrl + Shift + Space` |
| 恢复不透明                       | `Ctrl + Alt + 0`       |

## 常见问题

<details>
<summary><strong>支持哪些电子书？</strong></summary>

支持常见的无加密 EPUB 和 TXT。TXT 支持常见中文编码，单本最大 24 MB；EPUB 单本最大 80 MB。带数字版权保护的电子书，以及复杂固定版式、音视频内容暂不支持。

</details>

<details>
<summary><strong>窗口不见了，怎么找回来？</strong></summary>

先试试 `Ctrl + Shift + Space`，或从系统托盘恢复窗口。如果开启了鼠标移出隐藏，把鼠标移回小窗原来的位置即可。窗口只是太透明时，按 `Ctrl + Alt + 0` 恢复。

点击窗口关闭按钮时，托盘可用的情况下会收起到后台。需要完全退出时，请在托盘菜单或「阅读偏好」里选择退出。

</details>

<details>
<summary><strong>更新版本后，书和进度还在吗？</strong></summary>

常规版更新后会继续使用原有的本机书架。更新前，先从托盘退出旧版，再解压并打开新版。

Rust 版使用独立书架。首次启动时，如果能找到常规版的旧书架，会复制书籍、进度和偏好，旧版数据保留不动；之后两个版本各自保存。详见 [Rust 版本说明](docs/Rust版本说明.md#数据和升级)。

</details>

<details>
<summary><strong>书和进度保存在哪里，怎么备份？</strong></summary>

常规版在 Windows 上通常保存在 `%APPDATA%/quietleaf-reader`，Linux 上通常为 `~/.config/quietleaf-reader`。备份前先完全退出应用，再复制整个文件夹。

Rust 版使用系统配置目录下的 `local.quietleaf.reader.rust` 文件夹，具体说明见 [数据和升级](docs/Rust版本说明.md#数据和升级)。

</details>

使用中遇到问题，欢迎 [反馈给我们](https://github.com/EmityJ/quietleaf-reader/issues)。附上系统版本、应用版本和遇到问题时的操作，能帮助更快定位。

## 开发与更多资料

只想阅读，下载上面的应用包就好。想了解实现或参与改进，可以展开下面的说明。

<details>
<summary><strong>从源码运行、检查与打包</strong></summary>

常规版使用 Electron、Vue 3 和 TypeScript；Rust 版使用 Tauri 2，并复用阅读界面。

### 运行常规版

需要 Node.js 22.12 或更新版本，推荐 Node.js 24。

```powershell
npm ci
npx install-electron
npm run dev
```

如果已经下载 Electron 运行时，可跳过 `npx install-electron`。构建后也可以执行 `npm run build`、`npm start` 运行。

### 检查与打包

```powershell
npm test
npm run format:check
npm run build
npm run test:e2e
npm run pack:win
node scripts/smoke-packaged.mjs
```

Windows ZIP 输出到 `release/版本号/`。Linux 可使用 `npm run pack:linux:x64` 或 `npm run pack:linux:arm64`；封装需要 Python 3、dpkg-deb 和 readelf，在 Windows 上通过已配置的 WSL 执行。

Rust 版的运行、工具链、系统依赖与打包步骤见 [Rust 版本说明](docs/Rust版本说明.md)，Windows 打包依赖检查可运行 `npm run test:pack:rust`。

- [开发计划](docs/开发计划.md)
- [本地验证记录](docs/验证记录.md)
- [UOS ARM64 安装说明](docs/UOS-ARM64安装说明.md)
- [UOS 验收清单](docs/UOS验收清单.md)
- [GitHub 自动构建记录](https://github.com/EmityJ/quietleaf-reader/actions)

</details>

## 开源许可

隐页阅读采用 [MIT 许可证](LICENSE)，允许使用、修改和分发，也可用于商业用途；请保留版权声明与许可证文本。

项目使用的第三方组件遵循各自的许可证。导入书籍的版权归原作者或权利人所有。
