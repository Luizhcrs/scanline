# cmux → Windows Port Plan (via Scanline)

**Date:** 2026-05-31
**Status:** Proposed (supersedes the roadmap section of [2026-05-30-scanline-design.md](./2026-05-30-scanline-design.md); that spec's architecture still holds)
**Method:** 30-agent workflow — 12 subsystem readers over the real cmux source + 4 scored port strategies + adversarial critic.

## TL;DR

**Scanline already _is_ the Windows port of cmux.** The 2026-05-30 spec is correct: extend Scanline in place, do not fork, do not start fresh, do not attempt Swift-on-Windows.

cmux is a native macOS app (Swift/AppKit, ~812 Swift files, libghostty/Metal terminal, WKWebView browser, Sparkle, GPL-3.0). None of the platform layer ports to Windows. The thesis cost is **accepted**: the GPU-native terminal (ghostty/Metal, ghostty config, kitty graphics, ligatures) is permanently dropped; xterm.js + ConPTY is the Windows reality.

The value is not the UI chrome — it is the **agent/IPC/automation layer**. Strategy: build that layer on Scanline's working Rust core **first** (behind the GUI that already runs), then surface it through DOM UI.

### Strategy scores (workflow, adversarial)

| Strategy | avg | weeks | verdict |
|----------|-----|-------|---------|
| **A — extend Scanline (Tauri/WebView2)** | 5.0 | 34 | **chosen** — only one with the two scariest bets already proven in running code |
| C — Electron rewrite (Wave model) | 5.0 | 34 | throws away a working foundation to chase ONE unproven bet (browser-in-split-cell) |
| D — headless-first | 6.0 | 11 | highest score; **grafted as phase ordering**, not adopted (risks GUI never shipping) |
| B — Swift-on-Windows + WinUI | 2.3 | 34 | dead — unproven toolchain, still ships xterm.js terminal, pays most to land in same place |

**Decision: A's foundation + D's discipline.** Ship the agent/IPC/hook moat on the daemon-grade Rust core first, demoable on the already-running Scanline window.

## CRITICAL reconciliation — integration model

The workflow's raw plan ported cmux's **macOS hook-callback model** (`cmux hooks <agent> <event>` writing per-agent config). **This is wrong for Scanline.** Scanline's approved spec already chose the **tmux-interception model from cmux-cross**:

> agent runs `tmux split-window` → busybox `tmux.exe` shim → `\\.\pipe\scanline` → app spawns pane

**Keep the tmux-shim model. Keep the Go `cli/` from cmux-cross.** Do not import cmux's macOS hook subsystem wholesale. Hooks become a _secondary_ integration for agents that don't call tmux (notification/OSC + optional per-agent config), layered on top — not the primary path.

This also resolves the language question: **CLI/shim stays Go** (reused from cmux-cross, per the approved spec), the **pipe server is Rust** (in the Tauri process). The workflow's "Rust cmux.exe CLI" is rejected.

## License constraint (hard)

cmux is **GPL-3.0-or-later**. Scanline is **MIT** (own product, no GPL deps — per the spec). Therefore: **cmux Swift/Go source is read-only SPEC, never copied source.** Every port is a clean-room reimplementation from behavior, not a translation of GPL code. Capture behavior in `SPEC.md` references; implement fresh in Rust/TS. The Go `cli/` reuse is from **cmux-cross** (the user's own cross fork), not upstream GPL cmux — confirm cmux-cross license permits MIT relicensing before reuse.

## Phase 0 — De-risk the unfalsifiable bets (SPIKE, ~3wk) — DO FIRST

Two bets are "unfalsifiable until built." Prove them before committing the roadmap. Each is a GO/NO-GO gate.

1. **Browser automation (the differentiator).** Scanline's `lib.rs:222` only does fire-and-forget `v.eval()` — no return value, no CDP. The scriptable agent-browser API (a11y snapshot, click, fill, eval-with-result, screenshot) needs `ICoreWebView2.CallDevToolsProtocolMethodAsync` via hand-written `windows-rs` COM through Tauri's `with_webview()` escape hatch.
   - **De-risk note from critic:** `webview2-com 0.38.2` and `windows 0.61.3` are **already transitive deps in Cargo.lock** — the COM interop is less "unbounded" than the raw plan claimed.
   - Spike: prove `Runtime.evaluate` (returns a value), `Accessibility.getFullAXTree` (snapshot + how @-refs map to node ids), `Input.dispatchMouseEvent` (isTrusted click), `Page.captureScreenshot` end-to-end.
   - **GO/NO-GO with a real parity target:** WebView2 exposes a _constrained_ CDP subset. If `getFullAXTree` @-ref mapping or cross-origin-iframe eval is intractable → browser automation scopes to eval-only and the product gets re-messaged honestly. Decide at week 3, not week 30.

2. **Terminal perf under agent firehose (the thesis bet).** Every ConPTY chunk crosses Tauri IPC. **Critic correction:** the current bridge serializes bytes as **JSON `number[]`** both directions (`pane.ts` `Array.from(data, c=>c.charCodeAt(0)&0xff)` on write; `Vec<u8>`→JSON on read) — far worse than a binary channel.
   - Spike: 6–8 concurrent xterm.js+ConPTY panes + `@xterm/addon-webgl`, synthetic high-rate output, measure interactive latency + dropped frames.
   - **Pre-commit a NUMERIC bar** (e.g. ≤16ms median input-to-echo, <1% dropped frames at 8 panes × N MB/s). If it fails → batched/binary IPC channel, or `alacritty_terminal`+wgpu native renderer, before building features on a core that fails its one job.

3. **Blocking-hook park/resume concurrency.** A tokio oneshot waiter-table over named pipes — cmux's single subtlest, highest-correctness code. Build it first with a concurrency fuzz/stress harness, no UI dependency.

**Also in Phase 0 (critic must-fixes):** bootstrap test infra (Rust `#[cfg(test)]` convention + a TS test runner — repo has ZERO tests today); decide WebView2 runtime **Evergreen vs Fixed Version**; decide **MSIX-identity (toast inline actions) vs NSIS/MSI+tauri-plugin-updater (self-update)** packaging — they pull opposite directions (likely: NSIS/MSI self-update + a registered COM-activator AUMID for toasts).

## Phases 1–4

Mapped onto the existing Scanline roadmap (spec phases 3 & 5 are absorbed/re-scoped here).

| Phase | Goal | Weeks | Key deliverables |
|-------|------|-------|------------------|
| **1 — Headless core** (graft D) | Ship the agent/IPC/hook moat on the Rust core, demoable on the running window | 11 | tokio named-pipe JSON-RPC server in Tauri process (per-SID pipe + peer-PID check); **Go tmux-shim from cmux-cross** wired to the pipe (`pane.split/focus/close`); `__tmux-compat` handler; session-restore index in `%USERPROFILE%\.cmuxterm`; resume/fork argv builders; hibernation via Win32 **Job Objects** + idle poll; blocking-hook park/resume (from Spike 3) + tray approve/deny + toast; nucleo as in-process `#[tauri::command]`; serde_json settings store in `%APPDATA%` + notify watcher; **single-instance + pipe-discovery** (tauri-plugin-single-instance); **per-pane CWD via OSC 7** (the sidebar depends on it); GitHub Actions CI (windows-latest, MSVC) + Authenticode-signed WiX MSI |
| **2 — GUI value layer** | Surface the backend through cmux's signature UI, all DOM bound to Rust state | 10 | DOM sidebar (git branch/dirty via `git.exe`, PR via `gh.exe`, ports via `GetExtendedTcpTable`) + attention rings; notification/Feed store (dedup/cooldown/unread) reimplemented Rust/TS + tests; Windows toasts (MSIX/AUMID) + taskbar badge; Feed cards (permission/plan/question) → park/resume; command palette (nucleo + DOM); per-pane tab strips, split zoom, equalize on `layout.ts`; terminal addons productionized (webgl, search, OSC 9/99/777 + bell + title parser → notification store) |
| **3 — Browser automation + remote** | Land the scriptable browser + SSH workspaces (productionize Spike 1) | 10 | ~70-method `browser.*` automation P0/P1 via proven CoreWebView2 CDP interop; browser stays full-area tab (split-leaf deferred); CookieManager + per-profile user-data-folder; SSH remote = Rust `ssh.exe` stdio driver + **cross-compiled `cmuxd-remote` Go binary shipped beside app** + HMAC relay + signed trust manifest; tauri-plugin-updater stable+nightly (minisign); Authenticode EV signing live |
| **4 — Hardening / parity / fast-follows** | Close gaps, ship punted items | 8 | remaining ~9 of 14 agents; P2 automation (network/screencast); cookie/profile **import** (DPAPI + Chromium app-bound AES-GCM — fragile, isolated); multi-window; tray/global-hotkey polish; optional Cloud VM client; browser-as-split-leaf re-eval (only if WebView2 airspace proves tractable) |

**MVP = Phase 0 + 1 + 2 (~24 weeks).** Feature-complete ~34 weeks. Timeline assumes Spike 1 returns GO; a NO-GO voids most of Phase 3 — there is no estimate branch for that yet.

## Per-subsystem migration

| Subsystem | Verdict | Windows approach | Effort |
|-----------|---------|------------------|--------|
| terminal (ghostty) | **reuse Scanline + addons** | keep ConPTY+portable-pty pump + xterm.js; add webgl/search/OSC; ghostty/Metal **dropped** | S |
| panels/splits | reuse `layout.ts` (= bonsplit core) + build features | tabs/zoom/equalize are net-new on the existing tree | L |
| browser | reuse hosting + build CDP automation | `add_child` WebView2 + `browser.ts` rect-sync verbatim; automation = bespoke COM/CDP | XL |
| cli-ipc | **Go shim (cmux-cross) + Rust pipe server** | tmux-shim model per spec; NOT cmux hooks; NOT a Rust CLI | L |
| agent-integration | build fresh in Rust (the moat) | hook-config writers/argv builders as clean-room Rust; MVP ~5 Windows agents | XL |
| sidebar/notifications | build fresh DOM + Rust metadata | DOM sidebar/Feed; toasts via WinAppSDK; needs per-pane CWD | XL |
| palette/search | reuse nucleo in-process + DOM | nucleo plain Cargo dep; FFI evaporates; scorer-parity is the work | M |
| swift-packages | reimplement pure-logic as Rust/TS | CmuxSettings 54-key catalog → serde store; AuthCore → Rust | L |
| app/windowing | extend single window; defer multi-window | Tauri single window + DOM tab strip; full menu/chrome deferred | M (MVP) |
| daemon-remote | reuse Go binary + local SSH driver | `cmuxd-remote` cross-compiled, shipped beside app | M |
| build/packaging | reuse scaffold + add updater/signing/CI | MSI+NSIS already emitted; add updater/signing/CI | L |
| web backend | reuse as-is, defer client | stays on Vercel; Windows app is an HTTP client only if Cloud VMs wanted | S |

## Top risks (with mitigations)

1. **Browser automation COM interop** is a bespoke subsystem masquerading as a library call, and it IS the differentiator → Phase 0 Spike 1 GO/NO-GO gate; webview2-com/windows crates already present de-risk it.
2. **Agent-output firehose perf** — thesis-violating and currently `number[]`-over-JSON → Phase 0 Spike 2 with a pre-committed numeric bar; fallback = binary IPC or native renderer.
3. **Blocking-hook park/resume** — deadlock/stale-decision corrupts agent orchestration → Spike 3 first, fuzz harness.
4. **Win32 Job Object tree-kill** — no Unix analog; get it wrong and hibernated agents orphan children. `portable-pty` Job-Object assignment is an **open API question**, not verified → spike the assignment-before-resume path.
5. **`window.add_child` is behind Tauri's `unstable` feature** — the "working foundation" is pinned to a moving API with no semver guarantee → pin Tauri version, track changelog.
6. **Authenticode EV/cloud signing** — procurement + cost + SmartScreen reputation lead time → start Azure Trusted Signing / SignPath in week 1 (resource ask, not code).
7. **Packaging tension** MSIX-identity (toasts) vs self-update (NSIS/MSI) → resolve in Phase 0.

## Critic's open gaps to resolve

- **Per-pane CWD / OSC 7 shell integration** — the entire sidebar git/PR/branch feature silently depends on it; PowerShell/cmd don't emit OSC 7 by default. Make it a Phase-1 item.
- **IME / dead keys** in xterm.js+ConPTY — real correctness gap for the user's own pt-BR environment; absent from every phase. Add to terminal hardening.
- **Clipboard fidelity** — bracketed paste, multiline-paste guards (cmux has `CMUXPasteboardFidelity`).
- **Settings UI** — 54-key catalog has no editor surface in any phase; add one.
- **Theming** — on Scanline's own roadmap; ghostty config dropped, so define a fresh colors/fonts/keybindings story (terminal THEME is hardcoded in `pane.ts` today).
- **Telemetry/crash reporting** — decide keep/drop; blind to field failures of the highest-risk code otherwise.

## First week

1. Rename app identity off Scanline branding (`tauri.conf.json` productName + `dev.luizrs.scanline`) → cmux-Windows identity; create `.github/workflows` (windows-latest + MSVC `tauri build`) — repo has no CI today.
2. **Spike 1:** `with_webview()` → raw `ICoreWebView2` via windows-rs → `CallDevToolsProtocolMethodAsync` `Runtime.evaluate` returning a real value. Prove it beats fire-and-forget eval before anything else.
3. **Spike 2:** perf harness, 6–8 panes + addon-webgl, synthetic firehose; commit the numeric bar.
4. **Spike 3:** tokio named-pipe JSON-RPC listener (per-SID + `GetNamedPipeClientProcessId`) + oneshot waiter-table prototype + concurrency stress test.
5. Scaffold additive Rust modules (`ipc_server`, `agent_hooks`, `browser_cdp`, `settings`) with cmux JSON-RPC method names stubbed `not_supported` — fix the protocol contract first.
6. Start Authenticode EV / Azure Trusted Signing procurement (lead time, resource ask).
7. Extract portable cmux behavior into `SPEC.md` (read-only from source): tmux-compat protocol (cmux-cross), settings catalog, resume/fork argv grammar, hook-config formats. **Clean-room only — preserve MIT.**

## Resource asks for the user (only you can do)

- **Code-signing cert** — Azure Trusted Signing or SignPath/EV cert (cost + lead time). Without it: SmartScreen warnings until reputation builds.
- **cmux-cross license confirmation** — verify the Go `cli/` reuse is MIT-compatible (upstream cmux is GPL-3.0).
- **Scope call on browser automation** — if Spike 1 is NO-GO, accept eval-only browser scripting (the ~70-method agent-browser parity is the single biggest uncertain bet).
