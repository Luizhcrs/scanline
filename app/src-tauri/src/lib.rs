// Scanline — PTY bridge.
//
// Spawns a ConPTY per terminal pane via portable-pty, streams output bytes to
// the frontend (xterm.js) through Tauri events, and accepts input/resize via
// commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, Wry,
};

/// A live pseudo-terminal: its master (for resize), input writer, and the
/// child process handle (kept alive so the shell isn't reaped).
struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    #[allow(dead_code)]
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct PtyManager {
    ptys: Mutex<HashMap<u32, Pty>>,
    next_id: AtomicU32,
}

/// Payload pushed to the frontend for each chunk of terminal output.
#[derive(Clone, Serialize)]
struct PtyData {
    id: u32,
    bytes: Vec<u8>,
}

/// Spawn a new ConPTY running the user's shell. Returns the pane's pty id.
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<PtyManager>,
    rows: u16,
    cols: u16,
    shell: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let program = shell.unwrap_or_else(|| "powershell.exe".to_string());
    let mut cmd = CommandBuilder::new(program);
    if let Ok(home) = std::env::var("USERPROFILE") {
        cmd.cwd(home);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Close our handle to the slave; the child owns it now.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    state.ptys.lock().unwrap().insert(
        id,
        Pty {
            writer,
            master: pair.master,
            child,
        },
    );

    // Reader thread: pump ConPTY output to the frontend until EOF.
    let app2 = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app2.emit(
                        "pty-data",
                        PtyData {
                            id,
                            bytes: buf[..n].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app2.emit("pty-exit", id);
    });

    Ok(id)
}

/// Write user input (keystrokes) to a pty.
#[tauri::command]
fn pty_write(state: State<PtyManager>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.ptys.lock().unwrap();
    if let Some(p) = map.get_mut(&id) {
        p.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        p.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize a pty to match the xterm.js viewport.
#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: u32, rows: u16, cols: u16) -> Result<(), String> {
    let map = state.ptys.lock().unwrap();
    if let Some(p) = map.get(&id) {
        p.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close a pty: kill the child and drop its handles.
#[tauri::command]
fn pty_close(state: State<PtyManager>, id: u32) -> Result<(), String> {
    if let Some(mut p) = state.ptys.lock().unwrap().remove(&id) {
        let _ = p.child.kill();
    }
    Ok(())
}

// ---- Browser panes (native child webviews) ----
//
// A real WebView2 child layered over the DOM, positioned to match a browser
// pane's rectangle in the grid. Unlike an <iframe>, it ignores
// X-Frame-Options, so any site (google, github, …) loads.

#[derive(Default)]
struct BrowserManager {
    views: Mutex<HashMap<u32, tauri::Webview<Wry>>>,
}

/// Create a child webview on the main window at the given logical bounds.
#[tauri::command]
fn browser_open(
    app: AppHandle,
    browsers: State<BrowserManager>,
    id: u32,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    let label = format!("browser-{id}");
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed));
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(w.max(1.0), h.max(1.0)),
        )
        .map_err(|e| e.to_string())?;
    browsers.views.lock().unwrap().insert(id, webview);
    Ok(())
}

/// Reposition/resize a browser pane's webview to match its DOM rectangle.
#[tauri::command]
fn browser_bounds(
    browsers: State<BrowserManager>,
    id: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().get(&id) {
        v.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        v.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Navigate a browser pane to a new URL.
#[tauri::command]
fn browser_navigate(browsers: State<BrowserManager>, id: u32, url: String) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().get(&id) {
        let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
        v.navigate(parsed).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide/show a browser pane's webview (used when it scrolls offscreen).
#[tauri::command]
fn browser_visible(browsers: State<BrowserManager>, id: u32, visible: bool) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().get(&id) {
        let _ = if visible { v.show() } else { v.hide() };
    }
    Ok(())
}

/// Navigate back in a browser pane's history.
#[tauri::command]
fn browser_back(browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().get(&id) {
        let _ = v.eval("history.back()");
    }
    Ok(())
}

/// Navigate forward in a browser pane's history.
#[tauri::command]
fn browser_forward(browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().get(&id) {
        let _ = v.eval("history.forward()");
    }
    Ok(())
}

/// Close and drop a browser pane's webview.
#[tauri::command]
fn browser_close(browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    if let Some(v) = browsers.views.lock().unwrap().remove(&id) {
        let _ = v.close();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(BrowserManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            browser_open,
            browser_bounds,
            browser_navigate,
            browser_visible,
            browser_back,
            browser_forward,
            browser_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
