// Scanline — PTY bridge.
//
// Spawns a ConPTY per terminal pane via portable-pty, streams output bytes to
// the frontend (xterm.js) through Tauri events, and accepts input/resize via
// commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, Url, WebviewUrl,
    Wry,
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
}

/// Spawn a new ConPTY running the user's shell. The frontend supplies the pty
/// `id` so it can register its per-pty event listeners *before* spawning —
/// otherwise the shell's first prompt races ahead of the listener and is lost.
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<PtyManager>,
    id: u32,
    rows: u16,
    cols: u16,
    shell: Option<String>,
) -> Result<(), String> {
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

    state.ptys.lock().unwrap().insert(
        id,
        Pty {
            writer,
            master: pair.master,
            child,
        },
    );

    // Reader thread: pump ConPTY output to the frontend until EOF. Emits to a
    // per-pty event (`pty://{id}/data`) so each pane listens only to its own
    // stream instead of every pane filtering one global firehose.
    let app2 = app.clone();
    let data_event = format!("pty://{id}/data");
    let exit_event = format!("pty://{id}/exit");
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app2.emit(&data_event, buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
        let _ = app2.emit(&exit_event, ());
    });

    Ok(())
}

/// Write user input to a pty. Input arrives as raw bytes (not a String) so
/// non-UTF-8 key sequences survive the round-trip.
#[tauri::command]
fn pty_write(state: State<PtyManager>, id: u32, data: Vec<u8>) -> Result<(), String> {
    let mut map = state.ptys.lock().unwrap();
    if let Some(p) = map.get_mut(&id) {
        p.writer.write_all(&data).map_err(|e| e.to_string())?;
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
    // Reopening the same id must not leak the previous webview.
    if let Some(old) = browsers.views.lock().unwrap().remove(&id) {
        let _ = old.close();
    }
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

// ---- Spike 1: WebView2 DevTools Protocol bridge ----
//
// GO/NO-GO for the scriptable browser. Scanline's browser_back/etc only do
// fire-and-forget `eval` (no return value). The agent-browser API needs real
// CDP: Runtime.evaluate that RETURNS a value, Accessibility.getFullAXTree,
// Input.dispatch*, Page.captureScreenshot. None of that exists in wry's public
// API — it requires reaching the raw ICoreWebView2 via Tauri's with_webview()
// escape hatch and calling CallDevToolsProtocolMethodAsync with an async
// completion handler. This proves that path end-to-end.

/// Call one CDP method on a webview and return its JSON result.
///
/// `CallDevToolsProtocolMethodAsync` is asynchronous: it returns immediately and
/// invokes its completion handler later on the UI thread's message loop. So we
/// must NOT block inside `with_webview` (that thread IS the message loop —
/// blocking it deadlocks the callback). Instead we fire the call, hand the
/// result back through a oneshot channel, and await it from the async command.
#[cfg(windows)]
async fn cdp_call(
    webview: tauri::Webview<Wry>,
    method: String,
    params: Option<String>,
) -> Result<String, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::{HSTRING, PCWSTR};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

    webview
        .with_webview(move |platform| {
            let work = (|| -> windows::core::Result<()> {
                let controller = platform.controller();
                let core = unsafe { controller.CoreWebView2()? };
                let method_h = HSTRING::from(&method);
                let params_h = HSTRING::from(params.unwrap_or_else(|| "{}".to_string()));
                // webview2-com idiomatizes the completion handler: it hands us
                // the HRESULT already turned into a Result and the PCWSTR result
                // already copied into a String.
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result: windows::core::Result<()>, json: String| {
                        let _ = tx.send(match result {
                            Ok(()) => Ok(json),
                            Err(e) => Err(format!("cdp error: {e} ({json})")),
                        });
                        Ok(())
                    },
                ));
                unsafe {
                    core.CallDevToolsProtocolMethod(
                        PCWSTR(method_h.as_ptr()),
                        PCWSTR(params_h.as_ptr()),
                        &handler,
                    )?;
                }
                Ok(())
            })();
            // If we failed before the handler captured `tx`, `tx` is dropped here
            // and the awaiting receiver resolves to a RecvError (handled below).
            if let Err(e) = work {
                eprintln!("cdp_call setup error: {e:?}");
            }
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    rx.await
        .map_err(|_| "cdp_call: no response (CoreWebView2 not ready?)".to_string())?
}

#[cfg(not(windows))]
async fn cdp_call(
    _webview: tauri::Webview<Wry>,
    _method: String,
    _params: Option<String>,
) -> Result<String, String> {
    Err("CDP only available on Windows (WebView2)".to_string())
}

/// Drive the DevTools Protocol on a browser pane's webview.
#[tauri::command]
async fn browser_cdp(
    browsers: State<'_, BrowserManager>,
    id: u32,
    method: String,
    params: Option<String>,
) -> Result<String, String> {
    let webview = browsers
        .views
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no browser pane {id}"))?;
    cdp_call(webview, method, params).await
}

/// Spike 1 self-test: prove the CDP bridge returns real data. Runs against the
/// app's own "main" webview (always present) so it does not need a browser pane.
/// Results are printed to the dev console as the GO/NO-GO evidence.
#[tauri::command]
async fn cdp_selftest(app: AppHandle) -> Result<String, String> {
    let webview = app
        .get_webview("main")
        .ok_or_else(|| "main webview not found".to_string())?;

    let mut report = String::new();
    let mut step = |label: &str, r: &Result<String, String>| {
        let line = match r {
            Ok(s) => {
                let preview: String = s.chars().take(160).collect();
                format!("[CDP OK] {label} ({} bytes): {preview}", s.len())
            }
            Err(e) => format!("[CDP ERR] {label}: {e}"),
        };
        println!("{line}");
        report.push_str(&line);
        report.push('\n');
    };

    // 1. Runtime.evaluate returning a value (the core capability eval lacks).
    let r = cdp_call(
        webview.clone(),
        "Runtime.evaluate".into(),
        Some(r#"{"expression":"2 + 40","returnByValue":true}"#.into()),
    )
    .await;
    step("Runtime.evaluate 2+40", &r);

    // 2. Read a real DOM value back out.
    let r = cdp_call(
        webview.clone(),
        "Runtime.evaluate".into(),
        Some(r#"{"expression":"navigator.userAgent","returnByValue":true}"#.into()),
    )
    .await;
    step("Runtime.evaluate userAgent", &r);

    // 3. Accessibility tree (needs the domain enabled first) — the snapshot
    //    primitive agent-browser is built on.
    let _ = cdp_call(webview.clone(), "Accessibility.enable".into(), None).await;
    let r = cdp_call(
        webview.clone(),
        "Accessibility.getFullAXTree".into(),
        None,
    )
    .await;
    step("Accessibility.getFullAXTree", &r);

    // 4. Full-page screenshot (returns base64) — proves binary-ish payloads.
    let r = cdp_call(
        webview.clone(),
        "Page.captureScreenshot".into(),
        Some(r#"{"format":"png"}"#.into()),
    )
    .await;
    step("Page.captureScreenshot", &r);

    Ok(report)
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
            browser_close,
            browser_cdp,
            cdp_selftest
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On shutdown, kill child shells and drop webviews. Otherwise the
            // pty reader threads block on a live child (app hangs on close) and
            // native webviews leak as orphans.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(ptys) = app.try_state::<PtyManager>() {
                    for (_, mut p) in ptys.ptys.lock().unwrap().drain() {
                        let _ = p.child.kill();
                    }
                }
                if let Some(browsers) = app.try_state::<BrowserManager>() {
                    for (_, v) in browsers.views.lock().unwrap().drain() {
                        let _ = v.close();
                    }
                }
            }
        });
}
