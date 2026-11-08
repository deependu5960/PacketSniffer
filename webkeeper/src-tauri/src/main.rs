// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Linux only: WebKitGTK's DMA-BUF renderer shows a blank window on some GPU /
// driver combinations (notably NVIDIA and some Wayland setups). Turning it off
// is the standard workaround and has no visible effect otherwise. A value the
// user has already exported is respected.
#[cfg(target_os = "linux")]
fn configure_linux_webview() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: called first thing in main(), before any other thread exists.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_linux_webview();

    app_lib::run();
}
