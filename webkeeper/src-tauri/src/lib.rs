use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

// The PyInstaller backend is "PacketSnifferBackend.exe" on Windows and a plain
// "PacketSnifferBackend" executable on Linux.
#[cfg(windows)]
const BACKEND_BINARY: &str = "PacketSnifferBackend.exe";
#[cfg(not(windows))]
const BACKEND_BINARY: &str = "PacketSnifferBackend";

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
    let resource_relative = format!("backend/{}", BACKEND_BINARY);

    if let Ok(resource_path) = app
        .path()
        .resolve(&resource_relative, BaseDirectory::Resource)
    {
        if resource_path.is_file() {
            return Ok(resource_path);
        }
    }

    // Development fallback: use the existing PyInstaller distribution.
    let development_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../backend/dist/PacketSnifferBackend")
        .join(BACKEND_BINARY);

    if development_path.is_file() {
        return Ok(development_path);
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("{} was not found in application resources.", BACKEND_BINARY),
    )
    .into())
}

// A packaged file can lose its executable bit (for example when the app is
// run from an unpacked archive). Restore it when we are allowed to; when the
// file is root-owned this silently does nothing and the .deb's postinst
// script is what guarantees the permission.
#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        let mode = permissions.mode();

        if mode & 0o111 == 0 {
            permissions.set_mode(mode | 0o755);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

// Linux: keep the backend's output in ~/.local/share/PacketSniffer/backend.log
// (recreated on every launch) so problems can be diagnosed. This is the same
// per-user data folder the backend itself uses.
#[cfg(target_os = "linux")]
fn open_backend_log() -> Option<std::fs::File> {
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;

    let directory = data_home.join("PacketSniffer");
    std::fs::create_dir_all(&directory).ok()?;

    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(directory.join("backend.log"))
        .ok()
}

#[cfg(not(target_os = "linux"))]
fn open_backend_log() -> Option<std::fs::File> {
    None
}

fn backend_stdio() -> (Stdio, Stdio) {
    if let Some(log) = open_backend_log() {
        if let Ok(log_clone) = log.try_clone() {
            return (Stdio::from(log), Stdio::from(log_clone));
        }
    }

    (Stdio::null(), Stdio::null())
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

            ensure_executable(&backend_exe);

            let (backend_stdout, backend_stderr) = backend_stdio();

            let mut command = Command::new(&backend_exe);

            command
                .current_dir(backend_dir)
                .stdin(Stdio::null())
                .stdout(backend_stdout)
                .stderr(backend_stderr);

            // Make Python flush its output straight into backend.log and use
            // UTF-8 regardless of the desktop's locale.
            #[cfg(target_os = "linux")]
            command.env("PYTHONUNBUFFERED", "1").env("PYTHONUTF8", "1");

            let mut backend = command.spawn().map_err(|error| {
                std::io::Error::new(
                    error.kind(),
                    format!(
                        "Could not start the PacketSniffer backend ({}): {}",
                        backend_exe.display(),
                        error
                    ),
                )
            })?;

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
