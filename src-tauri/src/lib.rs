use tauri::{Emitter, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
