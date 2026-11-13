"""使用 Debian 标准工具封装 Linux 产物，并核对实际 ELF 架构与 glibc 要求。"""

import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def main():
    root = Path(sys.argv[1]).resolve()
    arch = sys.argv[2]
    architectures = {"arm64": ("arm64", 183), "x64": ("amd64", 62)}
    if arch not in architectures:
        raise ValueError("不支持的 Linux 架构")
    deb_arch, machine = architectures[arch]
    metadata = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = metadata["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("当前封装脚本要求三段式版本号")
    for command in ("readelf", "dpkg-deb"):
        if not shutil.which(command):
            raise RuntimeError(f"Linux 环境缺少打包工具：{command}")
    output = root / "release" / version
    runtime = output / ("linux-arm64-unpacked" if arch == "arm64" else "linux-unpacked")
    if not (runtime / "quietleaf").is_file():
        raise RuntimeError("请先使用 electron-builder --linux --dir 生成目标架构目录")
    executables = {"quietleaf", "chrome-sandbox", "chrome_crashpad_handler"}
    elf_files = []
    glibc_versions = set()
    for file in sorted(runtime.rglob("*")):
        if not file.is_file():
            continue
        with file.open("rb") as stream:
            header = stream.read(20)
        if header[:4] != b"\x7fELF":
            continue
        if header[4:6] != b"\x02\x01" or struct.unpack("<H", header[18:20])[0] != machine:
            raise RuntimeError(f"文件不是目标架构的 64 位 ELF：{file}")
        versions = run("readelf", "--version-info", str(file))
        required = set(re.findall(r"\bGLIBC_([0-9]+(?:\.[0-9]+)+)\b", versions))
        glibc_versions.update(required)
        elf_files.append({"file": str(file.relative_to(runtime)), "machine": machine})
    if not elf_files or not glibc_versions:
        raise RuntimeError("未找到有效的 ELF 或 glibc 版本要求")
    glibc_min = max(glibc_versions, key=lambda value: tuple(map(int, value.split("."))))
    stem = f"quietleaf-{version}-linux-{arch}"
    deb = output / f"{stem}.deb"
    archive = output / f"{stem}.tar.gz"
    dependencies = [
        f"libc6 (>= {glibc_min})", "libgcc1 | libgcc-s1", "libstdc++6",
        "libasound2", "libatk1.0-0", "libatk-bridge2.0-0", "libatspi2.0-0",
        "libcairo2", "libcups2", "libdbus-1-3", "libexpat1", "libgbm1",
        "libglib2.0-0", "libgtk-3-0", "libnspr4", "libnss3", "libnotify4",
        "libpango-1.0-0", "libudev1", "libx11-6", "libxcb1", "libxcomposite1",
        "libxdamage1", "libxext6", "libxfixes3", "libxkbcommon0", "libxrandr2",
        "libxss1", "libxtst6", "xdg-utils", "x11-utils",
    ]
    # 临时目录位于 Linux 文件系统，避免 Windows 挂载盘丢失 POSIX 权限。
    with tempfile.TemporaryDirectory(prefix="quietleaf-linux-package-") as temporary:
        staging = Path(temporary)
        staging.chmod(0o755)
        app_dir = staging / "opt" / "quietleaf"
        shutil.copytree(runtime, app_dir, symlinks=True)
        app_dir.chmod(0o755)
        for file in app_dir.rglob("*"):
            if not file.is_symlink():
                file.chmod(0o755 if file.is_dir() or file.name in executables else 0o644)
        # DEB 以 root 所有权安装沙箱辅助程序，保持 Chromium 沙箱开启。
        (app_dir / "chrome-sandbox").chmod(0o4755)
        binary = staging / "usr" / "bin" / "quietleaf"
        binary.parent.mkdir(parents=True)
        binary.symlink_to("/opt/quietleaf/quietleaf")
        desktop = staging / "usr/share/applications/quietleaf.desktop"
        desktop.parent.mkdir(parents=True)
        desktop.write_text(
            "[Desktop Entry]\nType=Application\nName=隐页阅读\n"
            "Comment=EPUB 与 TXT 离线阅读器\nExec=/opt/quietleaf/quietleaf\n"
            "Icon=quietleaf\nTerminal=false\nCategories=Office;\n",
            encoding="utf-8",
        )
        icon = staging / "usr/share/pixmaps/quietleaf.png"
        icon.parent.mkdir(parents=True)
        shutil.copyfile(root / "resources/icon.png", icon)
        control_dir = staging / "DEBIAN"
        control_dir.mkdir()
        installed_size = sum(file.stat().st_size for file in app_dir.rglob("*") if file.is_file()) // 1024
        (control_dir / "control").write_text(
            f"Package: quietleaf-reader\nVersion: {version}\nArchitecture: {deb_arch}\n"
            "Section: utils\nPriority: optional\nMaintainer: QuietLeaf Contributors\n"
            f"Installed-Size: {installed_size}\nDepends: {', '.join(dependencies)}\n"
            "Recommends: fonts-noto-cjk\n"
            "Description: 隐页 EPUB 与 TXT 离线阅读器\n"
            " 支持本地书架、透明悬浮、移出隐藏和移入恢复。\n",
            encoding="utf-8",
        )
        # 刷新桌面入口缓存；安装和卸载不改动用户书籍与设置。
        for hook in ("postinst", "postrm"):
            script = control_dir / hook
            script.write_text(
                "#!/bin/sh\nset -e\n"
                "if command -v update-desktop-database >/dev/null 2>&1; then\n"
                "  update-desktop-database /usr/share/applications || true\nfi\nexit 0\n",
                encoding="utf-8",
            )
            script.chmod(0o755)
            run("sh", "-n", str(script))
        print(run("dpkg-deb", "--root-owner-group", "-Zgzip", "-z6", "--build", temporary, str(deb)), flush=True)
    def portable(info):
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.mode = 0o755 if info.isdir() or Path(info.name).name in executables else 0o644
        if info.issym():
            info.mode = 0o777
        return info
    with tarfile.open(archive, "w:gz", compresslevel=6) as packed:
        packed.add(runtime, arcname=stem, filter=portable)
    details = run("dpkg-deb", "--field", str(deb), "Package", "Version", "Architecture", "Depends")
    listing = run("dpkg-deb", "--contents", str(deb))
    if not re.search(r"^-rwsr-xr-x root/root .*\./opt/quietleaf/chrome-sandbox$", listing, re.MULTILINE):
        raise RuntimeError("DEB 沙箱权限或所有权验证失败")
    if f"Architecture: {deb_arch}" not in details:
        raise RuntimeError("DEB 架构元数据验证失败")
    checksums = []
    for artifact in (deb, archive):
        hasher = hashlib.sha256()
        with artifact.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(block)
        checksums.append(f"{hasher.hexdigest()}  {artifact.name}")
    (output / f"{stem}.sha256").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    report = {"version": version, "architecture": deb_arch, "electron": metadata["devDependencies"]["electron"],
              "glibcMinimum": glibc_min, "elfFiles": elf_files, "debControl": details,
              "nativeLaunchTested": False}
    (output / f"{stem}-build.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Linux {deb_arch} 打包与静态检查通过，共 {len(elf_files)} 个 ELF，所需 glibc >= {glibc_min}。", flush=True)
    print(f"DEB：{deb}\n压缩包：{archive}", flush=True)


if __name__ == "__main__":
    main()
