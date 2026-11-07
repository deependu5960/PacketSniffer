use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

fn backend_is_ready() -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", 8765)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));

    let request =
        b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";

    if stream.write_all(request).is_err() {
        return false;
    }

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();

    if reader.read_line(&mut status_line).is_err() {
        return false;
    }

    status_line.contains(" 200 ")
}

fn wait_for_backend() -> bool {
    let start = Instant::now();

    while start.elapsed() < Duration::from_secs(30) {
        if backend_is_ready() {
            println!("[PacketSniffer] Backend is ready.");
            return true;
        }

        thread::sleep(Duration::from_millis(250));
    }

    false
}

fn locate_backend(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // Installed application: use the bundled backend resource.
    if let Ok(resource_path) = app.path().resolve(
        "backend/PacketSnifferBackend.exe",
        BaseDirectory::Resource,
    ) {
        if resource_path.is_file() {
            return Ok(resource_path);
        }
    }

    // Development fallback: use the existing PyInstaller distribution.
    let development_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../backend/dist/PacketSnifferBackend/PacketSnifferBackend.exe");

    if development_path.is_file() {
        return Ok(development_path);
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "PacketSnifferBackend.exe was not found in application resources.",
    ).into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let backend_exe = locate_backend(app)?;

            let backend_dir = backend_exe.parent().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Backend directory could not be resolved.",
                )
            })?;

            println!("[PacketSniffer] Starting bundled backend...");
            println!("[PacketSniffer] Backend: {}", backend_exe.display());

            let mut backend = Command::new(&backend_exe)
                .current_dir(backend_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;

            println!("[PacketSniffer] Waiting for backend...");

            if !wait_for_backend() {
                let _ = backend.kill();
                let _ = backend.wait();

                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "PacketSniffer backend failed to start on port 8765.",
                ).into());
            }

            app.manage(BackendProcess(Mutex::new(Some(backend))));

            println!("[PacketSniffer] Desktop application ready.");

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to build PacketSniffer")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        if let Some(mut child) = process.take() {
                            let _ = child.kill();
                            let _ = child.wait();

                            println!("[PacketSniffer] Backend stopped.");
                        }
                    }
                }
            }
        });
}

