fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["reader_command", "read_epub"]),
        ),
    )
    .expect("生成桌面资源失败");
}
