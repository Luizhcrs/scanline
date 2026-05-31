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
///
/// ASYNC on purpose: creating a child webview (wry/WebView2) must run on the
/// main/event-loop thread, but doing it synchronously *inside* a command that
/// is itself dispatched from the event loop deadlocks (reentrant webview
/// creation). An async command runs OFF the main thread, so we can dispatch the
/// creation back to a free main loop via run_on_main_thread and await the
/// result through a channel.
#[tauri::command]
async fn browser_open(
    app: AppHandle,
    browsers: State<'_, BrowserManager>,
    id: u32,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let old = browsers.views.lock().unwrap().remove(&id);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Some(old) = old {
            let _ = old.close();
        }
        let result = (|| {
            let window = app2.get_window("main").ok_or("main window not found")?;
            let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
            let builder =
                WebviewBuilder::new(format!("browser-{id}"), WebviewUrl::External(parsed));
            window
                .add_child(
                    builder,
                    LogicalPosition::new(x, y),
                    LogicalSize::new(w.max(1.0), h.max(1.0)),
                )
                .map_err(|e| e.to_string())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    let webview = rx
        .await
        .map_err(|_| "browser_open: main-thread closure dropped".to_string())??;
    browsers.views.lock().unwrap().insert(id, webview);
    Ok(())
}

// All native webview manipulation below is dispatched to the main/event-loop
// thread via run_on_main_thread. Like add_child, these wry operations are not
// safe to call from Tauri's command worker thread.

/// Reposition/resize a browser pane's webview to match its DOM rectangle.
#[tauri::command]
fn browser_bounds(
    app: AppHandle,
    browsers: State<BrowserManager>,
    id: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let v = browsers.views.lock().unwrap().get(&id).cloned();
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = v.set_position(LogicalPosition::new(x, y));
            let _ = v.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
        });
    }
    Ok(())
}

/// Navigate a browser pane to a new URL.
#[tauri::command]
fn browser_navigate(
    app: AppHandle,
    browsers: State<BrowserManager>,
    id: u32,
    url: String,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    let v = browsers.views.lock().unwrap().get(&id).cloned();
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = v.navigate(parsed);
        });
    }
    Ok(())
}

/// Hide/show a browser pane's webview.
#[tauri::command]
fn browser_visible(
    app: AppHandle,
    browsers: State<BrowserManager>,
    id: u32,
    visible: bool,
) -> Result<(), String> {
    let v = browsers.views.lock().unwrap().get(&id).cloned();
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = if visible { v.show() } else { v.hide() };
        });
    }
    Ok(())
}

/// Navigate back in a browser pane's history.
#[tauri::command]
fn browser_back(app: AppHandle, browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    let v = browsers.views.lock().unwrap().get(&id).cloned();
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = v.eval("history.back()");
        });
    }
    Ok(())
}

/// Navigate forward in a browser pane's history.
#[tauri::command]
fn browser_forward(app: AppHandle, browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    let v = browsers.views.lock().unwrap().get(&id).cloned();
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = v.eval("history.forward()");
        });
    }
    Ok(())
}

/// Close and drop a browser pane's webview.
#[tauri::command]
fn browser_close(app: AppHandle, browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    let v = browsers.views.lock().unwrap().remove(&id);
    if let Some(v) = v {
        let _ = app.run_on_main_thread(move || {
            let _ = v.close();
        });
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

// ---- Control server (named pipe) ----
//
// External processes (the agent tmux-shim, a CLI, scripts) drive the running
// grid by writing JSON lines to \\.\pipe\scanline. Each line is forwarded to
// the frontend as a `control://command` event, which the Shell dispatches to
// the layout (split / new / close / focus pane, notify). This is the mechanism
// that lets an agent's `tmux split-window` spawn a real pane in the window.

#[cfg(windows)]
const CONTROL_PIPE: &str = r"\\.\pipe\scanline";

#[cfg(windows)]
async fn handle_control_client(
    server: tokio::net::windows::named_pipe::NamedPipeServer,
    app: AppHandle,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let mut reader = BufReader::new(server);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // client disconnected
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Only forward well-formed JSON commands; ack the result.
                let ack = match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(v) => {
                        // debug.cdp is handled here (not forwarded): run a CDP eval
                        // on a browser pane and return the result, for diagnostics.
                        if v.get("method").and_then(|m| m.as_str()) == Some("debug.cdp") {
                            let id = v.get("id").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                            let expr = v
                                .get("expr")
                                .and_then(|x| x.as_str())
                                .unwrap_or("1")
                                .to_string();
                            let wv = app
                                .state::<BrowserManager>()
                                .views
                                .lock()
                                .unwrap()
                                .get(&id)
                                .cloned();
                            let res = match wv {
                                Some(w) => {
                                    cdp_call(
                                        w,
                                        "Runtime.evaluate".into(),
                                        Some(
                                            serde_json::json!({"expression": expr, "returnByValue": true})
                                                .to_string(),
                                        ),
                                    )
                                    .await
                                }
                                None => Err(format!("no browser pane {id}")),
                            };
                            eprintln!("debug.cdp id={id} => {res:?}");
                            format!("{}\n", serde_json::json!({ "debug": format!("{res:?}") }))
                        } else {
                            let _ = app.emit("control://command", v);
                            "{\"ok\":true}\n".to_string()
                        }
                    }
                    Err(e) => format!("{{\"ok\":false,\"error\":{}}}\n", serde_json::json!(e.to_string())),
                };
                let _ = reader.get_mut().write_all(ack.as_bytes()).await;
            }
            Err(_) => break,
        }
    }
}

/// Spawn the named-pipe control server on Tauri's async runtime. Uses the
/// classic accept loop: create the next pipe instance before handing the
/// connected one to a task, so concurrent clients never get refused.
/// `first_pipe_instance(true)` also enforces single-instance ownership of the
/// pipe name.
#[cfg(windows)]
fn start_control_server(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;

    tauri::async_runtime::spawn(async move {
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(CONTROL_PIPE)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("control: cannot create {CONTROL_PIPE}: {e}");
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                match ServerOptions::new().create(CONTROL_PIPE) {
                    Ok(s) => server = s,
                    Err(e) => {
                        eprintln!("control: recreate failed: {e}");
                        return;
                    }
                }
                continue;
            }
            let connected = server;
            server = match ServerOptions::new().create(CONTROL_PIPE) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("control: recreate failed: {e}");
                    return;
                }
            };
            tauri::async_runtime::spawn(handle_control_client(connected, app.clone()));
        }
    });
}

#[cfg(not(windows))]
fn start_control_server(_app: AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(BrowserManager::default())
        .setup(|app| {
            start_control_server(app.handle().clone());
            Ok(())
        })
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
