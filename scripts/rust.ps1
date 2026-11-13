$CargoArguments = @($args)
$ErrorActionPreference = 'Stop'
$readerRoot = Split-Path -Parent $PSScriptRoot
# 可指定其他项目已经安装的工具链，只读取工具，不写入来源项目。
$toolRoot = $env:QUIETLEAF_RUST_TOOLS
if (-not $toolRoot) {
    $localTools = Join-Path $readerRoot '.tools'
    $siblingTools = Join-Path (Split-Path -Parent $readerRoot) 'screen-craft/.tools'
    if (Test-Path -LiteralPath (Join-Path $localTools 'rustup/toolchains')) { $toolRoot = $localTools }
    elseif (Test-Path -LiteralPath (Join-Path $siblingTools 'rustup/toolchains')) { $toolRoot = $siblingTools }
}
if ($toolRoot) {
    $toolchain = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'rustup/toolchains') -Directory | Where-Object Name -Like '*windows-gnu' | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $toolchain) { throw '指定目录中没有 Windows GNU Rust 工具链。' }
    $toolchainBin = Join-Path $toolchain.FullName 'bin'
    $env:RUSTC = Join-Path $toolchainBin 'rustc.exe'
    $env:RUSTDOC = Join-Path $toolchainBin 'rustdoc.exe'
    $env:CARGO_HOME = Join-Path $readerRoot '.cache/cargo'
    $env:CARGO_TARGET_DIR = Join-Path $readerRoot 'target'
    $env:PATH = $toolchainBin + ';' + $env:PATH
    $llvm = Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'llvm-mingw-*-ucrt-x86_64' | Sort-Object Name -Descending | Select-Object -First 1
    if ($llvm) {
        $env:PATH = (Join-Path $llvm.FullName 'bin') + ';' + $env:PATH
        $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $toolchain.FullName 'lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe'
    }
    if ($CargoArguments.Count -eq 0 -or $CargoArguments[0] -eq 'tauri') {
        $tauriArguments = @($CargoArguments | Select-Object -Skip 1)
        & (Join-Path $readerRoot 'node_modules/.bin/tauri.cmd') @tauriArguments
    } else {
        & (Join-Path $toolchainBin 'cargo.exe') @CargoArguments
    }
} else {
    if ($CargoArguments.Count -gt 0 -and $CargoArguments[0] -eq 'tauri') {
        & (Join-Path $readerRoot 'node_modules/.bin/tauri.cmd') @($CargoArguments | Select-Object -Skip 1)
    } else { & cargo @CargoArguments }
}
exit $LASTEXITCODE

