# UOS ARM64 安装说明

本次交付为隐页 0.1.4 的 Linux ARM64 测试包，目标设备是统信 UOS 专业版 1070、飞腾 FT-2000。已完成打包、静态检查与本地 Linux X11 回归；本版在 UOS 飞腾实机上的装饰效果尚待复测。

## 推荐使用 DEB 安装

把 `quietleaf-0.1.4-linux-arm64.deb` 复制到 UOS，在文件所在目录打开终端：

```bash
sudo apt install ./quietleaf-0.1.4-linux-arm64.deb
```

安装后，从应用菜单启动“隐页阅读”，或者在普通用户终端运行：

```bash
quietleaf
```

安装使用 sudo，启动应用使用普通用户。DEB 包含桌面图标、命令入口、系统库依赖和沙箱辅助程序所需权限。

## 从旧版覆盖升级

先从托盘退出旧版，并备份 `${XDG_CONFIG_HOME:-$HOME/.config}/quietleaf-reader`。随后执行上面的 DEB 安装命令即可覆盖升级，无需卸载旧版。包名和用户数据目录保持不变，书籍、阅读进度和设置继续沿用。

安装包依赖 `x11-utils`，用于 X11 整窗透明度；由 apt 处理依赖。启动器入口仍为“隐页阅读”，不会自动在桌面创建快捷方式。

## 解压运行

也提供 `quietleaf-0.1.4-linux-arm64.tar.gz`：

```bash
tar -xzf quietleaf-0.1.4-linux-arm64.tar.gz
cd quietleaf-0.1.4-linux-arm64
./quietleaf
```

保留整个解压目录。若解压运行报告沙箱权限错误，改用上面的 DEB 安装方式。

## 核对文件与架构

将同目录的 `quietleaf-0.1.4-linux-arm64.sha256` 一起复制到 UOS 后，可核对两个安装文件：

```bash
sha256sum -c quietleaf-0.1.4-linux-arm64.sha256
uname -m
```

目标机器应为 `aarch64`，DEB 内部架构为 `arm64`，不适用于 ARM32。包内 6 个 ELF 已检查为 AArch64；随包二进制引用的 glibc 版本符号最高为 2.25，系统还需满足 DEB 列出的图形与音频库依赖。

## 透明背景与清晰正文

进入悬浮阅读，点击右上角眼睛按钮，选择“背景透明，文字清晰”。背景默认 12%、文字默认 100%；需要完全透出底下的 Word 时，点击“背景全透明，文字清晰”。如果底下内容太杂，可将背景提高到 10%–20%。

“整窗一起透明”保留原来的效果，会让文字也跟着变淡。Ctrl+Alt+0 可恢复背景和正文不透明。

## 首次实机检查

先检查 TXT、EPUB 导入和中文显示，再检查悬浮置顶、整窗透明度、移出全透明和移回恢复。实机项目见 [UOS 验收清单](UOS验收清单.md)。

如果无法启动，请保留终端完整错误，并记录：

```bash
uname -m
cat /etc/os-release
getconf GNU_LIBC_VERSION
printf '%s\n' "$XDG_SESSION_TYPE"
```

这些信息用于区分架构、系统库和桌面会话差异。
