// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Linux only: WebKitGTK needs help on some graphics setups.
//
//  * The DMA-BUF renderer shows a blank window on some GPU / driver
//    combinations (notably NVIDIA and some Wayland setups).
//  * The accelerated compositor leaves parts of the window unpainted
//    (the desktop or white shows through) in virtual machines that have
//    3D acceleration switched off, such as the VMware default.
//
// Both are switched off by default. When the machine has no GPU render
// device at all (typical for a VM without 3D), software rendering is
// also forced. A value the user has already exported is never overridden.
#[cfg(target_os = "linux")]
fn has_gpu_render_node() -> bool {
    match std::fs::read_dir("/dev/dri") {
        Ok(entries) => entries
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("renderD")),
        Err(_) => false,
    }
}

#[cfg(target_os = "linux")]
fn set_default_env(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        // SAFETY: called first thing in main(), before any other thread exists.
        unsafe {
            std::env::set_var(name, value);
        }
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_webview() {
    set_default_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    set_default_env("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    if !has_gpu_render_node() {
        set_default_env("LIBGL_ALWAYS_SOFTWARE", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_linux_webview();

    app_lib::run();
}
