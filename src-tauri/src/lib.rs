use std::time::UNIX_EPOCH;

use tauri::{Emitter, WindowEvent};

#[derive(serde::Serialize)]
struct FileStat {
    size: u64,
    /// Epoch milliseconds, matching what `File.lastModified` reports.
    mtime: u64,
}

/// Paths the shell passed on the command line (file association / "Open with").
fn startup_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let lower = arg.to_ascii_lowercase();
            lower.ends_with(".csv") || lower.ends_with(".txt")
        })
        .filter(|arg| std::path::Path::new(arg).is_file())
        .collect()
}

/// One-shot: the frontend asks for these right after loading.
#[tauri::command]
fn take_startup_files() -> Vec<String> {
    startup_paths()
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_file_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn stat_file(path: String) -> Result<FileStat, String> {
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: metadata.len(),
        mtime,
    })
}

/// Used for the ".bak" copy that a path-based session keeps next to the file.
#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    std::fs::copy(&from, &to)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            take_startup_files,
            read_file_bytes,
            write_file_bytes,
            stat_file,
            copy_file
        ])
        // WebView2 does not show a beforeunload dialog, so the shell must ask
        // the frontend before really closing: every CloseRequested is prevented,
        // the frontend checks for unsaved changes (and offers save-all), then
        // calls destroy() when it actually wants to close.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
