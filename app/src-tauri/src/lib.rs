// Scanline — PTY bridge.
//
// Spawns a ConPTY per terminal pane via portable-pty, streams output bytes to
// the frontend (xterm.js) through Tauri events, and accepts input/resize via
// commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
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
    /// OS pid of the shell, root for the pane's listening-ports process tree.
    pid: u32,
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
    command: Option<String>,
    surface_id: Option<u32>,
    cwd: Option<String>,
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
    let mut cmd = CommandBuilder::new(&program);
    // If a command line was given (e.g. an agent pane from `scanline run` or a
    // tmux split-window with a command), run it via the shell. Otherwise the
    // pane is a plain interactive shell.
    if let Some(line) = command {
        cmd.arg("-NoLogo");
        cmd.arg("-Command");
        cmd.arg(line);
    } else if program.to_lowercase().contains("powershell") || program.to_lowercase().contains("pwsh") {
        // Plain shell: install a prompt that emits OSC 7 (current working dir) so
        // the app can track per-pane cwd for the sidebar (git branch, ports, …).
        cmd.arg("-NoExit");
        cmd.arg("-Command");
        cmd.arg(
            // UTF-8 in + out so accented chars / emoji round-trip (xterm decodes
            // output as UTF-8 and we send input as UTF-8). Then install a prompt
            // that emits OSC 7 (cwd) for the sidebar git/ports metadata.
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
             [Console]::InputEncoding=[System.Text.Encoding]::UTF8; \
             $OutputEncoding=[System.Text.Encoding]::UTF8; \
             function global:prompt { $p=(Get-Location).Path; \
             [Console]::Write([char]27+']7;file://'+[Environment]::MachineName+'/'+($p -replace '\\\\','/')+[char]7); \
             'PS '+$p+'> ' }",
        );
    }
    // Start dir: a restored pane's saved cwd (if it still exists), else home.
    // OSC 7 reports forward slashes (C:/Users/...); normalize to backslashes —
    // ConPTY's CreateProcess working-directory is unreliable with '/'.
    let start_dir = cwd
        .map(|c| c.replace('/', "\\"))
        .filter(|c| std::path::Path::new(c).is_dir())
        .or_else(|| std::env::var("USERPROFILE").ok());
    if let Some(dir) = start_dir {
        cmd.cwd(dir);
    }
    // Caller-pane context: a process in this pane (the CLI / tmux shim) reads
    // this as its default --surface target.
    if let Some(sid) = surface_id {
        cmd.env("SCANLINE_SURFACE_ID", sid.to_string());
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id().unwrap_or(0);
    // Close our handle to the slave; the child owns it now.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Reusing an id would orphan the old shell + its reader thread (both emit to
    // the same pty://{id} channel). Kill any existing pty on this id first.
    if let Some(mut old) = state.ptys.lock().unwrap().remove(&id) {
        let _ = old.child.kill();
    }
    state.ptys.lock().unwrap().insert(
        id,
        Pty {
            writer,
            master: pair.master,
            child,
            pid,
        },
    );

    // Output pump. Two parts so a high-rate ("firehose") shell doesn't flood the
    // IPC bridge:
    //  - reader thread: blocking reads append into a shared buffer and signal.
    //  - flusher thread: BLOCKS on a condvar until there's data (idle ptys cost
    //    ~0 CPU instead of 125 wakeups/sec), then coalesces an 8ms burst into ONE
    //    base64 event. base64 (~1.33x) is far smaller and cheaper to parse than
    //    Tauri's default Vec<u8> -> JSON number-array (~4-6x).
    // The frontend base64-decodes and writes to xterm.
    let data_event = format!("pty://{id}/data");
    let exit_event = format!("pty://{id}/exit");
    let buffer: Arc<(Mutex<Vec<u8>>, Condvar)> = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
    let done = Arc::new(AtomicBool::new(false));

    // Cap the per-event payload so the frontend never base64-decodes a multi-MB
    // blob synchronously on its UI thread (which froze the window). A big burst
    // streams as several events instead — each decodes in ~ms and the event loop
    // handles input between them. No artificial throughput cap (a fast build log
    // must not lag), and a generous buffer so only a true unbounded firehose ever
    // drops; when it must, drop oldest up to a newline to avoid splitting an
    // escape/UTF-8 sequence mid-stream (which would garble the xterm parser).
    const BUF_MAX: usize = 32 * 1024 * 1024;
    const EMIT_MAX: usize = 256 * 1024;

    let rbuf = buffer.clone();
    let rdone = done.clone();
    thread::spawn(move || {
        let (lock, cv) = &*rbuf;
        let mut tmp = [0u8; 8192];
        loop {
            match reader.read(&mut tmp) {
                Ok(0) => break,
                // Poison-tolerant: a panic elsewhere must not silently kill the
                // pty output pipeline (would look like a frozen terminal).
                Ok(n) => {
                    let mut b = lock.lock().unwrap_or_else(|e| e.into_inner());
                    b.extend_from_slice(&tmp[..n]);
                    if b.len() > BUF_MAX {
                        let overflow = b.len() - BUF_MAX;
                        // Drop oldest, but advance to the next newline so a cut
                        // never lands inside an escape/UTF-8 sequence.
                        let cut = b[overflow..]
                            .iter()
                            .position(|&c| c == b'\n')
                            .map(|p| overflow + p + 1)
                            .unwrap_or(overflow);
                        b.drain(..cut);
                    }
                    drop(b);
                    cv.notify_one();
                }
                Err(_) => break,
            }
        }
        rdone.store(true, Ordering::SeqCst);
        cv.notify_one(); // wake the flusher so it observes `done` and exits
    });

    let app2 = app.clone();
    thread::spawn(move || {
        use base64::Engine;
        let (lock, cv) = &*buffer;
        loop {
            let chunk = {
                let mut b = lock.lock().unwrap_or_else(|e| e.into_inner());
                // Block until there's output (or the pty ended) — no idle polling.
                while b.is_empty() && !done.load(Ordering::SeqCst) {
                    let (g, _) = cv
                        .wait_timeout(b, std::time::Duration::from_millis(50))
                        .unwrap_or_else(|e| e.into_inner());
                    b = g;
                }
                if b.is_empty() {
                    break; // empty + done
                }
                // Take at most EMIT_MAX; a big burst stays buffered and the next
                // loop iteration emits the rest immediately (no wait).
                if b.len() <= EMIT_MAX {
                    std::mem::take(&mut *b)
                } else {
                    b.drain(..EMIT_MAX).collect()
                }
            };
            let encoded = base64::engine::general_purpose::STANDARD.encode(&chunk);
            let _ = app2.emit(&data_event, encoded);
            // No artificial sleep: 256KB decodes fast and Tauri delivers each
            // event as its own task, so the event loop services input between
            // them. Throughput is bound only by how fast the frontend drains.
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

// ---- Sidebar metadata: git, ports ----

fn run_capture(program: &str, args: &[&str], cwd: Option<&str>) -> Option<String> {
    let mut c = std::process::Command::new(program);
    c.args(args);
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    c.stdout(std::process::Stdio::piped());
    c.stderr(std::process::Stdio::null());
    c.stdin(std::process::Stdio::null());
    // CREATE_NO_WINDOW (0x0800_0000): a GUI app spawning a console program
    // (git, gh, netstat, findstr) flashes a cmd window otherwise. refreshMeta
    // polls these on a timer, so without this the screen blinks console windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let mut child = c.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    // Read on a side thread with a hard deadline. A hung subprocess (e.g.
    // `gh pr view` waiting on auth/network) must NOT park its blocking thread
    // forever — over a long session the 4s metadata poll would pile up stuck
    // threads and eventually starve the pool, hanging the app. Kill on timeout.
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut s);
        let _ = tx.send(s);
    });
    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(s) => {
            let _ = child.wait();
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// git branch + dirty + linked PR (best effort) for a working directory.
#[tauri::command]
async fn repo_info(cwd: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = run_capture("git", &["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"], None);
        let dirty = run_capture("git", &["-C", &cwd, "status", "--porcelain"], None)
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        // gh is best-effort: present + authenticated + a PR for the branch.
        let pr = run_capture(
            "gh",
            &["pr", "view", "--json", "number,state", "-q", "\"#\\(.number) \\(.state)\""],
            Some(&cwd),
        )
        .filter(|s| !s.is_empty());
        serde_json::json!({
            "branch": branch,
            "dirty": dirty,
            "pr": pr,
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Listening TCP ports owned by a pane's process tree (the shell + descendants).
#[tauri::command]
async fn pane_ports(state: State<'_, PtyManager>, id: u32) -> Result<Vec<u16>, String> {
    let root = match state.ptys.lock().unwrap().get(&id) {
        Some(p) => p.pid,
        None => return Ok(vec![]),
    };
    if root == 0 {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let pids = descendant_pids(root);
        let mut ports: Vec<u16> = Vec::new();
        // netstat -ano lists TCP + TCPv6; we filter on the LISTENING column so
        // IPv6 listeners ([::]:PORT, common for dev servers) are included too.
        if let Some(out) = run_capture("netstat", &["-ano"], None) {
            for line in out.lines() {
                if !line.contains("LISTENING") {
                    continue;
                }
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < 5 {
                    continue;
                }
                let pid: u32 = cols[cols.len() - 1].parse().unwrap_or(0);
                if !pids.contains(&pid) {
                    continue;
                }
                if let Some(port) = cols[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
                    if !ports.contains(&port) {
                        ports.push(port);
                    }
                }
            }
        }
        ports.sort_unstable();
        ports
    })
    .await
    .map_err(|e| e.to_string())
}

/// Find-in-directory: ripgrep if present, else findstr. Returns {file,line,text}.
#[tauri::command]
async fn grep_dir(cwd: String, query: String) -> Result<Vec<serde_json::Value>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // findstr's /C: requires the search string appended to the flag in the
        // SAME token (/c:<string>), not as a separate argument.
        let findstr_pat = format!("/c:{query}");
        let raw = run_capture(
            "rg",
            &["--line-number", "--no-heading", "--color", "never", "-S", "-m", "5", &query, "."],
            Some(&cwd),
        )
        .or_else(|| run_capture("findstr", &["/s", "/n", "/i", &findstr_pat, "*"], Some(&cwd)))
        .unwrap_or_default();

        let mut out = Vec::new();
        for line in raw.lines().take(200) {
            // file:line:text  (paths are cwd-relative, so the first two colons split it)
            let mut it = line.splitn(3, ':');
            let file = it.next().unwrap_or("");
            let lno = it.next().unwrap_or("");
            let text = it.next().unwrap_or("");
            if file.is_empty() || lno.is_empty() {
                continue;
            }
            out.push(serde_json::json!({
                "file": file,
                "line": lno.parse::<u32>().unwrap_or(0),
                "text": text.trim().chars().take(160).collect::<String>(),
            }));
        }
        out
    })
    .await
    .map_err(|e| e.to_string())
}

/// Path of the persisted session file: %APPDATA%\scanline\session.json.
fn session_path() -> Option<std::path::PathBuf> {
    let base = std::env::var("APPDATA").ok()?;
    Some(std::path::Path::new(&base).join("scanline").join("session.json"))
}

static WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Atomic write: serialize to a PER-WRITE-UNIQUE temp sibling then rename over
/// the target. The pid+seq suffix prevents two concurrent writers (e.g. the
/// beforeunload save racing the 8s autosave) from clobbering one shared temp
/// and corrupting/leaving it behind. The loser's temp is cleaned up on failure.
fn atomic_write(path: &std::path::Path, data: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let seq = WRITE_SEQ.fetch_add(1, Ordering::SeqCst);
    let tmp = path.with_extension(format!("{}.{}.tmp", std::process::id(), seq));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Persist the serialized workspace/layout tree to disk (atomic write).
#[tauri::command]
fn save_session(json: String) -> Result<(), String> {
    let path = session_path().ok_or("no APPDATA")?;
    atomic_write(&path, &json)
}

/// Load the persisted session JSON, or null if none exists.
#[tauri::command]
fn load_session() -> Result<Option<String>, String> {
    let path = session_path().ok_or("no APPDATA")?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Path of the user config: %APPDATA%\scanline\scanline.json.
fn config_path() -> Option<std::path::PathBuf> {
    let base = std::env::var("APPDATA").ok()?;
    Some(std::path::Path::new(&base).join("scanline").join("scanline.json"))
}

const DEFAULT_CONFIG: &str = r##"{
  // Scanline config (JSONC: // and /* */ comments allowed).
  // Edit and save; changes apply on window focus or `scanline config reload`.
  "terminal": {
    "fontFamily": "Consolas, 'Cascadia Mono', monospace",
    "fontSize": 14,
    "scrollback": 10000,
    "theme": { "background": "#0d1017", "foreground": "#c5c8c6", "cursor": "#5ff967" }
  },
  "ui": {
    // Interface font (sidebar, tabs, menus). Not the terminal.
    "fontFamily": "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
    "minimal": false
  },
  // Rebind actions, e.g. "palette": "ctrl+k". Format: ctrl+alt+shift+key.
  // Actions: palette, switcher, find, findInDir, newWorkspace, newTab,
  //          settings, minimal, fullscreen.
  "keybindings": {}
}
"##;

/// Load scanline.json, or null if it does not exist yet.
#[tauri::command]
fn load_config() -> Result<Option<String>, String> {
    let path = config_path().ok_or("no APPDATA")?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Persist scanline.json (atomic temp+rename), creating the dir if needed.
#[tauri::command]
fn save_config(json: String) -> Result<(), String> {
    let path = config_path().ok_or("no APPDATA")?;
    atomic_write(&path, &json)
}

/// Open scanline.json in Notepad, writing a commented default first if missing.
#[tauri::command]
fn edit_config() -> Result<(), String> {
    let path = config_path().ok_or("no APPDATA")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        std::fs::write(&path, DEFAULT_CONFIG).map_err(|e| e.to_string())?;
    }
    std::process::Command::new("notepad.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The pid set rooted at `root` (process + all descendants) via a Toolhelp snapshot.
#[cfg(windows)]
fn descendant_pids(root: u32) -> std::collections::HashSet<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    unsafe {
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut entry = PROCESSENTRY32 {
                dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
                ..Default::default()
            };
            if Process32First(snap, &mut entry).is_ok() {
                loop {
                    children
                        .entry(entry.th32ParentProcessID)
                        .or_default()
                        .push(entry.th32ProcessID);
                    if Process32Next(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(snap);
        }
    }
    let mut set = std::collections::HashSet::new();
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        if set.insert(p) {
            if let Some(kids) = children.get(&p) {
                stack.extend(kids);
            }
        }
    }
    set
}

#[cfg(not(windows))]
fn descendant_pids(root: u32) -> std::collections::HashSet<u32> {
    std::collections::HashSet::from([root])
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

/// Open the WebView2 devtools window for a browser pane.
#[cfg(windows)]
#[tauri::command]
fn browser_devtools(browsers: State<BrowserManager>, id: u32) -> Result<(), String> {
    let wv = browsers
        .views
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no browser pane {id}"))?;
    wv.with_webview(|platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let _ = core.OpenDevToolsWindow();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn browser_devtools(_browsers: State<BrowserManager>, _id: u32) -> Result<(), String> {
    Err("devtools only on Windows".into())
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

    // Bound the wait: if WebView2 never invokes the completion handler (page
    // torn down / core crashed) the receiver would park forever, pinning this
    // worker (and, for the in-control-loop debug path, the pipe task).
    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(r) => r.map_err(|_| "cdp_call: no response (CoreWebView2 not ready?)".to_string())?,
        Err(_) => Err("cdp_call: timed out after 30s".to_string()),
    }
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
// grid by writing JSON lines to \\.\pipe\scanline.
//
// V2 protocol: a request {id, method, params} is forwarded to the frontend as a
// `control://request` event; the frontend computes a result and calls back via
// the `control_reply` command, which routes the response to the waiting pipe
// client. Legacy fire-and-forget requests (no id) are emitted as
// `control://command` and acked immediately.

/// Pending V2 control requests awaiting a frontend reply, keyed by request id.
#[derive(Default)]
struct ControlPending(Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>);

/// The frontend delivers a V2 response here; route it to the waiting pipe client.
#[tauri::command]
fn control_reply(pending: State<ControlPending>, id: String, response: serde_json::Value) {
    if let Some(tx) = pending.0.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

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
                        } else if let Some(req_id) =
                            v.get("id").and_then(|x| x.as_str()).map(str::to_string)
                        {
                            // V2 request/response: forward to the frontend and wait
                            // for its reply (control_reply) keyed by this id.
                            let (tx, rx) = tokio::sync::oneshot::channel::<serde_json::Value>();
                            app.state::<ControlPending>()
                                .0
                                .lock()
                                .unwrap()
                                .insert(req_id.clone(), tx);
                            let _ = app.emit("control://request", v.clone());
                            // Per-method deadline: blocking Feed approvals
                            // (feed.ask) wait on a human, so they get a generous
                            // window; every other method must reply in
                            // milliseconds and keeps the short fail-fast timeout.
                            let secs = match v.get("method").and_then(|x| x.as_str()) {
                                Some("feed.ask") => 600,
                                _ => 20,
                            };
                            let resp = match tokio::time::timeout(
                                std::time::Duration::from_secs(secs),
                                rx,
                            )
                            .await
                            {
                                Ok(Ok(val)) => val,
                                _ => {
                                    app.state::<ControlPending>().0.lock().unwrap().remove(&req_id);
                                    serde_json::json!({"id": req_id, "ok": false, "error": "no reply / timeout"})
                                }
                            };
                            format!("{resp}\n")
                        } else {
                            // Legacy fire-and-forget (no id).
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
/// Recolor the native title bar to match the app (dark) instead of the user's
/// Windows accent color, and use light caption text. Keeps the native frame,
/// icon, buttons, and resize. No-op below Windows 11 build 22000.
#[cfg(windows)]
fn apply_dark_titlebar(window: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            // BOOL is 4 bytes; pass a u32 = TRUE.
            let dark: u32 = 1;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &dark as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
            // COLORREF is 0x00BBGGRR; match the sidebar #0a0d13.
            let color: u32 = 0x0013_0d0a;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_CAPTION_COLOR,
                &color as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

pub fn run() {
    // Capture panics to %APPDATA%\scanline\crash.log so an occasional crash
    // leaves evidence (message + location) instead of vanishing.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let line = format!("panic: {info}\n");
        if let Some(p) = config_path().map(|c| c.with_file_name("crash.log")) {
            if let Some(dir) = p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
                let _ = f.write_all(line.as_bytes());
            }
        }
        eprintln!("{line}");
        prev(info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .manage(BrowserManager::default())
        .manage(ControlPending::default())
        .setup(|app| {
            start_control_server(app.handle().clone());
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("main") {
                apply_dark_titlebar(&win);
            }
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
            browser_devtools,
            browser_cdp,
            cdp_selftest,
            control_reply,
            repo_info,
            pane_ports,
            grep_dir,
            save_session,
            load_session,
            load_config,
            edit_config,
            save_config
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
