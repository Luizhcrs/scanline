// Scanline — PTY bridge.
//
// Spawns a ConPTY per terminal pane via portable-pty, streams output bytes to
// the frontend (xterm.js) through Tauri events, and accepts input/resize via
// commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, Url, WebviewUrl,
    Wry,
};

// ---- Logging facility (std-only, no crates) ----
//
// Single global append-mode file at %APPDATA%\scanline\scanline.log.
// Each write = one mutex lock + one writeln to an already-open fd.
// Size-rotates at 1 MiB (rename .log -> .log.1, reopen fresh).
// No-ops if uninitialized so the panic hook can call it pre-init safely.
// Never panics, never unwraps -- all I/O is best-effort.

mod log {
    use std::fs::{File, OpenOptions};
    use std::io::Write;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub enum Level { Info, Warn, Error }

    struct LogState { file: File, bytes: u64 }

    static LOG: OnceLock<Mutex<LogState>> = OnceLock::new();

    const LOG_MAX: u64 = 1024 * 1024;

    pub fn init(log_path: std::path::PathBuf) {
        if let Some(dir) = log_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let file = match OpenOptions::new().create(true).append(true).open(&log_path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = LOG.set(Mutex::new(LogState { file, bytes }));
    }

    pub fn write(level: Level, area: &str, msg: &str) {
        let cell = match LOG.get() {
            Some(c) => c,
            None => return,
        };
        let lv = match level { Level::Info => "INFO ", Level::Warn => "WARN ", Level::Error => "ERROR" };
        let ts = fmt_rfc3339();
        let line = format!("{ts} {lv} {area:<8} {msg}\n");
        let mut guard = match cell.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        if guard.bytes > LOG_MAX {
            if let Some(log_path) = super::log_path() {
                let backup = log_path.with_extension("log.1");
                let _ = std::fs::rename(&log_path, &backup);
                if let Ok(fresh) = OpenOptions::new().create(true).append(true).open(&log_path) {
                    guard.file = fresh;
                    guard.bytes = 0;
                }
            }
        }
        let _ = guard.file.write_all(line.as_bytes());
        guard.bytes += line.len() as u64;
    }

    fn fmt_rfc3339() -> String {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let s = d.as_secs();
        let ms = d.subsec_millis();
        let (y, mo, day, h, mi, sec) = secs_to_civil(s);
        format!("{y:04}-{mo:02}-{day:02}T{h:02}:{mi:02}:{sec:02}.{ms:03}Z")
    }

    fn secs_to_civil(s: u64) -> (u32, u32, u32, u32, u32, u32) {
        let sec = (s % 60) as u32;
        let min = ((s / 60) % 60) as u32;
        let hour = ((s / 3600) % 24) as u32;
        // days since Unix epoch
        let z = s / 86400 + 719468;
        let era = z / 146097;
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = if month <= 2 { y + 1 } else { y };
        (year as u32, month as u32, day, hour, min, sec)
    }
}

fn log_path() -> Option<std::path::PathBuf> {
    config_path().map(|c| c.with_file_name("scanline.log"))
}

macro_rules! log_info {
    ($area:expr, $($arg:tt)*) => {
        crate::log::write(crate::log::Level::Info, $area, &format!($($arg)*))
    };
}
macro_rules! log_warn {
    ($area:expr, $($arg:tt)*) => {
        crate::log::write(crate::log::Level::Warn, $area, &format!($($arg)*))
    };
}
macro_rules! log_error {
    ($area:expr, $($arg:tt)*) => {
        crate::log::write(crate::log::Level::Error, $area, &format!($($arg)*))
    };
}

/// A live pseudo-terminal: its master (for resize), input writer, and the
/// child process handle (kept alive so the shell isn't reaped).
struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// OS pid of the shell, root for the pane's listening-ports process tree.
    pid: u32,
}

struct PtyManager {
    ptys: Arc<Mutex<HashMap<u32, Pty>>>,
    /// Per-id generation counter (Arc so reader/flusher threads can share it):
    /// bumped each time an id is reused so stale threads detect they are dead
    /// and skip emitting data/exit on the new pane's channel. (bug #113)
    generations: Arc<Mutex<HashMap<u32, u64>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            ptys: Arc::new(Mutex::new(HashMap::new())),
            generations: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Readiness gate for the control server V2 path. (bug #1240)
/// The frontend calls `control_frontend_ready` after registering its listeners;
/// until then, V2 requests fail fast instead of blocking the full 20s timeout.
struct FrontendReady {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl Default for FrontendReady {
    fn default() -> Self {
        Self {
            flag: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
        }
    }
}

/// Epoch-millis of the last time a closure dispatched to the main (event-loop)
/// thread actually ran. An independent monitor thread compares it to wall-clock
/// to catch an Application Hang LIVE in scanline.log — the prior hangs left no
/// trace because the freeze is on the native message pump, not a Rust panic.
static LAST_MAIN_TICK: AtomicU64 = AtomicU64::new(0);

// ---- Script-dialog interception (non-blocking) ----
//
// A JS alert/confirm/prompt/beforeunload on a browser-pane child WebView2
// normally shows WebView2's DEFAULT MODAL dialog, which blocks the shared Win32
// message pump for up to 60 s until the OS kills the app (confirmed in
// scanline.log: "stall: main/UI thread unresponsive" growing 4s -> 60s with no
// Rust op running — the freeze is entirely inside WebView2's native dialog).
//
// The fix: register add_ScriptDialogOpening. Merely registering this handler
// SUPPRESSES WebView2's default blocking dialog. We then take a Deferral, which
// suspends ONLY that browser page without blocking the host UI thread at all.
// The terminal panes and the rest of the app stay fully responsive; only the one
// browser page waits until the user clicks OK/Cancel in the Scanline-styled
// overlay the frontend renders over that pane.
//
// Thread model: ScriptDialogOpening fires on the MAIN (event-loop) thread. The
// COM objects (args, deferral) are NOT Send/Sync, so they cannot cross thread
// boundaries. We store them in a thread_local! map on the main thread and share
// only the plain u64 request id (which is Send-safe via AtomicU64).
// browser_dialog_reply dispatches to the main thread to retrieve and complete.

/// Monotonically-increasing dialog request counter. Only the id crosses threads.
#[cfg(windows)]
static DIALOG_SEQ: AtomicU64 = AtomicU64::new(1);

#[cfg(windows)]
struct PendingDialog {
    args: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ScriptDialogOpeningEventArgs,
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
}

// Safety: PendingDialog is only ever accessed from the main thread (inserted and
// removed inside run_on_main_thread closures). The thread_local! ensures there
// is no concurrent access across threads.
#[cfg(windows)]
unsafe impl Send for PendingDialog {}

#[cfg(windows)]
thread_local! {
    static PENDING_DIALOGS: std::cell::RefCell<HashMap<u64, PendingDialog>> =
        std::cell::RefCell::new(HashMap::new());
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Heartbeat (stamps LAST_MAIN_TICK from the event loop) + an independent std
/// monitor thread that logs when the gap grows past ~3s. Because the monitor is
/// a plain thread it keeps logging THROUGH a freeze, so the log shows when the
/// UI thread stalled and for how long; correlate with the last `mt`/`pty` line
/// to find the blocking operation. If NO stall is logged during a visible
/// "Not Responding", the freeze is the WebView2 renderer/JS side, not this thread.
fn start_hang_watch(app: AppHandle) {
    LAST_MAIN_TICK.store(now_millis(), Ordering::Relaxed);
    let hb = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let _ = hb.run_on_main_thread(|| {
            LAST_MAIN_TICK.store(now_millis(), Ordering::Relaxed);
        });
    });
    std::thread::spawn(|| {
        let mut warned = 0u64;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let now = now_millis();
            let last = LAST_MAIN_TICK.load(Ordering::Relaxed);
            let gap = now.saturating_sub(last);
            if last != 0 && gap > 3000 && now.saturating_sub(warned) > 2000 {
                warned = now;
                log_warn!("stall", "main/UI thread unresponsive for {}ms", gap);
            }
        }
    });
}

/// Spawn a new ConPTY running the user's shell. The frontend supplies the pty
/// `id` so it can register its per-pty event listeners *before* spawning —
/// otherwise the shell's first prompt races ahead of the listener and is lost.
fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[allow(clippy::too_many_arguments)]
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
    // PTY output streams over a dedicated IPC Channel, NOT a global event. The
    // event system broadcasts to every webview and runs delivery on the main
    // (UI) thread; under two busy agents streaming at once that saturated the
    // message pump and froze the app (Application Hang). A Channel is the
    // Tauri-recommended high-throughput path: single receiver, direct delivery.
    on_data: tauri::ipc::Channel<String>,
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

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        log_warn!("pty", "spawn failed pane={}: {}", id, e);
        e.to_string()
    })?;
    let pid = child.process_id().unwrap_or(0);
    log_info!("pty", "spawn pane={} pid={} cols={} rows={} program={}", id, pid, cols, rows, program);
    // Close our handle to the slave; the child owns it now.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Reusing an id would orphan the old shell + its reader thread (both emit to
    // the same pty://{id} channel). Kill any existing pty on this id first.
    // Bump the generation so the old threads' captured gen != current gen and
    // they skip emitting on the new pane's channel. (bug #113)
    if let Some(mut old) = state.ptys.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let opid = old.child.process_id().unwrap_or(0);
        let _ = old.child.kill();
        kill_process_tree(opid);
    }
    let current_gen = {
        let mut gens = state.generations.lock().unwrap_or_else(|e| e.into_inner());
        let g = gens.entry(id).or_insert(0);
        *g += 1;
        *g
    };
    state.ptys.lock().unwrap_or_else(|e| e.into_inner()).insert(
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
    //    ~0 CPU instead of 125 wakeups/sec), then coalesces a ~16ms burst into ONE
    //    base64 message sent over the IPC Channel. base64 (~1.33x) is far smaller
    //    and cheaper to parse than Tauri's default Vec<u8> -> JSON number-array.
    // The frontend base64-decodes and writes to xterm.
    let exit_event = format!("pty://{id}/exit");
    let buffer: Arc<(Mutex<Vec<u8>>, Condvar)> = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
    let done = Arc::new(AtomicBool::new(false));

    // Cap the per-event payload so the frontend never base64-decodes a multi-MB
    // blob synchronously on its UI thread (which froze the window). A big burst
    // streams as several events instead — each decodes in ~ms and the event loop
    // handles input between them. No artificial throughput cap (a fast build log
    // must not lag), and a generous buffer so only a true unbounded firehose ever
    // drops; when it must, drop oldest up to a UTF-8 lead byte to avoid splitting
    // a multibyte sequence mid-stream (which would garble the xterm parser).
    const BUF_MAX: usize = 32 * 1024 * 1024;
    const EMIT_MAX: usize = 256 * 1024;

    // Clone Arc refs so reader/flusher threads can check/mutate shared state
    // without borrowing `state` across the thread boundary. (bug #113, #234)
    let spawn_gen = current_gen;
    let gens_for_reader = Arc::clone(&state.generations);
    let gens_for_flusher = Arc::clone(&state.generations);
    let ptys_for_flusher = Arc::clone(&state.ptys);

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
                        // Drop oldest, advancing to the next newline when possible.
                        // Fallback: scan from `overflow` forward to the first byte
                        // that is NOT a UTF-8 continuation byte (b & 0xC0 != 0x80)
                        // so the cut lands on a codepoint boundary. (bug #170)
                        let cut = b[overflow..]
                            .iter()
                            .position(|&c| c == b'\n')
                            .map(|p| overflow + p + 1)
                            .unwrap_or_else(|| {
                                // No newline found: find first UTF-8 lead byte at or
                                // after `overflow` so we do not split a multibyte char.
                                b[overflow..]
                                    .iter()
                                    .position(|&c| c & 0xC0 != 0x80)
                                    .map(|p| overflow + p)
                                    .unwrap_or(overflow)
                            });
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
        // The flusher owns the pty removal and exit emit (it drains remaining
        // buffered data first). gens_for_reader is not used at EOF — it was
        // captured only to satisfy the move closure; suppress the lint.
        let _ = gens_for_reader;
    });

    let app2 = app.clone();
    let gens_ref = gens_for_flusher;
    let ptys_ref = ptys_for_flusher;
    thread::spawn(move || {
        use base64::Engine;
        let (lock, cv) = &*buffer;
        // Track whether we left a non-empty backlog last iteration: when draining
        // a leftover backlog the 8ms coalesce sleep is skipped so large bursts
        // don't accumulate forced tail latency. (bug #206)
        let mut had_leftover = false;
        loop {
            // 1) Block until there's output (or the pty ended) — no idle polling.
            {
                let mut b = lock.lock().unwrap_or_else(|e| e.into_inner());
                while b.is_empty() && !done.load(Ordering::SeqCst) {
                    let (g, _) = cv
                        .wait_timeout(b, std::time::Duration::from_millis(50))
                        .unwrap_or_else(|e| e.into_inner());
                    b = g;
                }
                if b.is_empty() {
                    break; // empty + done
                }
            }
            // 2) Coalesce a ~16ms burst before draining. A redrawing TUI (Claude
            //    Code's status line, progress bars) delivers dozens of tiny ConPTY
            //    writes per second; sending each one still costs an IPC hop, and
            //    two busy agents at once saturated the UI thread (Application Hang).
            //    One message per ~16ms batches them with imperceptible latency.
            //    Skip when draining a leftover backlog so the rest streams
            //    immediately without piling on tail latency. (bug #206)
            if !had_leftover {
                thread::sleep(std::time::Duration::from_millis(16));
            }
            // 3) Take at most EMIT_MAX; a big burst stays buffered and the next
            //    loop iteration emits the rest immediately (no extra wait).
            let chunk = {
                let mut b = lock.lock().unwrap_or_else(|e| e.into_inner());
                had_leftover = b.len() > EMIT_MAX;
                take_chunk(&mut b, EMIT_MAX)
            };
            if chunk.is_empty() {
                continue;
            }
            // Generation guard: only emit if this thread is still the current
            // owner of this id. A reused id gets a new generation, so old threads
            // silently drop their remaining data instead of polluting the new pane. (bug #113)
            let cur_gen = gens_ref
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&id)
                .copied()
                .unwrap_or(0);
            if cur_gen != spawn_gen {
                break; // stale generation — stop without emitting exit
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&chunk);
            let _ = on_data.send(encoded);
        }
        // Final generation check before emitting exit.
        let cur_gen = gens_ref
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .copied()
            .unwrap_or(0);
        if cur_gen == spawn_gen {
            // Remove the pty entry from the map right before emitting exit so
            // pty_write/pty_resize take the unknown-id path after shell EOF. (bug #234)
            ptys_ref
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            log_info!("pty", "exit pane={}", id);
            let _ = app2.emit(&exit_event, ());
        }
    });

    Ok(())
}

/// Drain up to `max` bytes from `buf`: if `buf.len() <= max` the whole buffer is
/// returned and `buf` is left empty; otherwise exactly `max` bytes are returned
/// (front of the buffer) and the remainder is kept in `buf` in order.
fn take_chunk(buf: &mut Vec<u8>, max: usize) -> Vec<u8> {
    if buf.len() <= max {
        std::mem::take(buf)
    } else {
        buf.drain(..max).collect()
    }
}

/// Write user input to a pty. Input arrives as raw bytes (not a String) so
/// non-UTF-8 key sequences survive the round-trip.
#[tauri::command]
fn pty_write(state: State<PtyManager>, id: u32, data: Vec<u8>) -> Result<(), String> {
    let mut map = state.ptys.lock().unwrap_or_else(|e| e.into_inner());
    // Return Err on unknown id so the frontend can log/surface dropped keystrokes
    // instead of silently no-oping on a dead pty. (bug #234)
    match map.get_mut(&id) {
        Some(p) => {
            p.writer.write_all(&data).map_err(|e| e.to_string())?;
            p.writer.flush().map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err(format!("pty_write: unknown pty id {id}")),
    }
}

/// Resize a pty to match the xterm.js viewport.
#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: u32, rows: u16, cols: u16) -> Result<(), String> {
    let map = state.ptys.lock().unwrap_or_else(|e| e.into_inner());
    // Return Err on unknown id, same rationale as pty_write. (bug #234)
    match map.get(&id) {
        Some(p) => p
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string()),
        None => Err(format!("pty_resize: unknown pty id {id}")),
    }
}

/// Close a pty: kill the child and drop its handles.
#[tauri::command]
fn pty_close(state: State<PtyManager>, id: u32) -> Result<(), String> {
    if let Some(mut p) = state.ptys.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let pid = p.child.process_id().unwrap_or(0);
        let _ = p.child.kill();
        kill_process_tree(pid);
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
            // Kill the direct child first, then the whole process tree via
            // taskkill /T /F so grandchildren holding the stdout pipe write-end
            // are also reaped. Without this, a grandchild (e.g. gh's credential
            // helper or git pager) keeps the pipe open and `read_to_string` in
            // the reader thread blocks forever, leaking the thread. (bug #293)
            let pid = child.id();
            let _ = child.kill();
            #[cfg(windows)]
            if pid != 0 {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/T", "/F", "/PID", &pid.to_string()])
                    .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
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

/// Pure parser: extract LISTENING port numbers owned by the given pid set from
/// `netstat -ano` output. Handles TCP IPv4 (`0.0.0.0:PORT`) and IPv6
/// (`[::]:PORT`) via `rsplit(':')`. Deduplicates and returns sorted ascending.
fn parse_listening_ports(
    netstat_out: &str,
    pids: &std::collections::HashSet<u32>,
) -> Vec<u16> {
    let mut ports: Vec<u16> = Vec::new();
    for line in netstat_out.lines() {
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
    ports.sort_unstable();
    ports
}

/// Listening TCP ports owned by a pane's process tree (the shell + descendants).
#[tauri::command]
async fn pane_ports(state: State<'_, PtyManager>, id: u32) -> Result<Vec<u16>, String> {
    let root = match state.ptys.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
        Some(p) => p.pid,
        None => return Ok(vec![]),
    };
    if root == 0 {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Mitigate PID-reuse race: take the netstat snapshot FIRST, then snapshot
        // the process tree. A PID must appear in BOTH snapshots to be trusted as
        // a descendant — this narrows (but does not fully close) the window where
        // a recycled PID belonging to an unrelated process is attributed to this
        // pane. (bug #365)
        let netstat_out = run_capture("netstat", &["-ano"], None);
        // Second snapshot: collect pids seen in netstat output that are candidates.
        let candidate_pids: std::collections::HashSet<u32> = netstat_out
            .as_deref()
            .unwrap_or("")
            .lines()
            .filter(|l| l.contains("LISTENING"))
            .filter_map(|l| {
                let cols: Vec<&str> = l.split_whitespace().collect();
                if cols.len() < 5 { None } else { cols[cols.len() - 1].parse::<u32>().ok() }
            })
            .collect();
        // Now snapshot the process tree (after netstat, narrowing the race window).
        let pids = descendant_pids(root);
        // Intersect: only trust pids that were in the netstat output AND are still
        // descendants of root in the current process tree.
        let trusted: std::collections::HashSet<u32> =
            candidate_pids.intersection(&pids).copied().collect();

        let out_str = netstat_out.as_deref().unwrap_or("");
        parse_listening_ports(out_str, &trusted)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Pure parser: convert raw rg/findstr output into `{file, line, text}` objects.
///
/// Splitting assumption: paths are CWD-RELATIVE, so the first two ':' delimiters
/// separate file and line number (`splitn(3, ':')`). An absolute Windows path like
/// `C:\path\foo:3:hit` mis-splits on the drive colon, yielding `file="C"`. This
/// is a known limitation: rg is always invoked with a relative `.` target, so
/// absolute paths do not appear in normal use. The test below pins this behaviour.
fn parse_grep_lines(raw: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for line in raw.lines().take(200) {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() < 3 {
            continue;
        }

        let mut file_parts_count = 1;
        // Handle Windows absolute paths (e.g., C:\path:10:match)
        // parts[0] is "C", parts[1] is "\path", parts[2] is "10", parts[3] is "match"
        if parts[0].len() == 1 && parts[0].chars().next().map_or(false, |c| c.is_alphabetic()) && parts[1].starts_with('\\') {
            file_parts_count = 2;
        }

        let file = parts[..file_parts_count].join(":");
        let lno = parts.get(file_parts_count).unwrap_or(&"");
        let text = parts[file_parts_count + 1..].join(":");

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

        parse_grep_lines(&raw)
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
    "theme": { "background": "#0d1017", "foreground": "#c5c8c6", "cursor": "#5aa0ff" }
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

/// Open the main window's DevTools panel (F12 / Ctrl+Shift+I shortcut target).
/// Available in all builds so the user can inspect console output and debug
/// layout without needing a dev build.
#[tauri::command]
fn open_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.with_webview(|w| unsafe {
            #[cfg(windows)]
            if let Ok(core) = w.controller().CoreWebView2() {
                let _ = core.OpenDevToolsWindow();
            }
        });
    }
}

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

/// Pure graph walk: return the set containing `root` and all transitive children
/// found in `children`. Cycle-safe via the `HashSet::insert` guard (a pid already
/// in the set is not pushed again). Works on any platform — the Win32 snapshot
/// building that populates `children` is kept in `descendant_pids`.
fn collect_descendants(
    root: u32,
    children: &std::collections::HashMap<u32, Vec<u32>>,
) -> std::collections::HashSet<u32> {
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
    collect_descendants(root, &children)
}

#[cfg(not(windows))]
fn descendant_pids(root: u32) -> std::collections::HashSet<u32> {
    let children = std::collections::HashMap::new();
    collect_descendants(root, &children)
}

// ---- Browser panes (native child webviews) ----
//
// A real WebView2 child layered over the DOM, positioned to match a browser
// pane's rectangle in the grid. Unlike an <iframe>, it ignores
// X-Frame-Options, so any site (google, github, …) loads.

struct BrowserManager {
    views: Mutex<HashMap<u32, tauri::Webview<Wry>>>,
    /// Per-id epoch counter for on_navigation: bumped when a pane is opened so
    /// a dying predecessor's trailing navigation events are suppressed. (bug #623)
    nav_epochs: Mutex<HashMap<u32, u64>>,
    /// Per-id in-flight navigate flag: prevents concurrent navigate() calls on the
    /// same pane from piling onto the main thread. v.navigate() blocks the Win32
    /// message pump; if the user types a URL while a previous navigation is still
    /// running on the main thread the second call queues behind it and doubles the
    /// stall. Last-write-wins: the pending URL is always the most recent one, so
    /// the in-flight call uses the latest value and the queued duplicate is dropped.
    /// Arc so the map can be cloned into the run_on_main_thread closure.
    nav_pending: Arc<Mutex<HashMap<u32, String>>>,
    /// Pending bounds update per pane — same last-write-wins dedup as nav_pending.
    /// Prevents a flood of refitAll() calls from queuing N set_position/set_size
    /// closures on the main thread simultaneously.
    bounds_pending: Arc<Mutex<HashMap<u32, (f64, f64, f64, f64)>>>,
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self {
            views: Mutex::new(HashMap::new()),
            nav_epochs: Mutex::new(HashMap::new()),
            nav_pending: Arc::new(Mutex::new(HashMap::new())),
            bounds_pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Poison-tolerant views lock helper: consistent with the existing defensive
/// pattern at the on_navigation closure. If the mutex is ever poisoned a future
/// change won't brick every browser command or the ExitRequested cleanup. (bug #666)
fn lock_views(b: &BrowserManager) -> std::sync::MutexGuard<'_, HashMap<u32, tauri::Webview<Wry>>> {
    b.views.lock().unwrap_or_else(|e| e.into_inner())
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
    let old = lock_views(&browsers).remove(&id);
    // Bump the navigation epoch for this id so any on_navigation closure from
    // the dying predecessor webview can detect it is stale and skip emitting. (bug #623)
    let nav_epoch = {
        let mut epochs = browsers.nav_epochs.lock().unwrap_or_else(|e| e.into_inner());
        let e = epochs.entry(id).or_insert(0);
        *e += 1;
        *e
    };
    // The on_navigation closure runs on the main thread and captures `nav_epoch`.
    // It reads the current epoch from BrowserManager via the AppHandle to detect
    // whether it is the live webview or a stale dying predecessor. (bug #623)
    let nav_app_handle = app.clone();
    let log_url = url.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        log_info!("mt", "browser_open enter pane={}", id);
        if let Some(old) = old {
            let _ = old.close();
        }
        let result = (|| {
            let window = app2.get_window("main").ok_or("main window not found")?;
            let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
            // Event-driven URL tracking: emit the URL on each navigation instead
            // of the frontend polling location.href over CDP every couple of
            // seconds — that CDP call ran on the main thread and could freeze the
            // window's message pump (the Application Hang).
            let nav_app = app2.clone();
            // This callback runs on the MAIN thread. A heavy page (SPA, redirects,
            // sub-frame loads) fires it many times, so an un-throttled emit per hit
            // floods the message pump. Guard three ways: skip a stale predecessor
            // webview (epoch), skip an unchanged URL (dedup), and rate-limit to one
            // emit per 150ms per pane (a fast-changing SPA URL bar is cosmetic).
            let last_url = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let last_emit = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let builder = WebviewBuilder::new(format!("browser-{id}"), WebviewUrl::External(parsed))
                .on_navigation(move |u| {
                    // Generation guard: skip emit if a newer epoch exists for this id,
                    // meaning this webview was replaced and is the dying predecessor. (bug #623)
                    let current_epoch = nav_app_handle
                        .try_state::<BrowserManager>()
                        .map(|bm| {
                            bm.nav_epochs
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .get(&id)
                                .copied()
                                .unwrap_or(0)
                        })
                        .unwrap_or(0);
                    if current_epoch != nav_epoch {
                        return true; // stale — allow navigation but don't emit
                    }
                    let s = u.to_string();
                    let mut last = last_url.lock().unwrap_or_else(|e| e.into_inner());
                    if *last != s {
                        let now = now_millis();
                        let prev = last_emit.load(Ordering::Relaxed);
                        if now.saturating_sub(prev) >= 150 {
                            *last = s.clone();
                            last_emit.store(now, Ordering::Relaxed);
                            let _ = nav_app.emit(&format!("browser://{id}/url"), s);
                        }
                    }
                    true
                });
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

    let webview = match rx
        .await
        .map_err(|_| "browser_open: main-thread closure dropped".to_string())
    {
        Ok(Ok(w)) => {
            log_info!("browser", "open pane={} url={}", id, log_url);
            w
        }
        Ok(Err(e)) => {
            log_warn!("browser", "open failed pane={} url={}: {}", id, log_url, e);
            return Err(e);
        }
        Err(e) => {
            log_warn!("browser", "open failed pane={} url={}: {}", id, log_url, e);
            return Err(e);
        }
    };
    // Update nav_epochs with the live value (the Arc clone above was a snapshot).
    {
        let mut epochs = browsers.nav_epochs.lock().unwrap_or_else(|e| e.into_inner());
        epochs.insert(id, nav_epoch);
    }
    lock_views(&browsers).insert(id, webview.clone());

    // Register the ScriptDialogOpening handler on the newly-created webview so
    // that JS alert/confirm/prompt/beforeunload never shows WebView2's default
    // blocking modal. The handler runs on the main thread (same thread that fires
    // the event), stores the deferral in the thread_local, and emits an event to
    // the frontend overlay. See the long comment near PENDING_DIALOGS.
    #[cfg(windows)]
    {
        let dialog_app = app.clone();
        // with_webview closure returns () — use an inner IIFE to get ? propagation.
        let _ = webview.with_webview(move |pw| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT,
                COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM,
                COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
                COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD,
            };
            use webview2_com::ScriptDialogOpeningEventHandler;
            use windows::core::PWSTR;

            let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_sender, args| {
                // args is Option<ICoreWebView2ScriptDialogOpeningEventArgs>
                let args = match args {
                    Some(a) => a,
                    None => return Ok(()),
                };

                // Read dialog fields. PWSTR out-params are CoTaskMem-allocated;
                // take_pwstr transfers ownership into a String and frees the buffer.
                let (uri, kind_raw, msg, default_text) = unsafe {
                    let mut uri_p = PWSTR::null();
                    let _ = args.Uri(&mut uri_p);
                    let uri = webview2_com::take_pwstr(uri_p);

                    let mut kind_val = Default::default();
                    let _ = args.Kind(&mut kind_val);

                    let mut msg_p = PWSTR::null();
                    let _ = args.Message(&mut msg_p);
                    let msg = webview2_com::take_pwstr(msg_p);

                    let mut dt_p = PWSTR::null();
                    let _ = args.DefaultText(&mut dt_p);
                    let default_text = webview2_com::take_pwstr(dt_p);

                    (uri, kind_val, msg, default_text)
                };

                let kind_str = match kind_raw {
                    k if k == COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT       => "alert",
                    k if k == COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM      => "confirm",
                    k if k == COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT       => "prompt",
                    k if k == COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => "beforeunload",
                    _                                                        => "alert",
                };

                // GetDeferral suspends the page and suppresses WebView2's default
                // blocking dialog — both effects come from this single call.
                // Do this BEFORE emitting to the frontend so the page never gets
                // a chance to show its native modal (the suppression is immediate).
                let deferral = unsafe { args.GetDeferral()? };

                let req = DIALOG_SEQ.fetch_add(1, Ordering::Relaxed);
                PENDING_DIALOGS.with(|m| {
                    m.borrow_mut().insert(req, PendingDialog { args, deferral });
                });

                log_info!("browser", "dialog kind={} pane={} uri={}", kind_str, id, uri);

                let _ = dialog_app.emit(
                    &format!("browser://{id}/dialog"),
                    serde_json::json!({
                        "req": req,
                        "kind": kind_str,
                        "message": msg,
                        "defaultText": default_text,
                    }),
                );

                Ok(())
            }));

            // IIFE lets us use ? for early-return on COM failure without making
            // the outer with_webview closure return Result (it must return ()).
            let result = (|| -> windows::core::Result<()> {
                unsafe {
                    let core = pw.controller().CoreWebView2()?;
                    let mut token = Default::default();
                    core.add_ScriptDialogOpening(&handler, &mut token)?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                log_warn!("browser", "add_ScriptDialogOpening failed pane={}: {:?}", id, e);
            }
        });

        // Intercept new-window requests (target="_blank", window.open) so they
        // open as a new Scanline browser pane instead of a system browser window.
        // The frontend listens for browser://{id}/new-window and calls splitFocused.
        let new_win_app = app.clone();
        let _ = webview.with_webview(move |pw| {
            use webview2_com::NewWindowRequestedEventHandler;
            use windows::core::PWSTR;

            let handler = NewWindowRequestedEventHandler::create(Box::new(move |_sender, args| {
                let args = match args {
                    Some(a) => a,
                    None => return Ok(()),
                };
                let url = unsafe {
                    let mut p = PWSTR::null();
                    let _ = args.Uri(&mut p);
                    webview2_com::take_pwstr(p)
                };
                if url.is_empty() {
                    return Ok(());
                }
                // Mark the request as handled so WebView2 does not open a
                // native popup window or defer to the system browser.
                let _ = unsafe { args.SetHandled(true) };
                let _ = new_win_app.emit(&format!("browser://{id}/new-window"), url);
                Ok(())
            }));

            let result = (|| -> windows::core::Result<()> {
                unsafe {
                    let core = pw.controller().CoreWebView2()?;
                    let mut token = Default::default();
                    core.add_NewWindowRequested(&handler, &mut token)?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                log_warn!("browser", "add_NewWindowRequested failed pane={}: {:?}", id, e);
            }
        });
    }

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
    let v = lock_views(&browsers).get(&id).cloned();
    let Some(v) = v else { return Ok(()) };

    {
        let mut pending = browsers.bounds_pending.lock().unwrap_or_else(|e| e.into_inner());
        if pending.contains_key(&id) {
            pending.insert(id, (x, y, w, h));
            return Ok(());
        }
        pending.insert(id, (x, y, w, h));
    }

    let pending_arc = Arc::clone(&browsers.bounds_pending);
    let _ = app.run_on_main_thread(move || {
        let rect = pending_arc.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let Some((x, y, w, h)) = rect else { return };
        let _ = v.set_position(LogicalPosition::new(x, y));
        let _ = v.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
    });
    Ok(())
}

/// Navigate a browser pane to a new URL.
///
/// v.navigate() is synchronous on the Win32 main thread. Concurrent calls for
/// the same pane (e.g. rapid URL edits) pile up and can stall the message pump
/// for tens of seconds. Guard with a per-pane pending-URL slot: if a navigate
/// is already in-flight for this pane, update the slot (last-write-wins) and
/// return — the running closure will re-navigate to the latest URL when it
/// finishes, so no navigation is lost but the main thread sees at most one
/// navigate per pane at a time.
#[tauri::command]
fn browser_navigate(
    app: AppHandle,
    browsers: State<BrowserManager>,
    id: u32,
    url: String,
) -> Result<(), String> {
    let v = lock_views(&browsers).get(&id).cloned();
    let Some(v) = v else { return Ok(()) };

    {
        let mut pending = browsers.nav_pending.lock().unwrap_or_else(|e| e.into_inner());
        if let std::collections::hash_map::Entry::Occupied(mut e) = pending.entry(id) {
            // A navigate is already queued. Update to latest URL (last-write-wins)
            // and skip posting another run_on_main_thread — one in-flight is enough.
            e.insert(url);
            return Ok(());
        }
        pending.insert(id, url);
    }

    let pending_arc = Arc::clone(&browsers.nav_pending);
    let _ = app.run_on_main_thread(move || {
        let raw = pending_arc.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let Some(raw) = raw else { return };
        let Ok(target) = Url::parse(&raw) else { return };
        log_info!("mt", "browser_navigate enter pane={}", id);
        let _ = v.navigate(target);
    });
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
    let v = lock_views(&browsers).get(&id).cloned();
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
    let v = lock_views(&browsers).get(&id).cloned();
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
    let v = lock_views(&browsers).get(&id).cloned();
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
    let v = lock_views(&browsers).remove(&id);
    if let Some(v) = v {
        log_info!("browser", "close pane={}", id);
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
    let wv = lock_views(&browsers)
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

// ---- Script-dialog reply command ----
//
// The frontend sends this after the user clicks OK or Cancel in the
// Scanline-styled dialog overlay. We retrieve the pending deferral from the
// thread_local on the main thread, apply the result fields, and call Complete()
// to unblock the page. Always Complete — never leave a deferral dangling.

#[cfg(windows)]
#[tauri::command]
fn browser_dialog_reply(
    app: AppHandle,
    pane_id: u32,
    req: u64,
    accept: bool,
    text: Option<String>,
) -> Result<(), String> {
    // Dispatch to the main thread: that is where PENDING_DIALOGS lives and
    // where the COM objects (args/deferral) are valid.
    app.run_on_main_thread(move || {
        let _ = pane_id; // used only for future logging; keep for API symmetry
        let pd = PENDING_DIALOGS.with(|m| m.borrow_mut().remove(&req));
        if let Some(pd) = pd {
            unsafe {
                if accept {
                    // Accept() is the zero-arg "click OK" method on the args
                    // object. NOT calling it means the browser treats it as Cancel.
                    let _ = pd.args.Accept();
                }
                if let Some(t) = text {
                    // SetResultText sets the prompt() return value.
                    // PCWSTR is a Copy type — pass by value, not by reference.
                    let h = windows::core::HSTRING::from(t);
                    let _ = pd.args.SetResultText(windows::core::PCWSTR(h.as_ptr()));
                }
                // Always complete the deferral so the page is never left hung,
                // even on cancel (accept=false).
                let _ = pd.deferral.Complete();
            }
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn browser_dialog_reply(
    _app: AppHandle,
    _pane_id: u32,
    _req: u64,
    _accept: bool,
    _text: Option<String>,
) -> Result<(), String> {
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
            log_info!("mt", "browser_cdp enter method={}", method);
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
    // torn down / core crashed) the receiver would park forever. Use 15s so this
    // inner limit is strictly below the control-loop's 20s outer deadline — that
    // way the inner layer always loses the race and the pending entry stays
    // consistent instead of a spurious control timeout for a call that succeeded. (bug #839)
    match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(r) => r.map_err(|_| "cdp_call: no response (CoreWebView2 not ready?)".to_string())?,
        Err(_) => Err("cdp_call: timed out after 15s".to_string()),
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
    let webview = lock_views(&browsers)
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no browser pane {id}"))?;
    cdp_call(webview, method, params).await
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
    if let Some(tx) = pending.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
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

    // 1 MiB per-line cap: a client streaming bytes without '\n' cannot grow
    // memory without bound. (bug #973)
    const MAX_LINE: usize = 1 << 20;

    let mut reader = BufReader::new(server);
    let mut line = String::new();
    loop {
        line.clear();
        // Wrap read_line with a per-read idle timeout so a stalled or misbehaving
        // local process does not park this task forever. (bug #973)
        let read_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            reader.read_line(&mut line),
        )
        .await;
        match read_result {
            Err(_timeout) => break, // idle for 30s — drop the connection
            Ok(Ok(0)) => break,     // client disconnected
            Ok(Ok(n)) if n >= MAX_LINE => break, // oversized line — drop
            Ok(Err(_)) => break,
            Ok(Ok(_)) => {
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
                            // Use lock_views helper for poison-tolerance. (bug #666)
                            let wv = lock_views(&app.state::<BrowserManager>())
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
                            log_info!("control", "debug.cdp id={} => {:?}", id, res);
                            format!("{}\n", serde_json::json!({ "debug": format!("{res:?}") }))
                        } else if let Some(req_id) =
                            v.get("id").and_then(|x| x.as_str()).map(str::to_string)
                        {
                            // V2 request/response: forward to the frontend and wait
                            // for its reply (control_reply) keyed by this id.
                            // Check frontend readiness gate before emitting: if the
                            // frontend listeners are not yet set up, fail fast
                            // instead of blocking the full 20s timeout. (bug #1240)
                            let ready_state = app.try_state::<FrontendReady>();
                            if let Some(ref ready) = ready_state {
                                if !ready.flag.load(Ordering::Acquire) {
                                    // Wait up to 2s for the frontend to become ready.
                                    let notified = tokio::time::timeout(
                                        std::time::Duration::from_secs(2),
                                        ready.notify.notified(),
                                    )
                                    .await;
                                    if notified.is_err() && !ready.flag.load(Ordering::Acquire) {
                                        let resp = serde_json::json!({
                                            "id": req_id,
                                            "ok": false,
                                            "error": "frontend not ready"
                                        });
                                        let _ = reader
                                            .get_mut()
                                            .write_all(format!("{resp}\n").as_bytes())
                                            .await;
                                        continue;
                                    }
                                }
                            }
                            let (tx, rx) = tokio::sync::oneshot::channel::<serde_json::Value>();
                            app.state::<ControlPending>()
                                .0
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
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
                            // RAII guard: remove the pending entry when this scope
                            // exits (normal reply, timeout, OR pipe disconnect).
                            // This ensures abandoned tx entries never linger for the
                            // full timeout even when the caller dies mid-wait. (bug #1015)
                            struct PendingGuard<'a> {
                                pending: tauri::State<'a, ControlPending>,
                                id: String,
                                disarmed: bool,
                            }
                            impl<'a> Drop for PendingGuard<'a> {
                                fn drop(&mut self) {
                                    if !self.disarmed {
                                        self.pending.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.id);
                                    }
                                }
                            }
                            let mut guard = PendingGuard {
                                pending: app.state::<ControlPending>(),
                                id: req_id.clone(),
                                disarmed: false,
                            };
                            let resp = match tokio::time::timeout(
                                std::time::Duration::from_secs(secs),
                                rx,
                            )
                            .await
                            {
                                Ok(Ok(val)) => {
                                    guard.disarmed = true; // was already removed by control_reply
                                    val
                                }
                                _ => {
                                    // timeout or sender dropped — guard.drop() will clean up
                                    let method_str = v.get("method").and_then(|x| x.as_str()).unwrap_or("?");
                                    log_warn!("control", "rpc no reply/timeout method={} id={}", method_str, req_id);
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
        }
    }
}

/// Start the named pipe control server (\\.\pipe\scanline).
/// Uses multiple concurrent listeners to eliminate the race window where no
/// pipe instance is available between a client connection and the next
/// instance creation.
#[cfg(windows)]
fn start_control_server(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;

    // Maintain 3 concurrent listeners. When one accepts, it spawns a handler
    // and immediately starts a new listener instance.
        for i in 0..3 {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Only the very first instance of the very first listener needs first_pipe_instance(true).
            let mut first_attempt = i == 0;
            loop {
                let server = loop {
                    let mut opts = ServerOptions::new();
                    if first_attempt {
                        opts.first_pipe_instance(true);
                    }
                    match opts.create(CONTROL_PIPE) {
                        Ok(s) => {
                            first_attempt = false;
                            break s;
                        }
                        Err(e) => {
                            // If first_pipe_instance(true) fails, another listener likely won the race.
                            // Clear the flag and retry normally.
                            if first_attempt {
                                first_attempt = false;
                                continue;
                            }
                            log_error!("control", "pipe create failed: {}", e);
                            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                        }
                    }
                };

                if server.connect().await.is_ok() {
                    tauri::async_runtime::spawn(handle_control_client(server, app.clone()));
                } else {
                    // connect() failed (e.g. client disconnected before we could hand off).
                    // loop will recreate a new instance.
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        });
    }
}

#[cfg(not(windows))]
fn start_control_server(_app: AppHandle) {}

/// Best-effort install of Claude Code hooks on launch so agent status dots and
/// notifications work without the user running `scanline hooks setup` by hand.
/// Idempotent (the CLI dedups its hook entries). Silently no-ops if the bundled
/// scanline CLI can't be located. Runs detached with no console window.
#[cfg(windows)]
fn setup_agent_hooks(app: &tauri::AppHandle) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Some(cli) = locate_scanline_cli(app) else {
        return;
    };
    // Run on a side thread (off the setup/main thread) and capture output: if the
    // installer bails (e.g. an unparseable settings.json it refuses to clobber),
    // record why in hooks.log instead of swallowing it on a detached process.
    std::thread::spawn(move || {
        let out = std::process::Command::new(&cli)
            .args(["hooks", "setup"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                log_info!("hooks", "setup ok");
            } else {
                log_warn!("hooks", "setup failed: {}", String::from_utf8_lossy(&o.stderr));
            }
        }
    });
}

/// Resolve the scanline CLI: the bundled resource (shipped install), else a
/// sibling of the app binary, else `<repo>/cli/scanline.exe` up the dev tree.
#[cfg(windows)]
fn locate_scanline_cli(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let c = dir.join("scanline.exe");
        if c.exists() {
            return Some(c);
        }
    }
    let exe = std::env::current_exe().ok()?;
    if let Some(dir) = exe.parent() {
        let sib = dir.join("scanline.exe");
        if sib.exists() {
            return Some(sib);
        }
    }
    for anc in exe.ancestors() {
        let cand = anc.join("cli").join("scanline.exe");
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

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
            // No WM_GETMINMAXINFO clamp: the window keeps its native frame, and
            // Windows already maximizes a decorated window to the monitor work
            // area (respecting the taskbar) while pushing the invisible resize
            // borders off-screen so the client fills exactly. Clamping ptMaxSize
            // to the work area instead left those ~8px borders on-screen at the
            // bottom — the dark bar under the terminal when maximized.
        }
    }
}

/// Called by the frontend after registering its control://request listeners.
/// Flips the readiness gate so V2 requests no longer fail-fast. (bug #1240)
#[tauri::command]
fn control_frontend_ready(ready: State<FrontendReady>) {
    ready.flag.store(true, Ordering::Release);
    ready.notify.notify_waiters();
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
        // Cross-reference into scanline.log for the unified timeline. log::write
        // is a no-op if LOG is uninitialized (pre-setup panic) so no recursion risk.
        log_error!("panic", "{}", info);
        eprintln!("{line}");
        prev(info);
    }));

    // Init logging after the panic hook so even very-early panics cross-reference.
    if let Some(p) = log_path() {
        log::init(p);
    }

    tauri::Builder::default()
        // MUST be the first plugin: a second launch hands its args to this
        // callback (running in the already-live instance) and then exits, so
        // only one Scanline process ever owns the PTYs / control pipe / window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(PtyManager::default())
        .manage(BrowserManager::default())
        .manage(ControlPending::default())
        .manage(FrontendReady::default())
        .setup(|app| {
            log_info!("app", "scanline started v{} pid={}", env!("CARGO_PKG_VERSION"), std::process::id());
            start_hang_watch(app.handle().clone());
            start_control_server(app.handle().clone());
            #[cfg(windows)]
            {
                if let Some(win) = app.get_webview_window("main") {
                    apply_dark_titlebar(&win);
                }
                setup_agent_hooks(app.handle());
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
            browser_dialog_reply,
            control_reply,
            control_frontend_ready,
            repo_info,
            pane_ports,
            grep_dir,
            save_session,
            load_session,
            load_config,
            edit_config,
            save_config,
            open_devtools
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On shutdown, kill child shells and drop webviews. Otherwise the
            // pty reader threads block on a live child (app hangs on close) and
            // native webviews leak as orphans.
            if let RunEvent::ExitRequested { .. } = event {
                // Poison-tolerant locks: a panicked pty thread must not prevent
                // child shells from being killed (which would hang the app on close). (bug #1282)
                if let Some(ptys) = app.try_state::<PtyManager>() {
                    let mut map = ptys.ptys.lock().unwrap_or_else(|e| e.into_inner());
                    let pty_count = map.len();
                    let browser_count = app
                        .try_state::<BrowserManager>()
                        .map(|b| lock_views(&b).len())
                        .unwrap_or(0);
                    log_info!("app", "shutdown: killing {} ptys, {} browsers", pty_count, browser_count);
                    for (_, mut p) in map.drain() {
                        let _ = p.child.kill();
                    }
                }
                // lock_views for poison-tolerance here too. (bug #1282, #666)
                if let Some(browsers) = app.try_state::<BrowserManager>() {
                    for (_, v) in lock_views(&browsers).drain() {
                        let _ = v.close();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    // ---- parse_listening_ports ----

    fn pid_set(pids: &[u32]) -> HashSet<u32> {
        pids.iter().copied().collect()
    }

    #[test]
    fn ports_tcp_ipv4_included() {
        let out = "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert_eq!(ports, vec![3000]);
    }

    #[test]
    fn ports_tcp_ipv6_included() {
        let out = "  TCP    [::]:8080              [::]:0                 LISTENING       1234";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert_eq!(ports, vec![8080]);
    }

    #[test]
    fn ports_pid_not_in_set_excluded() {
        let out = "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9999";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert!(ports.is_empty());
    }

    #[test]
    fn ports_established_excluded() {
        let out = "  TCP    0.0.0.0:3000           0.0.0.0:0              ESTABLISHED     1234";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert!(ports.is_empty());
    }

    #[test]
    fn ports_dedup_v4_and_v6_same_port() {
        let out = "\
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234\n\
  TCP    [::]:3000              [::]:0                 LISTENING       1234";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert_eq!(ports, vec![3000]);
    }

    #[test]
    fn ports_sorted_ascending() {
        let out = "\
  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234\n\
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234\n\
  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       1234";
        let ports = parse_listening_ports(out, &pid_set(&[1234]));
        assert_eq!(ports, vec![443, 3000, 8080]);
    }

    // ---- parse_grep_lines ----

    #[test]
    fn grep_basic_line() {
        let raw = "src/main.rs:42:  let x = 1";
        let out = parse_grep_lines(raw);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["file"], "src/main.rs");
        assert_eq!(out[0]["line"], 42);
        assert_eq!(out[0]["text"], "let x = 1");
    }

    #[test]
    fn grep_text_trimmed() {
        let raw = "src/foo.rs:1:   spaces   ";
        let out = parse_grep_lines(raw);
        assert_eq!(out[0]["text"], "spaces");
    }

    #[test]
    fn grep_missing_line_number_field_skipped() {
        // Only one colon — splitn(3,':') yields file and lno="" -> skipped.
        // file="src/foo.rs", lno="no colon here at all", text="" -> lno is non-empty
        // so it proceeds. A truly missing field means only one segment; test that:
        let raw2 = "just_a_word_no_colons";
        let out = parse_grep_lines(raw2);
        assert!(out.is_empty(), "line with no colons must be skipped");
    }

    #[test]
    fn grep_text_truncated_at_160_chars() {
        let long = "x".repeat(200);
        let raw = format!("src/foo.rs:1:{}", long);
        let out = parse_grep_lines(&raw);
        let text = out[0]["text"].as_str().unwrap();
        assert_eq!(text.chars().count(), 160);
    }

    #[test]
    fn grep_non_numeric_line_number_becomes_zero() {
        let raw = "src/foo.rs:abc:some text";
        let out = parse_grep_lines(raw);
        assert_eq!(out[0]["line"], 0);
    }

    // Windows absolute paths like `C:\path\foo.rs:3:hit` are handled correctly
    // by checking if the first part is a drive letter and the second starts with '\'.
    #[test]
    fn grep_absolute_windows_path_parsed_correctly() {
        // Input as rg would emit for an absolute path.
        let raw = r"C:\path\foo.rs:3:hit";
        let out = parse_grep_lines(raw);
        assert_eq!(
            out[0]["file"], r"C:\path\foo.rs",
            "absolute Windows path parses correctly with drive letter"
        );
        assert_eq!(out[0]["line"], 3);
    }

    // ---- collect_descendants ----

    fn children_map(pairs: &[(u32, u32)]) -> HashMap<u32, Vec<u32>> {
        let mut m: HashMap<u32, Vec<u32>> = HashMap::new();
        for &(parent, child) in pairs {
            m.entry(parent).or_default().push(child);
        }
        m
    }

    #[test]
    fn descendants_root_two_kids_one_grandkid() {
        // root -> A, B; A -> C
        let ch = children_map(&[(1, 2), (1, 3), (2, 4)]);
        let got = collect_descendants(1, &ch);
        assert_eq!(got, HashSet::from([1, 2, 3, 4]));
    }

    #[test]
    fn descendants_cycle_terminates() {
        // A -> B -> A (cycle)
        let ch = children_map(&[(10, 20), (20, 10)]);
        let got = collect_descendants(10, &ch);
        assert_eq!(got, HashSet::from([10, 20]));
    }

    #[test]
    fn descendants_root_absent_returns_root() {
        let ch: HashMap<u32, Vec<u32>> = HashMap::new();
        let got = collect_descendants(42, &ch);
        assert_eq!(got, HashSet::from([42]));
    }

    #[test]
    fn descendants_diamond_deduped() {
        // A -> B, A -> C, B -> D, C -> D
        let ch = children_map(&[(1, 2), (1, 3), (2, 4), (3, 4)]);
        let got = collect_descendants(1, &ch);
        assert_eq!(got, HashSet::from([1, 2, 3, 4]));
    }

    // ---- take_chunk ----

    #[test]
    fn take_chunk_len_lte_max_returns_all_empties_buf() {
        let mut buf = vec![1u8, 2, 3];
        let chunk = take_chunk(&mut buf, 10);
        assert_eq!(chunk, vec![1, 2, 3]);
        assert!(buf.is_empty());
    }

    #[test]
    fn take_chunk_len_gt_max_returns_max_remainder_kept() {
        let mut buf = vec![1u8, 2, 3, 4, 5];
        let chunk = take_chunk(&mut buf, 3);
        assert_eq!(chunk, vec![1, 2, 3]);
        assert_eq!(buf, vec![4, 5]);
    }

    #[test]
    fn take_chunk_empty_buf_returns_empty() {
        let mut buf: Vec<u8> = vec![];
        let chunk = take_chunk(&mut buf, 10);
        assert!(chunk.is_empty());
        assert!(buf.is_empty());
    }
}

