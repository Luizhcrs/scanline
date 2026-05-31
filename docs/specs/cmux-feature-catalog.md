# cmux -> Scanline — Full Feature Catalog

Generated 2026-05-31 by a 14-agent feature-cataloging workflow over the cmux source + README. 291 features across 12 areas. Status relative to Scanline at that date. Format: [status/priority/effort].

## workspaces-windows

### [todo/P0/L] New workspace
- **Behavior:** Creates a new workspace (a new vertical-tab/sidebar entry) with one fresh terminal pane. New workspace inherits the focused workspace's working directory (toggleable in Settings) and terminal font, becomes selected, and is auto-titled 'Terminal N'.
- **Shortcut/CLI:** Cmd+N (CLI/socket: workspace.new via control socket)
- **cmux impl:** Menu 'New Workspace' (cmuxApp.swift:583) -> AppDelegate.performNewWorkspaceAction (AppDelegate.swift:6776) -> TabManager.addWorkspace (TabManager.swift:2765). addWorkspace snapshots source workspace, computes inherited working dir via implicitWorkingDirectoryForNewWorkspace, makes Workspace, inserts into tabs[] at placement index, selects it.
- **Windows approach:** Introduce a Workspace data model in layout.ts/types.ts above the current single grid: each workspace owns its own binary split tree + selected-leaf. Add a workspaces[] array + activeWorkspaceId in TS state, render only the active workspace's grid. New workspace = push a workspace with one terminal leaf, spawn a ConPTY (existing portable-pty path) with cwd inherited from focused pane's cwd (track per-pty cwd via OSC 7 or GetCurrentDirectory of the shell). Add Ctrl+N keybinding via xterm attachCustomKeyEventHandler / global keydown. Extend named-pipe protocol with workspace.new.
- **Deps:** Workspace data model (new); per-pane cwd tracking for inheritance

### [todo/P1/S] Jump to workspace 1-8
- **Behavior:** Pressing the modifier + a digit 1..8 immediately selects the workspace at that 1-based index in the sidebar list (no-op if fewer workspaces exist).
- **Shortcut/CLI:** Cmd+1 .. Cmd+8
- **cmux impl:** ForEach(1...9) in windowAndViewCommands (cmuxApp.swift:864) binds digits to selectWorkspaceByNumber; WorkspaceShortcutMapper.workspaceIndex maps digit 1..8 to fixed zero-based index (TerminalDirectoryOpenSupport.swift:767), then TabManager.selectTab(at:).
- **Windows approach:** Global keydown handler in main.ts: on Ctrl+Digit (1-8) compute index, call a selectWorkspace(index) that swaps the rendered grid to workspaces[index]. Trivial once the workspaces[] array exists. Port the digit->index mapper verbatim (clean-room, it is one if).
- **Deps:** New workspace / Workspace data model

### [todo/P1/S] Jump to last workspace
- **Behavior:** Modifier+9 always selects the last workspace in the list regardless of count.
- **Shortcut/CLI:** Cmd+9
- **cmux impl:** Same selectWorkspaceByNumber path; WorkspaceShortcutMapper returns workspaceCount-1 for digit 9 (TerminalDirectoryOpenSupport.swift:771).
- **Windows approach:** Same keydown handler: digit 9 -> select workspaces[length-1]. Part of the same mapper port.
- **Deps:** Jump to workspace 1-8

### [todo/P1/S] Next workspace
- **Behavior:** Advances selection to the next workspace in the sidebar order (wraps around).
- **Shortcut/CLI:** Ctrl+Cmd+] (nextSidebarTab)
- **cmux impl:** Menu 'Next Workspace' (cmuxApp.swift:821) -> TabManager.selectNextTab(). Note cmux's 'tab' in TabManager == workspace.
- **Windows approach:** Keybinding -> select (activeWorkspaceIndex+1) % workspaces.length, swap grid. Add to global keydown router. Pick a Windows-friendly chord (e.g. Ctrl+PageDown or Ctrl+Tab on the workspace list).
- **Deps:** New workspace / Workspace data model

### [todo/P1/S] Previous workspace
- **Behavior:** Moves selection to the previous workspace in the sidebar order (wraps around).
- **Shortcut/CLI:** Ctrl+Cmd+[ (prevSidebarTab)
- **cmux impl:** Menu 'Previous Workspace' (cmuxApp.swift:825) -> TabManager.selectPreviousTab().
- **Windows approach:** Keybinding -> select (index-1+len)%len, swap grid. Mirror of Next workspace (e.g. Ctrl+PageUp).
- **Deps:** New workspace / Workspace data model

### [todo/P0/M] Close workspace
- **Behavior:** Closes the focused workspace, killing all its panes/ptys; if it has running processes a confirmation is shown; if it is the last workspace in the window, the window closes. Closed workspace is pushed to recently-closed history for reopen.
- **Shortcut/CLI:** Cmd+Shift+W
- **cmux impl:** Menu 'Close Workspace' (cmuxApp.swift:639) -> closeTabOrWindow() -> TabManager.closeWorkspaceWithConfirmation (TabManager.swift:7442) -> closeWorkspace (TabManager.swift:7253); records ClosedItemHistory; closeWorkspaceIfRunningProcess gates confirmation.
- **Windows approach:** closeWorkspace(id): kill all ptys in that workspace's tree (existing exit-cleanup path), close any WebView2 children, remove from workspaces[], select neighbor; if last workspace either keep an empty one or close the Tauri window. Confirmation = Tauri dialog plugin when any pty child process is alive (enumerate via job object or track spawned PIDs). Push a serialized snapshot to a recently-closed ring for reopen.
- **Deps:** New workspace / Workspace data model; pty lifecycle tracking; (optional) confirmation dialog

### [todo/P2/S] Rename workspace
- **Behavior:** Opens an inline rename input (in the command-palette overlay) prefilled with the current workspace title; entering a name sets a custom title shown in the sidebar; persists with the session.
- **Shortcut/CLI:** Cmd+Shift+R
- **cmux impl:** Menu 'Rename Workspace…' (cmuxApp.swift:829) -> AppDelegate.requestRenameWorkspaceViaCommandPalette (AppDelegate.swift:14106) -> command palette rename mode -> Workspace.setCustomTitle.
- **Windows approach:** Add a customTitle field to the Workspace model. Build a small DOM rename overlay (input box positioned over the sidebar row, or in a future command palette) bound to Ctrl+Shift+R; on commit update workspace.title and re-render the sidebar. No native API needed beyond DOM. Persist to the session JSON.
- **Deps:** New workspace / Workspace data model; sidebar (todo)

### [todo/P3/S] Edit workspace description
- **Behavior:** Opens a multi-line editor (command palette) to set a free-text description/notes string on the workspace, separate from its title.
- **Shortcut/CLI:** Alt+Cmd+E (editWorkspaceDescription)
- **cmux impl:** Menu 'Edit Workspace Description…' (cmuxApp.swift:833) -> AppDelegate.requestEditWorkspaceDescriptionViaCommandPalette (AppDelegate.swift:14183) -> command palette .workspaceDescriptionInput mode (ContentView.swift:9605) with a multi-line editor.
- **Windows approach:** Add a description field to the Workspace model; reuse the rename overlay pattern but with a <textarea>. Surface the value in the sidebar row metadata. Persist with session. Pure DOM.
- **Deps:** Rename workspace (shares overlay); sidebar (todo)

### [todo/P2/M] Go to Workspace (switcher / quick-open)
- **Behavior:** Opens a fuzzy-search command palette listing all workspaces (across the window) with metadata; typing filters, Enter jumps to the selected workspace.
- **Shortcut/CLI:** Cmd+P (goToWorkspace)
- **cmux impl:** Menu 'Go to Workspace…' (cmuxApp.swift:611) posts .commandPaletteSwitcherRequested; CommandPalette overlay runs fuzzy search (CommandPaletteSearch.swift) over workspaces and selects on Enter.
- **Windows approach:** DOM overlay with an input + filtered list of workspaces (fuzzy match in JS, e.g. simple subsequence/fzf-style scorer). Enter -> selectWorkspace. Bind Ctrl+P. This is the seed of the broader command palette (a separate area) but the workspace switcher is the minimum viable slice.
- **Deps:** New workspace / Workspace data model; command palette infra (not yet built)

### [todo/P2/L] New window
- **Behavior:** Opens a second independent top-level app window, each with its own set of workspaces, its own sidebar, and its own grid; windows share the app process and config.
- **Shortcut/CLI:** Cmd+Shift+N (also right-click sidebar -> New Window)
- **cmux impl:** Menu 'New Window' (cmuxApp.swift:579) -> AppDelegate.openNewMainWindow (AppDelegate.swift:6668) -> createMainWindow (AppDelegate.swift:7763) which builds an NSWindow + a fresh TabManager registered in mainWindowControllers/mainWindowContexts. Each window context owns its own TabManager (windows[].tabManager).
- **Windows approach:** Tauri multi-window: WebviewWindow::new on the Rust side (or app.create_window) spawning another instance of the app frontend. Each window gets its own JS state (workspaces[]). Backend must namespace pty/webview/control-server resources per window (window label as key). The named-pipe control server already exists; route commands to the active/target window. Significant plumbing: per-window pty event channels, exit cleanup per window, focus tracking.
- **Deps:** Workspace data model; per-window resource namespacing in Rust backend

### [todo/P3/XL] Move workspace to new window
- **Behavior:** Detaches the focused (or a chosen) workspace from its current window and opens it in a brand-new window; the source window keeps its other workspaces (and closes if it becomes empty). Available from the sidebar right-click menu.
- **Shortcut/CLI:** (no default key; context menu 'New Window' on a workspace row)
- **cmux impl:** Sidebar context menu (cmuxApp.swift:1125,1028) -> AppDelegate.moveWorkspaceToNewWindow (AppDelegate.swift:4497): createMainWindow, moveWorkspaceToWindow to relocate the Workspace + its panes, then remove the bootstrap workspace from the new window. Related: moveSurfaceToNewWorkspace for single-pane detach (AppDelegate+MoveTabToNewWorkspace.swift).
- **Windows approach:** After multi-window exists: serialize the workspace (split tree + pane descriptors) and re-attach to a newly created Tauri window. The hard part is moving live ConPTY sessions across windows without restarting the shell — either (a) keep ptys owned by the Rust backend keyed by pane id and just re-point which window's webview subscribes to their byte stream (preferred, preserves session), or (b) re-spawn (loses scrollback/process). WebView2 browser children must be re-parented to the new window's HWND (or recreated). Remove source workspace; close source window if empty.
- **Deps:** New window; backend-owned pty/webview ownership decoupled from window

### [todo/P1/L] Reopen previous session (restore previous app launch)
- **Behavior:** Rebuilds the entire previous app state from the last quit: windows, workspaces, pane/split layout, working directories, best-effort terminal scrollback, and browser URL/history. Supported agent sessions can auto-resume via saved native session IDs.
- **Shortcut/CLI:** Cmd+Shift+O (also File > Reopen Previous Session; CLI: cmux restore-session)
- **cmux impl:** History menu 'Restore Previous Launch' (cmuxApp+HistoryMenu.swift:44) -> AppDelegate.reopenPreviousSession (AppDelegate.swift:3111) -> restorePreviousSessionSnapshot (AppDelegate.swift:3119). Snapshot persisted under Application Support/cmux via SessionPersistence; layout rebuilt first, then agent resume commands run.
- **Windows approach:** On quit, serialize windows/workspaces/split-trees/cwds/browser URLs to %APPDATA%/scanline/session.json (Rust fs). On launch (or on Ctrl+Shift+O), parse and rebuild: recreate workspaces and split trees, spawn ptys with saved cwd, restore browser WebView2 to saved URL. Scrollback restore is best-effort (persist xterm serialize-addon buffer to disk). Agent resume = out of scope here (agent-hooks area).
- **Deps:** Workspace data model; session serialization format; layout.ts serialize/deserialize

### [todo/P2/M] Reopen last closed (workspace/tab/window history)
- **Behavior:** Reopens the most recently closed item (workspace, tab, or browser panel) from a recently-closed history stack; a History menu lists up to ~10 recently closed items to pick from.
- **Shortcut/CLI:** Cmd+Shift+T (reopenClosedBrowserPanel/reopenMostRecentlyClosedItem)
- **cmux impl:** History menu 'Reopen Last Closed' (cmuxApp+HistoryMenu.swift:31) -> AppDelegate.reopenMostRecentlyClosedItem; ClosedItemHistory store (AppDelegate+ClosedItemHistory.swift, ClosedItemHistory.swift) keeps closed workspaces/tabs/windows with snapshots; menu section lists them (recentlyClosedMenuSection).
- **Windows approach:** Maintain a JS ring buffer of closed-workspace snapshots (split tree + pane cwds, captured at close time in the close-workspace handler). Ctrl+Shift+T pops the newest and re-creates the workspace (re-spawn ptys with saved cwd). Optionally expose a History list in the UI. Pure JS + existing pty spawn.
- **Deps:** Close workspace (must snapshot on close); Workspace data model

### [todo/P1/S] Toggle left sidebar
- **Behavior:** Shows/hides the left sidebar that lists workspaces (with git branch, PR status, working dir, ports, latest notification). When hidden the grid expands to full width.
- **Shortcut/CLI:** Cmd+B (toggleSidebar)
- **cmux impl:** Menu 'Toggle Left Sidebar' (cmuxApp.swift:735) -> AppDelegate.toggleSidebarInActiveMainWindow, falling back to sidebarState.toggle(); per-window sidebar visibility state in the window context.
- **Windows approach:** The sidebar itself does not yet exist in Scanline. Once built as a DOM panel, toggle = CSS class/flex on the layout container, bound to Ctrl+B; re-run the grid resize so xterm panes refit (fit-addon). Persist visibility per window in session. Pure DOM/CSS.
- **Deps:** Left sidebar UI (todo, separate area)

### [todo/P2/S] Toggle right sidebar
- **Behavior:** Shows/hides the right sidebar, which hosts tabbed panels (Files, Find, Vault/Sessions, Feed, Dock). When toggled it reveals the last-selected panel.
- **Shortcut/CLI:** Alt+Cmd+B (toggleRightSidebar, raw key 'toggleFileExplorer')
- **cmux impl:** Menu 'Toggle Right Sidebar' (cmuxApp.swift:741) -> AppDelegate.toggleRightSidebarInActiveMainWindow; right-sidebar mode enum has Files/Find/Sessions/Feed/Dock (KeyboardShortcutSettings.swift:86-90).
- **Windows approach:** Same as left sidebar: a right DOM panel, toggle via CSS, bound to Alt+Ctrl+B, refit grid on toggle. The panel contents (files/find/feed) are separate features in other areas; here only the show/hide chrome + persistence.
- **Deps:** Right sidebar UI (todo, separate area)

### [todo/P3/S] Toggle right sidebar focus
- **Behavior:** Moves keyboard focus into the right sidebar (so arrow keys/typing act on it); pressing again returns focus to the previously focused main pane. Opens the sidebar if closed.
- **Shortcut/CLI:** Cmd+Shift+E (focusRightSidebar)
- **cmux impl:** Menu 'Toggle Right Sidebar Focus' (cmuxApp.swift:749) -> AppDelegate.toggleRightSidebarKeyboardFocusInActiveMainWindow / focusRightSidebarInActiveMainWindow; remembers prior main-panel focus to restore (restoreFocusedMainPanelFocusFromRightSidebar).
- **Windows approach:** Track lastFocusedPaneId in JS; Ctrl+Shift+E calls .focus() on the right sidebar's focusable element and stores the prior pane; pressing again calls term.focus() on the remembered pane. Needs focus bookkeeping but no native API.
- **Deps:** Right sidebar UI; toggle right sidebar; pane focus tracking

### [todo/P3/S] Switch right sidebar panel (Files/Find/Vault/Feed/Dock)
- **Behavior:** Directly selects which panel the right sidebar shows (Files=1, Find=2, Vault=3, Feed=4, Dock=5), opening the sidebar if needed.
- **Shortcut/CLI:** Ctrl+1 .. Ctrl+5 (switchRightSidebarTo*, marked non-public/internal)
- **cmux impl:** Actions switchRightSidebarToFiles/Find/Sessions/Feed/Dock with default Ctrl+1..5 (KeyboardShortcutSettings.swift:311-320); isPublicShortcutAction=false so not advertised in the main shortcut UI.
- **Windows approach:** Once the right sidebar with tabs exists, bind Ctrl+1..5 to set the active panel and ensure the sidebar is visible. The panels themselves belong to other areas; this is just the selector wiring.
- **Deps:** Right sidebar UI with multiple panels

### [todo/P3/S] Numbered-digit badges on workspace rows
- **Behavior:** Each sidebar workspace row shows the digit (1-9) that would jump to it, so users learn the Cmd+number shortcuts; the lowest digit mapping to a row is shown.
- **Shortcut/CLI:** (visual aid; same Cmd+1..9 shortcuts)
- **cmux impl:** WorkspaceShortcutMapper.digitForWorkspace (TerminalDirectoryOpenSupport.swift:781) computes the badge per row index, rendered in the sidebar workspace row.
- **Windows approach:** When the sidebar exists, render a small digit badge per row using digitForWorkspace (port the tiny mapper). Pure DOM. Low value until sidebar + jump shortcuts exist.
- **Deps:** Left sidebar UI; Jump to workspace 1-8

### [todo/P2/M] Per-window TabManager isolation (workspace ownership model)
- **Behavior:** Each window independently tracks which workspaces it contains and which is selected; workspaces never bleed across windows; focusing/closing/creating in one window does not affect another.
- **Shortcut/CLI:** (infrastructure; no shortcut)
- **cmux impl:** AppDelegate keeps mainWindowControllers[] and mainWindowContexts each holding a windowId + its own TabManager (AppDelegate.swift:1019, 749); tabManagerFor(windowId:) and contextForMainWindow resolve the right manager for every shortcut/menu action via activeTabManager.
- **Windows approach:** Foundational: model state as { windows: { [label]: { workspaces[], activeWorkspaceId, sidebarVisible } } } keyed by Tauri window label. Backend keeps pty/webview registries keyed by window label too, so exit-cleanup and routing target the correct window. Everything else in this area builds on this. Until multi-window is needed, a single implicit window keeps it simple.
- **Deps:** New window; Workspace data model

## surfaces-tabs

### [todo/P0/M] New surface (terminal tab in focused pane)
- **Behavior:** Creates a new terminal surface as a tab inside the currently focused pane and focuses it. The new surface appears in that pane's horizontal tab strip; the previous content stays as a separate tab. Inherits cwd/font/env from the last focused terminal.
- **Shortcut/CLI:** Cmd+T
- **cmux impl:** TabManager.newSurface() -> Workspace.newTerminalSurfaceInFocusedPane(focus:true) -> newTerminalSurface(inPane:) which adds a bonsplit Tab to the focused pane and registers a TerminalPanel (Workspace.swift:16156-16161, 8925-8934). clearSplitZoom() first.
- **Windows approach:** Add a per-pane tab model to layout.ts: each leaf holds an ordered list of surface ids + activeIndex instead of one pane. Render a horizontal tab strip (DOM) above each leaf. 'New surface' spawns a new ConPTY/xterm instance (existing pane.ts pty path) into the leaf, sets it active, hides siblings (display:none, do NOT destroy xterm). Inherit cwd via the pty's last reported dir. Wire Ctrl+T (or chosen accel) through xterm attachCustomKeyEventHandler like existing shortcuts.
- **Deps:** Per-pane surface/tab model in layout.ts (the core refactor enabling this whole area)

### [todo/P0/S] Next surface in focused pane
- **Behavior:** Cycles to the next surface tab within the focused pane (wraps around). Updates active tab highlight and shows that surface's terminal/browser.
- **Shortcut/CLI:** Cmd+Shift+] or Ctrl+Tab
- **cmux impl:** TabManager.selectNextSurface() -> Workspace.selectNextSurface() -> bonsplitController.selectNextTab() then applyTabSelection (Workspace.swift:16113-16120). Ctrl+Tab handled as legacy path in AppDelegate.swift:13097.
- **Windows approach:** layout.ts: advance activeIndex = (i+1) % surfaces.length on the focused leaf; swap visible xterm/webview, update tab-strip active class, refocus xterm. Bind Ctrl+Tab and Ctrl+Shift+] via xterm attachCustomKeyEventHandler (Ctrl+Tab is reliably interceptable in WebView2 since it is not a browser-reserved chrome key inside the embedded view).
- **Deps:** New surface / per-pane surface model

### [todo/P0/S] Previous surface in focused pane
- **Behavior:** Cycles to the previous surface tab within the focused pane (wraps around).
- **Shortcut/CLI:** Cmd+Shift+[ or Ctrl+Shift+Tab
- **cmux impl:** TabManager.selectPreviousSurface() -> Workspace.selectPreviousSurface() -> bonsplitController.selectPreviousTab() (Workspace.swift:16122-16130). Legacy Ctrl+Shift+Tab at AppDelegate.swift:13101.
- **Windows approach:** layout.ts: activeIndex = (i-1+n)%n on focused leaf. Same swap/refocus. Bind Ctrl+Shift+Tab and Ctrl+Shift+[ via attachCustomKeyEventHandler.
- **Deps:** New surface / per-pane surface model

### [todo/P1/S] Jump to surface by number 1-8
- **Behavior:** Jumps directly to the Nth surface tab in the focused pane (1-indexed). No-op if out of range.
- **Shortcut/CLI:** Ctrl+1 .. Ctrl+8
- **cmux impl:** AppDelegate.swift:12983-12990 maps the digit via .selectSurfaceByNumber -> TabManager.selectSurface(at: digit-1) -> Workspace.selectSurface(at:) bounds-checks tabs(inPane:) (Workspace.swift:16132-16142).
- **Windows approach:** layout.ts selectSurfaceAt(focusedLeaf, n): bounds-check surfaces list, set activeIndex, swap visible. Bind Ctrl+1..Ctrl+8 in the key handler; map digit->index-1.
- **Deps:** Next/prev surface

### [todo/P1/S] Jump to last surface
- **Behavior:** Jumps to the last surface tab in the focused pane.
- **Shortcut/CLI:** Ctrl+9
- **cmux impl:** AppDelegate.swift:12984 (digit==9) -> TabManager.selectLastSurface() -> Workspace.selectLastSurface() selects tabs(inPane:).last (Workspace.swift:16144-16154).
- **Windows approach:** layout.ts selectLastSurface(focusedLeaf): set activeIndex = surfaces.length-1. Bind Ctrl+9.
- **Deps:** Jump to surface by number

### [todo/P0/M] Close surface (with close-workspace-on-last-surface behavior)
- **Behavior:** Closes the focused surface tab. If it is the last surface in the only pane, by default this closes the entire workspace (configurable). Kills the underlying terminal process / discards the browser. May prompt confirmation if a process is running.
- **Shortcut/CLI:** Cmd+W
- **cmux impl:** AppDelegate.swift:12912 .closeTab -> TabManager.closeCurrentPanelWithConfirmation(); programmatic path TabManager.closeSurface(tabId,surfaceId) -> Workspace.closePanel + clears its notifications (TabManager.swift:9531-9540). Last-surface->close-workspace gated by LastSurfaceCloseShortcutSettings (default true, TabManager.swift:195-207).
- **Windows approach:** layout.ts closeSurface(): kill that surface's pty (existing exit-cleanup path) / destroy its WebView2 child, remove from leaf's surface list, activate neighbor. If last surface in last leaf and setting enabled, close the workspace (forwards to that future feature) else collapse leaf via existing close-focused logic. Reuse Ctrl+Shift+W or add Ctrl+W. Confirmation = simple Tauri dialog if pty child still alive.
- **Deps:** Per-pane surface model; close-on-last-surface needs the workspace concept

### [todo/P2/S] New surface with initial input
- **Behavior:** Programmatic variant: opens a new terminal surface and pre-types/pastes an initial input string (used by CLI/agent flows and custom commands).
- **Shortcut/CLI:** -
- **cmux impl:** TabManager.newSurface(initialInput:) -> Workspace.newTerminalSurfaceInFocusedPane(focus:true, initialInput:) which seeds the surface config initialInput (Workspace.swift:8931-8934, 16156-16161).
- **Windows approach:** Extend layout.ts newSurface to accept initialInput; after pty spawn, write the string to the pty (existing byte-accurate input path). Expose via control-server surface.create with an initialInput field.
- **Deps:** New surface

### [todo/P0/L] Per-pane horizontal tab strip (surfaces UI)
- **Behavior:** Each split pane shows a horizontal tab bar at the top listing its surfaces. Each tab shows the surface title/icon; clicking a tab activates it. Tab strip auto-hides or shows per config; includes built-in action buttons (new terminal, new browser, split right/down) on the right side.
- **Shortcut/CLI:** -
- **cmux impl:** Rendered by the bonsplit submodule per pane; BonsplitConfiguration.Appearance.tabBarHeight + chrome colors set in Workspace.swift:10827-10828, 10979. Built-in buttons mapped in CmuxSurfaceTabBarBuiltInAction.swift (newTerminal/newBrowser/splitRight/splitDown -> bonsplitAction). Hit-region registry in BonsplitTabBarPassThrough.swift.
- **Windows approach:** Build the tab strip in DOM/CSS per leaf (cmux's is native bonsplit; for Scanline it is pure HTML on top of the existing grid). Title comes from xterm OSC title (or last cmd); clickable tabs set activeIndex. Right-aligned icon buttons fire newSurface/newBrowserSurface/split. Auto-hide when a leaf has a single surface (config). This is the central UI artifact of the whole area.
- **Deps:** Per-pane surface model; browser pane (for new-browser button); split (already done)

### [todo/P1/S] Surface tab title (from terminal/browser)
- **Behavior:** Each surface tab displays a live title: terminal surfaces show the running program/OSC title or cwd; browser surfaces show the page title. Updates as the program/page changes.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyNotification surfaceId-keyed title updates -> enqueuePanelTitleUpdate(tabId,panelId,title) (TabManager.swift:1502-1526); panelTitles published per panel (Workspace.swift:10401). Browser title via panelSubscriptions.
- **Windows approach:** xterm onTitleChange (it parses OSC 0/2) -> update surface.title in layout.ts -> rerender that tab label. Browser surface: WebView2 DocumentTitleChanged event (add_DocumentTitleChanged via windows-rs) -> update label.
- **Deps:** Per-pane horizontal tab strip

### [todo/P2/M] Reorder surfaces within a pane (drag tabs)
- **Behavior:** User drags a surface tab left/right within the pane's tab strip to reorder it; active selection follows.
- **Shortcut/CLI:** -
- **cmux impl:** Workspace.reorderSurface(panelId:toIndex:focus:) (Workspace.swift:1531, 809, 15565) driven by bonsplit drag; socket exposes surface.reorder (CmuxSocketEventMapper.swift:63).
- **Windows approach:** HTML5 drag-and-drop (or pointer-drag) on tab elements; on drop, splice surface array to new index in layout.ts and rerender. No process movement needed (xterm/webview just stay mounted, order changes). Mirror to control-server surface.reorder.
- **Deps:** Per-pane horizontal tab strip

### [todo/P3/L] Move surface to adjacent/another pane (drag tab between panes)
- **Behavior:** User drags a surface tab into a different pane (or to an edge to create a split), moving the live terminal/browser with it. Supports drop at a specific index.
- **Shortcut/CLI:** -
- **cmux impl:** Workspace.moveSurface(panelId:toPane:atIndex:focus:) and moveSurfaceToAdjacentPane(direction:) (Workspace.swift:15538-15561). Socket surface.move -> surface.moved event (CmuxSocketEventMapper.swift:61).
- **Windows approach:** Drag tab element across leaves; on drop into another leaf, move the surface object (and reparent its WebView2 child / keep xterm DOM node) into the target leaf's surface list. For ConPTY no reparenting of the process is needed (just move the xterm DOM container). WebView2 child must be re-set as child of the target leaf host (with_webview / SetParent). Edge-drop creates a split via existing layout split.
- **Deps:** Reorder surfaces; tiling split (done); browser pane reparenting

### [todo/P3/L] Move surface/tab to NEW workspace (detach)
- **Behavior:** Detaches the focused surface (or a dragged tab) into a brand-new workspace, appearing as a new row in the sidebar.
- **Shortcut/CLI:** -
- **cmux impl:** moveSurfaceToNewWorkspace path (Workspace.swift:17264) + dedicated extension files (TabManager+DetachedWorkspace.swift, *+MoveTabToNewWorkspace.swift across Workspace/Browser/Terminal/ContentView). Command palette entry keywords move/tab/detach (ContentView+MoveTabToNewWorkspace.swift:14).
- **Windows approach:** Requires the workspace concept first. Create a new workspace (new sidebar row + new grid), move the surface object into its root leaf. ConPTY keeps running; just remount the xterm DOM/WebView2 under the new workspace's container.
- **Deps:** Vertical sidebar workspaces; move surface between panes

### [todo/P1/XL] Vertical tabs sidebar (workspace list)
- **Behavior:** A left sidebar lists all workspaces as vertical rows. Clicking a row switches to that workspace. The active row is highlighted; rows show title and rich metadata (see dependent features). Supports keyboard switching and a numeric shortcut hint badge.
- **Shortcut/CLI:** -
- **cmux impl:** VerticalTabsSidebar (ContentView.swift:2003, 10205) renders a LazyVStack of TabItemView rows (ContentView.swift:14461). Each row is Equatable for perf. SidebarState owns visibility + persisted width (Sidebar/SidebarState.swift).
- **Windows approach:** New left DOM column (flex layout beside #workspace). Maintain a workspaces[] model (id, title, grid/layout tree, metadata). Render rows; click -> swap the mounted grid (hide current workspace's panes, show target's). This is the foundational workspace container; tiling grid becomes per-workspace. Persisted width stored in a small JSON via Tauri fs/store.
- **Deps:** Introduces the whole multi-workspace concept (large refactor; grid becomes per-workspace)

### [todo/P1/S] Toggle sidebar visibility
- **Behavior:** Shows/hides the left vertical tabs sidebar. State persists across launches; width is drag-resizable.
- **Shortcut/CLI:** Cmd+B
- **cmux impl:** AppDelegate.swift:12680 .toggleSidebar -> toggleSidebarInActiveMainWindow (AppDelegate.swift:6126); SidebarState.toggle() flips isVisible; persistedWidth sanitized via SessionPersistencePolicy (Sidebar/SidebarState.swift:14).
- **Windows approach:** Toggle a CSS class hiding the sidebar column; bind a chosen accel (e.g. Ctrl+B) via attachCustomKeyEventHandler. Persist isVisible + width in localStorage or a Tauri store. Add a draggable gutter (reuse existing gutter-drag code from the tiling grid) for resize.
- **Deps:** Vertical tabs sidebar

### [todo/P1/M] Sidebar row: git branch + dirty indicator
- **Behavior:** Each workspace row shows its current git branch name with a dirty marker when there are uncommitted changes. Updates when HEAD/index changes. Toggleable + layout options (icon, vertical/stacked, last-segment path).
- **Shortcut/CLI:** -
- **cmux impl:** Per-panel SidebarGitBranchState{branch,isDirty} (Workspace.swift:9674-9677, 10431-10432). Probed via WorkspaceGitProbe with FS watcher on .git (TabManager.swift:1122-1426); runs git in the workspace cwd. Visibility/layout via SidebarTabItemSettingsSnapshot (ContentView.swift:9813-9837).
- **Windows approach:** Run git.exe in the workspace cwd from Rust (std::process / portable): 'git rev-parse --abbrev-ref HEAD' for branch, 'git status --porcelain' for dirty. Re-probe on a debounce timer + a ReadDirectoryChangesW watcher on .git (or notify crate). Emit per-workspace branch to the frontend via Tauri event; render in the row.
- **Deps:** Vertical tabs sidebar; per-workspace cwd tracking

### [todo/P2/L] Sidebar row: linked PR status + number (clickable)
- **Behavior:** If the branch has an associated GitHub PR, the row shows the PR number and a status pill (open/merged/closed). Polled periodically; stale PRs dimmed. Clickable to open the PR (in default browser or in-app browser per setting).
- **Shortcut/CLI:** -
- **cmux impl:** SidebarPullRequestState{number,label,url,status,branch,isStale} + SidebarPullRequestStatus enum (Workspace.swift:9722-9757). Resolves repo slugs from 'git remote -v' (githubRepositorySlugs, TabManager.swift:5211-5276), queries api.github.com/repos/{slug}/pulls (TabManager.swift:4729-4758), auth from GH_TOKEN/GITHUB_TOKEN env or 'gh auth token' (4760-4778). Polled via workspacePullRequestPollTimer (1578).
- **Windows approach:** From Rust: git.exe 'remote -v' -> parse owner/repo slugs (reuse cmux parsing logic). Call https://api.github.com/repos/{slug}/pulls?head=owner:branch via reqwest; Authorization from %GH_TOKEN%/%GITHUB_TOKEN% or 'gh.exe auth token'. Cache + poll on a tokio interval (respect rate limits). Render number+status pill; click -> open in default browser (Tauri shell open) or spawn an in-app browser pane.
- **Deps:** Sidebar git branch (needs branch+remote); in-app browser pane (for in-app open option)

### [todo/P1/M] Sidebar row: working directory
- **Behavior:** Each row shows the workspace's working directory (full path, abbreviated, or last segment only per setting), often combined/stacked with the branch.
- **Shortcut/CLI:** -
- **cmux impl:** Workspace.currentDirectory (Published, posts workspaceCurrentDirectoryDidChange, Workspace.swift:10270-10287); surfaceTabBarDirectory (10290). Path formatting in Sidebar/SidebarDirectoryText.swift + SidebarPathFormatter.swift; layout flags in settings snapshot (usesLastSegmentPath, stacksBranchAndDirectory, ContentView.swift:9816,9835-9836).
- **Windows approach:** Track per-workspace cwd from the focused surface's pty cwd (ConPTY can report via OSC 7 'file://host/path' which xterm exposes, or read the child process cwd via GetProcessId + NtQueryInformationProcess / a small helper). Store on the workspace model; render with path-shortening (~, last segment). Update on OSC 7 / surface focus change.
- **Deps:** Vertical tabs sidebar; cwd tracking (OSC 7)

### [todo/P2/L] Sidebar row: listening ports
- **Behavior:** Each row shows the TCP ports currently being LISTENed on by processes running in that workspace's terminals (e.g. dev servers). Updates as servers start/stop. Clickable to open localhost:PORT (default or in-app browser).
- **Shortcut/CLI:** -
- **cmux impl:** PortScanner.swift: registers each surface's TTY, coalesces 'ports_kick', bursts 'ps -t <ttys>' + 'lsof -nP -p <pids> -iTCP -sTCP:LISTEN', joins TTY->ports; also walks tracked-agent PID trees. Delivers to Workspace.listeningPorts / surfaceListeningPorts (Workspace.swift:10447, 530-534). Display text SidebarPortDisplayText.swift.
- **Windows approach:** No TTY model on Windows; key by process tree instead. From Rust call GetExtendedTcpTable (iphlpapi, MIB_TCPTABLE_OWNER_PID, filter state=LISTEN) to map port->owning PID. Walk the ConPTY child process tree (CreateToolhelp32Snapshot / Process32 ppid walk) rooted at each surface's shell PID to attribute ports to a workspace. Poll on a debounced burst (mirroring cmux coalesce). Render clickable port pills -> open http://localhost:PORT.
- **Deps:** Vertical tabs sidebar; per-surface child PID tracking; browser pane (for in-app open)

### [todo/P2/S] Sidebar row: latest notification text
- **Behavior:** Each row shows the text of the most recent (unread) notification from that workspace's agents as a subtitle, so you can see what each agent last said/needs without switching.
- **Shortcut/CLI:** -
- **cmux impl:** TabItemView.latestNotificationText fed from notificationStore.latestNotification(forTabId:) (ContentView.swift:11217, 11931, 14505; subtitle layout 14835-14841). Backed by TerminalNotificationStore (OSC 9/99/777 + 'cmux notify').
- **Windows approach:** Depends on the notifications subsystem (separate area, currently todo in Scanline). Once a notification store exists (OSC parsing via xterm onData/custom parser + control-server notify), expose latestNotification(workspaceId) and render as the row subtitle. UI side here is trivial; the data source is the dependency.
- **Deps:** Notification store / OSC parsing (separate area); vertical tabs sidebar

### [todo/P3/S] Sidebar row: numeric workspace shortcut hint badge
- **Behavior:** Rows for the first workspaces show a small badge indicating their Cmd+digit jump shortcut (shown on modifier hold or always per setting).
- **Shortcut/CLI:** -
- **cmux impl:** TabItemView.workspaceShortcutDigit + workspaceShortcutModifierSymbol + showsModifierShortcutHints (ContentView.swift:14500-14501,14510); frozen during context-menu via onContextMenuAppear. Defaults from ShortcutHintDebugSettings (9830-9832).
- **Windows approach:** Render a small badge per row for index<9 showing 'Ctrl+N'. Listen for Ctrl keydown/keyup globally to toggle hint visibility (or an 'always show' setting). Pure DOM/CSS.
- **Deps:** Vertical tabs sidebar; workspace jump shortcuts (workspaces area)

### [todo/P2/S] Sidebar row: active workspace indicator + unread badge
- **Behavior:** The selected workspace row is visually highlighted (configurable indicator style/color). Rows with unread agent notifications show a colored unread badge/count; a notification arrival lights up the row.
- **Shortcut/CLI:** -
- **cmux impl:** TabItemView.isActive, unreadCount, activeTabIndicatorStyle (SidebarActiveTabIndicatorStyle), selectionColorHex, notificationBadgeColorHex (ContentView.swift:14499,14475, settings 9823-9825,9880-9882). Unread derived from manualUnreadPanelIds + notification store.
- **Windows approach:** CSS active class for the selected row (configurable accent color from a settings store). Unread badge driven by the notification store's per-workspace unread count (dependency). Indicator style = a few CSS variants.
- **Deps:** Vertical tabs sidebar; notification store (for unread)

### [todo/P2/S] Sidebar resize (drag) + persisted width
- **Behavior:** Drag the sidebar's right edge to resize its width; the width is sanitized to min/max bounds and persisted across launches.
- **Shortcut/CLI:** -
- **cmux impl:** SidebarResizeInteraction defines hit zones/edges (Sidebar/SidebarState.swift:19-54); persistedWidth via SessionPersistencePolicy.sanitizedSidebarWidth (8-12).
- **Windows approach:** Reuse the existing gutter drag-resize code (already built for the tiling grid) on a vertical divider between sidebar and content. Clamp to min/max, persist width in localStorage/Tauri store.
- **Deps:** Vertical tabs sidebar

### [todo/P3/M] Sidebar multi-select workspaces (Shift/Cmd-click) + batch context menu
- **Behavior:** Shift-click selects a range of workspace rows; Cmd-click toggles individual rows. Right-click offers batch actions (pin, close, rename, group, scroll-bar toggle, etc.) across the selection. Keyboard nav collapses the multi-selection.
- **Shortcut/CLI:** -
- **cmux impl:** selectedTabIds binding + sidebarSelectedWorkspaceIds; clearSidebarMultiSelection on keyboard nav (TabManager.swift:8755-8765). Context menu snapshots in TabItemView (contextMenuWorkspaceIds, contextMenuPinState, workspaceGroupMenuSnapshot, ContentView.swift:14525-14531).
- **Windows approach:** Track a Set of selected workspace ids in JS; handle Shift/Ctrl-click range/toggle. Right-click -> custom DOM context menu (or Tauri menu) with batch actions iterating the selection. Collapse selection on keyboard switch.
- **Deps:** Vertical tabs sidebar

### [todo/P3/M] Reorder workspaces in sidebar (drag rows) + drop targets
- **Behavior:** Drag a workspace row to reorder it in the sidebar; drop indicators show insertion point. Supports dropping surfaces/tabs onto the sidebar to detach into a new workspace.
- **Shortcut/CLI:** -
- **cmux impl:** SidebarTabDropDelegate (ContentView.swift:16992), drag snapshot (isBeingDragged, topDropIndicatorVisible, tabDropDelegateFactory, ContentView.swift:14518-14524), drop planning in Sidebar/SidebarDropPlanner.swift, InternalTabDragConfiguration.swift, SidebarBonsplitTabWorkspaceDropOverlay.swift.
- **Windows approach:** HTML5 drag-and-drop on rows; show a top/bottom drop indicator; on drop splice the workspaces[] order. Accept surface-tab drops onto the sidebar to trigger move-to-new-workspace. Persist order.
- **Deps:** Vertical tabs sidebar; move surface to new workspace

### [todo/P3/L] Workspace groups (headers/anchors in sidebar)
- **Behavior:** Workspaces can be grouped under collapsible headers with custom color/icon; the group anchor's cwd drives group config; new workspaces can be placed into a group.
- **Shortcut/CLI:** -
- **cmux impl:** Workspace.groupId + workspaceGroups in TabManager; SidebarWorkspaceGroupHeaderView.swift, VerticalTabsSidebar+WorkspaceGroups.swift, TabItemView+WorkspaceGroups.swift, SidebarWorkspaceGroupContextMenuRunner/Dialogs/ConfigOpener. workspaceGroupMenuSnapshot (ContentView.swift:14531).
- **Windows approach:** Add optional groupId to the workspace model; render collapsible group header rows in the sidebar DOM with color/icon. Group config persisted; context menu to create/rename/recolor groups. Lower priority polish.
- **Deps:** Vertical tabs sidebar; reorder workspaces

### [todo/P2/S] Surface tab built-in action buttons (new terminal/browser, split)
- **Behavior:** The per-pane tab strip has right-aligned icon buttons to create a new terminal surface, a new browser surface, or split the pane right/down directly from the strip.
- **Shortcut/CLI:** -
- **cmux impl:** CmuxSurfaceTabBarBuiltInAction.swift maps newTerminal/newBrowser/splitRight/splitDown to BonsplitConfiguration.SplitActionButton.Action; tooltips refreshed via refreshSplitButtonTooltips (TabManager.swift:8974). Custom buttons via cmux.json (applySurfaceTabBarButtons, TabManager.swift:8986).
- **Windows approach:** Add icon buttons to the DOM tab strip; wire to layout.ts newSurface / newBrowserSurface / split (split already implemented). Tooltips via title attr. Custom buttons defer to the cmux.json feature (separate area).
- **Deps:** Per-pane horizontal tab strip; browser pane (done); split (done)

### [partial/P1/M] Control-server / CLI surface commands (scriptable)
- **Behavior:** Surfaces are scriptable: create, split, reorder, move, send input/keys, fire actions. Used by the CLI, agents, and custom commands; emits surface.* events.
- **Shortcut/CLI:** scanline surface ... (CLI) / surface.* (socket)
- **cmux impl:** Socket methods surface.create/split/move/reorder/action/input/key mapped in CmuxSocketEventMapper.swift:52-69; events surface.created etc. in CmuxEventPublishing.swift:185-248. CLI threads CMUX_SURFACE_ID (cmux.swift:128,202).
- **Windows approach:** Scanline already has a named-pipe control server with pane.split/new/close/focus and a Go CLI. Extend the JSON protocol with surface.new/select/next/prev/close/reorder/move and map to layout.ts ops; add SCANLINE_SURFACE_ID env on surface spawn. Send-input/send-keys are separate (noted as not-done in Scanline state).
- **Deps:** Per-pane surface model; existing named-pipe control server (done)

## splits-panes

### [done/P0/S] Split Right (vertical divider, new pane to the right)
- **Behavior:** Splits the focused pane with a vertical divider, placing a new terminal surface to the right of the current one and focusing it. Two terminals side by side.
- **Shortcut/CLI:** Cmd+D (cmux). Scanline: Alt+Shift+Right; also Alt+Shift+D auto-direction; CLI `scanline split` / tmux-shim split-window -h
- **cmux impl:** AppDelegate.swift ~13052 matchConfiguredShortcut(.splitRight) -> performSplitShortcut(direction:.right). Workspace.swift ~14269 bonsplitController.splitPane(paneId, orientation:"horizontal", withTab:newTab, insertFirst:false). SplitDirection.right maps to horizontal orientation + insertFirst=false.
- **Windows approach:** Already implemented: layout.ts binary split tree inserts a right child div with flex-basis ratio; new xterm.js pane gets a fresh portable-pty/ConPTY. Keep current model; just align default shortcut to match cmux's Cmd+D semantics if desired (Win has no Cmd, so Alt+Shift+Right / Alt+Shift+D is the natural mapping).

### [done/P0/S] Split Down (horizontal divider, new pane below)
- **Behavior:** Splits the focused pane with a horizontal divider, placing a new terminal surface below the current one and focusing it. Two terminals stacked.
- **Shortcut/CLI:** Cmd+Shift+D (cmux). Scanline: Alt+Shift+Down; CLI `scanline split` / tmux-shim split-window -v
- **cmux impl:** AppDelegate.swift ~13066 matchConfiguredShortcut(.splitDown). Workspace.swift bonsplitController.splitPane(..., orientation:"vertical", insertFirst:false). SplitDirection.down -> vertical orientation.
- **Windows approach:** Already implemented in layout.ts (dir:"vertical"/horizontal split node). Same flex-basis tree, new ConPTY pane below.
- **Deps:** Split Right (shared split-tree code)

### [done/P0/S] Directional pane focus (geometric neighbor navigation)
- **Behavior:** Moves keyboard focus to the nearest adjacent pane in the chosen direction (left/right/up/down) based on screen geometry, not tree position. Blurs old pane, focuses new pane terminal/browser.
- **Shortcut/CLI:** Opt+Cmd+Left/Right/Up/Down (cmux); also Ghostty goto_split compat. Scanline: Alt+Arrow keys
- **cmux impl:** AppDelegate.swift ~13000-13050 matchDirectionalShortcut(.focusLeft/Right/Up/Down) -> TabManager.movePaneFocus(direction:) -> Workspace.moveFocus (Workspace.swift 16091) -> bonsplitController.navigateFocus(direction:), then applyTabSelection on the new focusedPaneId. bonsplit picks the geometric neighbor.
- **Windows approach:** Already implemented: layout.ts focusDir() (line 117) does center-point distance scoring (perpendicular axis weighted x2) over collectPanes — functionally equivalent to bonsplit navigateFocus. Works for terminal + browser leaves. No change needed; optionally refine tie-breaking to prefer overlap on the shared edge like tiling WMs.

### [todo/P1/S] Flash focused panel (visual focus confirmation ring)
- **Behavior:** Briefly draws an animated colored ring (stroke + glow) around the currently focused pane so the user can visually locate which pane has focus across many splits. Same ring style is reused for notification attention.
- **Shortcut/CLI:** Cmd+Shift+H (cmux). Scanline: none yet
- **cmux impl:** AppDelegate.swift ~12790 matchConfiguredShortcut(.triggerFlash) -> TabManager.triggerFocusFlash() (TabManager.swift 9961) -> Workspace.triggerFocusFlash(panelId:) -> requestAttentionFlash (Workspace.swift 11650) -> panel.triggerFlash(reason:.navigation). Renders WorkspaceAttentionFlashRingView (SwiftUI): RoundedRectangle.stroke with animated opacity + shadow glow, gated by WorkspaceAttentionCoordinator.decideFlash. allowsHitTesting(false).
- **Windows approach:** Pure DOM/CSS overlay: add an absolutely-positioned sibling div with class .focus-flash-ring over the focused pane.el, animate box-shadow + outline opacity via a one-shot CSS keyframe (~600ms) then remove. No native code. Wire a new global key handler in main.ts and add a control-server verb (e.g. pane.flash) for CLI parity. Same ring class becomes the basis for the future notification-attention ring.
- **Deps:** Directional focus / focus tracking (already present)

### [todo/P1/M] Toggle split zoom (temporarily maximize focused pane)
- **Behavior:** Toggles the focused pane to fill the whole workspace (hiding sibling panes) and back, without changing the underlying split layout. Used to read one terminal full-screen then restore. Available via keyboard and the tab context menu.
- **Shortcut/CLI:** Cmd+Shift+Return (cmux); also tab context menu 'Toggle Zoom'. Scanline: none yet
- **cmux impl:** AppDelegate.swift ~13042 matchConfiguredShortcut(.toggleSplitZoom) -> TabManager.toggleFocusedSplitZoom (TabManager.swift 9462) -> Workspace.toggleSplitZoom(panelId:) (Workspace.swift 16169) -> bonsplitController.togglePaneZoom(inPane:) / clearPaneZoom() / isSplitZoomed flag. Then reconciles terminal+browser portal visibility for the zoomed layout. Context-menu binding built in buildContextMenuShortcuts (.toggleZoom).
- **Windows approach:** Add a `zoomed` leaf-id flag on the Layout. When set, render() shows only that pane.el at flex:1 1 100% (or display:none on others) and skips split/gutter chrome; on toggle off, re-render the unchanged binary split tree. Call refit()/fit addon on affected xterm panes and resize ConPTY (existing path) after the size change. For browser leaves, resize/reposition the WebView2 child to the zoomed rect via the existing set-bounds command. Add Alt+Shift+Enter handler + control-server pane.zoom verb.
- **Deps:** Split tree render path; ConPTY resize; WebView2 child bounds update

### [todo/P2/S] Equalize splits (reset all dividers to equal proportions)
- **Behavior:** Resets every split divider so sibling panes get equal share of their axis, weighting by how many leaf panes are under each side (so a 1-vs-2 split lands at 1/3 : 2/3). Restores a balanced layout after manual dragging.
- **Shortcut/CLI:** Ctrl+Cmd+= (cmux). Scanline: none yet (Scanline already auto-rebalances on close but has no explicit equalize-all command)
- **cmux impl:** AppDelegate+EqualizeSplitsShortcut.swift performEqualizeSplitsShortcut -> TabManager.equalizeSplits (TabManager+EqualizeSplits.swift) -> SplitEqualizer.equalize (SplitEqualizer.swift): recursively walks ExternalTreeNode, for each split computes firstSpanCount/totalSpanCount via spanCount() and calls bonsplitController.setDividerPosition(position, forSplit:, fromExternal:true). Then didProgrammaticallyChangeSplitGeometry.
- **Windows approach:** Add Layout.equalize(): recurse the binary tree, for each split node set ratio = spanCount(a)/(spanCount(a)+spanCount(b)) where spanCount counts leaves under same-orientation chains (port SplitEqualizer.spanCount 1:1). Re-render and refitAll(). Pure TS in layout.ts, no native code. Bind a key (e.g. Alt+Shift+=) and a control-server verb pane.equalize.
- **Deps:** Split tree (ratio model already exists)

### [done/P0/S] Interactive divider drag-resize (gutter)
- **Behavior:** User drags the divider between two panes to change their relative sizes; terminals reflow/refit live as the gutter moves.
- **Shortcut/CLI:** Mouse drag on divider (no keyboard binding). Scanline: gutter drag already implemented
- **cmux impl:** Handled inside bonsplit (BonsplitController divider hit-testing + setDividerPosition). cmux call sites: setDividerPosition(_:forSplit:fromExternal:) used by SplitEqualizer and resize support. Live drag is internal to the bonsplit vendor lib (not checked out).
- **Windows approach:** Already implemented: layout.ts renders a .gutter div between split children; pointer drag updates node.ratio and re-renders, with refitAll() on rAF. Keep; ensure ConPTY resize + xterm fit fire on drag-end (and ideally throttled during drag) for both terminal and browser leaves.
- **Deps:** Split tree

### [todo/P2/M] Programmatic / absolute pane resize (scriptable)
- **Behavior:** A script or agent sets a pane to an absolute pixel size (or nudges a divider by a delta) on a given axis; the divider moves and panes reflow. Powers CLI/socket-driven layout automation and tmux resize-pane compat.
- **Shortcut/CLI:** No keyboard binding; CLI/socket only (e.g. tmux-compat resize-pane). Scanline: none yet
- **cmux impl:** TerminalControllerPaneResizeSupport.swift: v2PaneResizeCollectCandidates walks ExternalTreeNode to find the split controlling the target pane's edge, computes target fraction from targetPixels/axisPixels, clamps to 0.1..0.9, then bonsplitController.setDividerPosition(clamped, forSplit:, fromExternal:true). V2PaneResizeDirection maps left/right->horizontal, up/down->vertical, with dividerDeltaSign for relative nudges.
- **Windows approach:** Add a control-server verb pane.resize {paneId, axis|dir, pixels|delta}. In layout.ts find the ancestor split node whose orientation matches the axis and whose subtree contains the target leaf, then set ratio = pixels/axisPx (clamp 0.1..0.9) mirroring v2SetAbsolutePaneSize; for delta, adjust ratio by delta/axisPx. Re-render + refit. Needed for tmux resize-pane shim parity. Pure TS.
- **Deps:** Control server; tmux-compat shim; split tree

### [done/P0/S] Rebalance-on-close (sibling reclaims space after closing a pane)
- **Behavior:** When the focused pane is closed, its sibling subtree promotes up to reclaim the space and the layout collapses cleanly rather than leaving a gap; focus moves to the next leaf.
- **Shortcut/CLI:** Ctrl+Shift+W (Scanline close focused). cmux closes via Cmd+W (close surface) collapsing the split.
- **cmux impl:** In cmux, closing a surface collapses its bonsplit pane and the sibling subtree promotes up (bonsplit internal); focus reconciles to a neighbor. Not a distinct shortcut — emergent from pane close + bonsplit tree collapse.
- **Windows approach:** Already implemented in layout.ts closePane/closeFocused (line 106): removes the leaf, promotes the sibling subtree, re-renders, and setFocus to firstLeaf of the sibling. Matches cmux collapse behavior. No change needed.
- **Deps:** Split tree

### [partial/P1/S] Split a browser pane (in focused-pane orientation)
- **Behavior:** Opens an in-app browser pane as a split (to the right or below the focused pane) rather than a terminal, so a browser sits next to the terminal in the tiling grid.
- **Shortcut/CLI:** Opt+Cmd+D split browser right, Opt+Cmd+Shift+D split browser down (cmux); also Cmd+Shift+L open browser in split. Scanline: Alt+Shift+B opens a browser pane in a split
- **cmux impl:** KeyboardShortcutSettings .splitBrowserRight (Opt+Cmd+D) / .splitBrowserDown (Opt+Cmd+Shift+D); openBrowser is Cmd+Shift+L. Reuses the same bonsplit splitPane path but creates a BrowserPanel surface instead of a TerminalPanel.
- **Windows approach:** Scanline already opens a WebView2 browser leaf via Alt+Shift+B and the browser.open control verb, but lacks explicit right-vs-down browser-split variants tied to the focused pane's chosen orientation. Add two bindings/verbs (browser.split dir) that reuse the existing split-tree insert + native WebView2 child creation on the main thread, parameterized by orientation. Mostly TS wiring over the existing browser pane.
- **Deps:** Browser pane (WebView2 child); split tree

## terminal

### [todo/P0/S] Clear scrollback / clear screen
- **Behavior:** Wipes the visible screen and all scrollback history of the focused terminal in one keystroke, leaving a clean prompt. Also invokable programmatically by scripts/agents.
- **Shortcut/CLI:** Cmd+K (Scanline: Ctrl+Shift+K); control method clear_screen
- **cmux impl:** Ghostty binding action 'clear_screen' fired by libghostty keybinding; also exposed as a socket/control op in TerminalController.swift:9940 via terminalPanel.performBindingAction("clear_screen"). Rendering owned by GhosttyKit.
- **Windows approach:** xterm.js: term.clear() clears scrollback above the prompt; for a true wipe call term.reset() or write the ConPTY clear sequence. Wire a new control method 'pane.clear' in main.ts control listener + add Ctrl+Shift+K to layout.setKeyHandler in pane.ts. No Rust change needed (pure xterm API).
- **Deps:** existing pane keyHandler + control server

### [todo/P0/S] Copy selection to clipboard
- **Behavior:** With a mouse/keyboard text selection in the terminal, Cmd+C copies the selected text to the system clipboard (does NOT send SIGINT when there is a selection; falls through to Ctrl+C-equivalent when there is none).
- **Shortcut/CLI:** Cmd+C (Scanline likely Ctrl+Shift+C to avoid clobbering shell Ctrl+C)
- **cmux impl:** copy(_:) IBAction -> performBindingAction("copy_to_clipboard") in GhosttyTerminalView.swift:8415; selection lives in libghostty surface; validateUserInterfaceItem gates the menu item on has_selection.
- **Windows approach:** xterm.js exposes term.getSelection()/hasSelection(); on Ctrl+Shift+C (or Ctrl+C when term.hasSelection()) write via navigator.clipboard.writeText or Tauri clipboard plugin. Add to attachCustomKeyEventHandler path in pane.ts so it intercepts before pty. WebView2 clipboard works through the DOM.
- **Deps:** existing pane keyHandler

### [todo/P0/S] Paste from clipboard
- **Behavior:** Cmd+V inserts clipboard text into the terminal at the cursor; honors the shell's bracketed-paste mode so editors/REPLs receive it as a paste, not as typed keystrokes.
- **Shortcut/CLI:** Cmd+V (Scanline: Ctrl+Shift+V)
- **cmux impl:** paste(_:) IBAction -> prepareSurfaceForPaste(...) then performBindingAction("paste_from_clipboard") (GhosttyTerminalView.swift:8452). libghostty wraps text in ESC[200~ / ESC[201~ when the app set DECSET 2004.
- **Windows approach:** Read clipboard via navigator.clipboard.readText() (or Tauri clipboard plugin), then feed to the pty. xterm.js tracks bracketed-paste mode; the cleanest path is term.paste(text) which auto-wraps with ESC[200~/201~ when the app enabled it, then route the resulting onData bytes to pty_write. Bind Ctrl+Shift+V.
- **Deps:** existing pty_write + pane keyHandler

### [todo/P2/M] Paste as plain text (rich-text fidelity stripping)
- **Behavior:** Pasting from a source with rich formatting (HTML/RTF) strips styling and pastes the highest-fidelity plain-text version, avoiding mojibake/replacement chars; a dedicated 'paste as plain text' command forces plain text.
- **Shortcut/CLI:** Edit menu 'Paste as Plain Text' (no default key) / pasteAsPlainText(_:)
- **cmux impl:** pasteAsPlainText(_:) at GhosttyTerminalView.swift:8459; GhosttyPasteboardHelper.stringContents picks plain vs rich using CMUXPasteboardFidelity.PasteboardTextFidelity.shouldPreferPlainText / shouldPreferRichText (counts nonASCII, U+FFFD, '?' substitutions) and htmlHasNoVisibleText to ignore empty HTML wrappers.
- **Windows approach:** WebView2 DataTransfer / Clipboard API can expose both text/plain and text/html. Port PasteboardTextFidelity logic verbatim to a TS module (pure string scan over code points: 0xFFFD, >0x7F, 0x3F). On paste read both flavors, choose the better one, fall back to text/plain. The fidelity package is MIT-clean algorithmic code, trivial to reimplement.
- **Deps:** Paste from clipboard

### [todo/P2/S] Copy on selection (copy-on-select)
- **Behavior:** Optional setting: as soon as you finish a mouse selection in the terminal, it is auto-copied to the clipboard (or the X11-style selection clipboard). Toggle in Settings > Terminal.
- **Shortcut/CLI:** Settings > Terminal > 'Copy on Selection' (no key)
- **cmux impl:** TerminalCopyOnSelectSettings (Sources/App/WorkspaceRuntimeSettings.swift:148) emits ghostty 'copy-on-select = clipboard|false'; settings entry in SettingsNavigation.swift:343. libghostty performs the auto-copy.
- **Windows approach:** xterm.js term.onSelectionChange -> if enabled and term.hasSelection(), write term.getSelection() to clipboard. Store the toggle in a settings file/localStorage until a settings UI exists. No native dependency.
- **Deps:** Copy selection to clipboard; settings store (none yet)

### [todo/P1/S] Increase / decrease font size
- **Behavior:** Cmd+ + and Cmd+ - step the focused terminal's font size up/down, reflowing the grid; size is inherited by new splits/panes created from that terminal.
- **Shortcut/CLI:** Cmd+ + / Cmd+ - (Scanline: Ctrl+ + / Ctrl+ -)
- **cmux impl:** libghostty bindings increase_font_size / decrease_font_size; cmux re-applies inherited points via performBindingAction("set_font_size:%.3f") on surface create (GhosttyTerminalView.swift:6507) so zoom carries to splits.
- **Windows approach:** xterm.js: term.options.fontSize = n then fit.fit() + pty_resize. Maintain per-Pane fontSize field in pane.ts; bind Ctrl+= / Ctrl+- in keyHandler. Inherit by passing the source pane's fontSize into the Pane constructor in layout.splitFocused/splitWithNew.
- **Deps:** existing FitAddon + pty_resize

### [todo/P1/S] Reset font size
- **Behavior:** Cmd+0 returns the focused terminal to the configured default font size and reflows.
- **Shortcut/CLI:** Cmd+0 (Scanline: Ctrl+0)
- **cmux impl:** libghostty reset_font_size binding; default comes from GhosttyConfig.fontSize (default 12).
- **Windows approach:** Set term.options.fontSize back to the app default (currently hardcoded 14 in pane.ts THEME/ctor), fit + pty_resize. Bind Ctrl+0.
- **Deps:** Increase/decrease font size

### [partial/P1/S] Scrollback buffer (history) with configurable limit
- **Behavior:** Terminal retains a large history you can scroll back through with the mouse wheel / scrollbar; cmux defaults to a 10MB (bytes) scrollback limit read from Ghostty config.
- **Shortcut/CLI:** Mouse wheel / trackpad; (no key for limit)
- **cmux impl:** GhosttyConfig.scrollbackLimit = 10_000_000 bytes (GhosttyConfig.swift:23), consumed by libghostty's terminal buffer.
- **Windows approach:** xterm.js Terminal({ scrollback: N }) — line-based, default 1000 is too small. Raise to e.g. 100000 lines in pane.ts ctor. Make it a config value later. Mouse-wheel scroll already works in xterm. Note xterm measures lines not bytes, so pick a generous line count.
- **Deps:** none

### [partial/P3/S] Terminal scrollbar visibility toggle
- **Behavior:** A scroll position indicator appears on the terminal; user can show/hide it via Settings. Reflects buffer position and updates on scroll.
- **Shortcut/CLI:** Settings > Terminal > 'Show Terminal Scroll Bar' (no key)
- **cmux impl:** GHOSTTY_ACTION_SCROLLBAR action delivers a GhosttyScrollbar struct (GhosttyTerminalView.swift:4546); cmux draws overlay; toggle setting terminal.showScrollBar (SettingsNavigation.swift:342).
- **Windows approach:** xterm.js renders its own scrollbar in the viewport by default (already visible in Scanline). To toggle, style ::-webkit-scrollbar on the xterm viewport via CSS class. Lower priority cosmetic.
- **Deps:** settings store (none yet)

### [todo/P3/L] Keyboard copy mode (vim-style scroll/select)
- **Behavior:** Enter a modal copy mode where hjkl move a selection, v starts visual select, gg/G jump top/bottom, {/} jump between shell prompts, / searches, y copies and exits — all without the mouse. A numeric count prefix repeats motions.
- **Shortcut/CLI:** toggleKeyboardCopyMode() (bound via Ghostty keybind, e.g. a chord); motions h/j/k/l, v, y, gg, G, {, }, /
- **cmux impl:** Self-implemented over libghostty selection APIs: terminalKeyboardCopyModeResolve / terminalKeyboardCopyModeAction (GhosttyTerminalView.swift:1496-1606), handleKeyboardCopyModeIfNeeded (8334) drives ghostty bindings adjust_selection / scroll_page_lines / jump_to_prompt / start_search / navigate_search and copy_to_clipboard.
- **Windows approach:** Build a JS modal layer in pane.ts: intercept keys in attachCustomKeyEventHandler while in copy mode, drive xterm's selection API (term.select(col,row,len), term.selectLines), term.scrollLines/scrollToTop/scrollToBottom, and the search addon for /. jump_to_prompt needs OSC 133 shell-integration marks (xterm has no native prompt marks — would need a marker registry on OSC 133). Substantial bespoke work.
- **Deps:** Copy selection; Find in terminal; OSC 133 prompt marks (none yet)

### [todo/P1/M] Per-pane current working directory (OSC 7)
- **Behavior:** As the shell cd's, the terminal reports its CWD; cmux shows it per-pane/tab in the sidebar and uses it as the base dir for new splits/workspaces.
- **Shortcut/CLI:** n/a (automatic OSC 7 sequence)
- **cmux impl:** GHOSTTY_ACTION_PWD (GhosttyTerminalView.swift:4618) -> tabManager.updateSurfaceDirectory(tabId, surfaceId, directory). libghostty parses OSC 7.
- **Windows approach:** xterm.js can parse OSC 7 via term.parser.registerOscHandler(7, cb) (cb gets the file:// URI; strip to a path). Store per-pane cwd in Pane; emit to UI (sidebar later) and use as cwd when spawning sibling panes. New splits should pass cwd into Pane/pty_spawn. PowerShell needs a prompt hook to emit OSC 7; bash/zsh under WSL/git-bash emit it natively.
- **Deps:** sidebar metadata (todo); pty_spawn cwd param

### [partial/P2/M] OSC 8 hyperlinks (explicit) + clickable plain URLs
- **Behavior:** Text the shell marks as a hyperlink via OSC 8 is clickable; bare URLs in output are also detected and clickable. Clicking opens the URL (or, if it resolves to a local file, an in-app file viewer).
- **Shortcut/CLI:** Click (Cmd+click on plain URLs in some terminals)
- **cmux impl:** GHOSTTY_ACTION_OPEN_URL (GhosttyTerminalView.swift:4744): decodes the URL, tries local-file resolution first (cmuxResolveQuicklookPath) to route to the file viewer, else opens browser. libghostty does OSC 8 parsing + URL hover detection.
- **Windows approach:** Plain-URL detection already present via @xterm/addon-web-links (opens in default browser). For OSC 8 explicit links use term.registerLinkProvider or term.parser.registerOscHandler(8, ...) to capture URI ranges and make them clickable. Route clicks to: Tauri opener plugin (already a dep) for web, or a Scanline browser pane (layout.splitFocused(new BrowserPane(url))). Local-file routing needs a file viewer (not built).
- **Deps:** browser pane (done); file viewer (todo)

### [todo/P2/S] Window/tab title from terminal (OSC 0/2)
- **Behavior:** Shell/programs that set the terminal title (OSC 0/2) update the pane's title, surfaced in the tab/sidebar.
- **Shortcut/CLI:** n/a (automatic OSC 0/2)
- **cmux impl:** GHOSTTY_ACTION_SET_TITLE (GhosttyTerminalView.swift:4600) posts .ghosttyDidSetTitle with the title for the tab/surface.
- **Windows approach:** xterm.js fires term.onTitleChange(cb) for OSC 0/2 automatically. Store per-pane title; show in a tab/sidebar (not built yet). Trivial listener; surfacing it needs tab/sidebar UI.
- **Deps:** tabs/sidebar UI (todo)

### [todo/P2/M] Dynamic terminal colors (OSC 4/10/11/12) + theme background sync
- **Behavior:** Programs can change foreground/background/cursor/palette colors at runtime (e.g. vim themes, neofetch); the terminal and even the pane/window background follow the OSC color change.
- **Shortcut/CLI:** n/a (automatic OSC 4/10/11/12)
- **cmux impl:** GHOSTTY_ACTION_COLOR_CHANGE (GhosttyTerminalView.swift:4655) updates surface/window background on OSC 11; color(from:) maps the change; GhosttyConfig parses static palette 0-15.
- **Windows approach:** xterm.js: term.parser.registerOscHandler(11, cb) (and 10/12/4) to update term.options.theme.{background,foreground,cursor} and the ANSI palette at runtime; optionally tint the pane DOM background. xterm applies theme changes live. Straightforward via OSC handlers.
- **Deps:** theming (todo)

### [todo/P2/M] Ghostty config reading: fonts, colors, theme, palette
- **Behavior:** On launch cmux reads ~/.config/ghostty/config (and app-support variants) for font-family, font-size, theme name, background/foreground/cursor/selection colors, 16-color palette, scrollback-limit, opacity/blur — so the terminal matches the user's existing Ghostty setup.
- **Shortcut/CLI:** Cmd+Shift+, reloads configuration
- **cmux impl:** GhosttyConfig.loadFromDisk (GhosttyConfig.swift:183) reads the config path list, parses directives (fontFamily/fontSize/theme/selection-background/etc.), resolves theme names to colors; libghostty consumes the same file for ligatures/font-features/cursor-style.
- **Windows approach:** Read a config file in Rust (Tauri) or TS and apply to xterm: map font-family -> term.options.fontFamily, font-size -> fontSize, background/foreground/cursor + palette -> term.options.theme. Use a Scanline-native config (e.g. scanline.toml) rather than reading Ghostty's (no Ghostty on Windows). Theme name resolution would need a bundled theme table. Medium effort to define schema + apply.
- **Deps:** settings/config store (todo)

### [todo/P3/M] Ligatures and font features (coding ligatures)
- **Behavior:** Programming ligatures (e.g. => != ===) render as combined glyphs when the font supports them, per Ghostty config.
- **Shortcut/CLI:** n/a (config-driven)
- **cmux impl:** Handled internally by libghostty's GPU text renderer using font-feature config directives; no cmux-side code beyond passing config through.
- **Windows approach:** xterm.js DOM renderer does NOT shape ligatures by default. @xterm/addon-ligatures enables them (requires the canvas/WebGL renderer ideally; with the DOM renderer support is limited/heavier). Since Scanline reverted WebGL (hangs WebView2), ligatures on the DOM renderer are constrained — load addon-ligatures and test, or accept no ligatures. Risk: perf on DOM renderer.
- **Deps:** renderer choice (DOM today; WebGL reverted)

### [todo/P3/L] Kitty graphics protocol (inline images)
- **Behavior:** Programs that emit Kitty graphics escape codes (e.g. image preview tools, plots) render actual images inline in the terminal.
- **Shortcut/CLI:** n/a (automatic escape sequences)
- **cmux impl:** Implemented inside libghostty's renderer; cmux passes the bytes through. No cmux-level Swift code.
- **Windows approach:** xterm.js has NO built-in Kitty graphics support. @xterm/addon-image adds Sixel and iTerm/Kitty image protocols (works best with the WebGL renderer; DOM-renderer support is partial). Given WebGL is reverted, this is risky/low-value on Windows. Defer.
- **Deps:** renderer choice; addon-image

### [partial/P1/S] Child-exited auto-close (no 'press any key' prompt)
- **Behavior:** When the shell/process in a pane exits, the pane closes immediately instead of leaving a dead terminal or a 'Process exited, press any key' prompt; closing the last pane behaves sanely.
- **Shortcut/CLI:** n/a (automatic on process exit)
- **cmux impl:** GHOSTTY_ACTION_SHOW_CHILD_EXITED (GhosttyTerminalView.swift:4434) -> closePanelAfterChildExited; cmux returns handled so Ghostty skips the fallback prompt.
- **Windows approach:** Scanline already listens to pty://id/exit and writes '[process exited]' then calls onExit (pane.ts:98). To match cmux, change onExit to auto-close the leaf via layout (close-on-exit) instead of leaving the dead message — small policy change in main.ts/layout. Optionally make it configurable.
- **Deps:** existing pty exit event + layout.closeFocused

### [todo/P2/S] Terminal bell (BEL / OSC 9 ring) handling
- **Behavior:** When a program emits the bell (BEL) or a Ghostty ring-bell action, cmux flashes/rings the pane (and feeds the notification ring system) rather than beeping audibly.
- **Shortcut/CLI:** n/a (automatic BEL)
- **cmux impl:** GHOSTTY_ACTION_RING_BELL (GhosttyTerminalView.swift:4496) -> ringBell(); integrates with notification rings.
- **Windows approach:** xterm.js fires term.onBell(cb). Hook it to a visual pane flash (toggle a CSS class) and/or the notification subsystem (not built). Audio bell off by default. Visual flash is trivial; the ring/notification panel is out of this area.
- **Deps:** notification rings (todo, other area)

### [todo/P2/S] Select all in terminal
- **Behavior:** A command selects the entire scrollback+viewport contents for copying.
- **Shortcut/CLI:** Cmd+A (where not consumed by shell) / select all
- **cmux impl:** Selection driven through libghostty surface selection APIs; menu/edit select-all routes to the surface (selectAll handling in ShortcutRoutingSupport.swift / ContentView.swift).
- **Windows approach:** xterm.js term.selectAll(). Bind to a Scanline shortcut (avoid plain Ctrl+A which is shell line-start). Pair with copy. Trivial.
- **Deps:** Copy selection to clipboard

### [todo/P3/M] Scroll commands (page up/down, top/bottom, scroll-to-prompt)
- **Behavior:** Keyboard/programmatic scrolling of the terminal viewport: page up/down, half-page, jump to top/bottom, and jump between shell prompts (OSC 133 marks).
- **Shortcut/CLI:** Used inside copy mode and via bindings (scroll_page_up/down, scroll_to_top/bottom, jump_to_prompt)
- **cmux impl:** libghostty bindings scroll_page_lines / scroll_page_up|down / scroll_page_fractional / scroll_to_top|bottom / jump_to_prompt, invoked from copy-mode handler (GhosttyTerminalView.swift:8380-8398).
- **Windows approach:** xterm.js: term.scrollLines(n), term.scrollPages(n), term.scrollToTop(), term.scrollToBottom(). jump_to_prompt requires recording OSC 133 prompt-start marks (register an OSC 133 handler, store line numbers, scroll to them). Page/top/bottom are trivial; prompt-jump needs OSC 133 plumbing.
- **Deps:** OSC 133 prompt marks (none yet)

### [todo/P3/S] Reload terminal configuration live
- **Behavior:** Cmd+Shift+, re-reads config (theme/font/colors) and applies it to running terminals without restart.
- **Shortcut/CLI:** Cmd+Shift+, (Reload configuration)
- **cmux impl:** GHOSTTY_ACTION_RELOAD_CONFIG / CONFIG_CHANGE (GhosttyTerminalView.swift:4710, 4678) re-resolve GhosttyConfig and reapply per-surface theme/background.
- **Windows approach:** Once a Scanline config exists, add a reload command that re-reads it and updates each Pane's term.options (theme/fontFamily/fontSize) then refit. Depends on the config-reading feature first.
- **Deps:** Ghostty/Scanline config reading (todo)

## notifications

### [todo/P0/M] OSC 9 / 777 / 99 desktop-notification escape parsing
- **Behavior:** When any program inside a terminal pane writes a desktop-notification escape sequence (OSC 9 ;text BEL, OSC 777;notify;title;body, OSC 99 kitty-style), cmux captures the title/body and turns it into an in-app TerminalNotification attached to that pane/tab. This is the foundational signal that drives rings, panel rows, tab light-up and the OS toast. Empty title falls back to the tab/surface title.
- **Shortcut/CLI:** -
- **cmux impl:** Ghostty's VT parser decodes the OSC sequences and emits GHOSTTY_ACTION_DESKTOP_NOTIFICATION (title/body C strings). GhosttyTerminalView.handleAction (Sources/GhosttyTerminalView.swift ~L4355 app-target and ~L4630 surface-target) reads action.action.desktop_notification.{title,body}, resolves tabId/surfaceId, checks workspace.suppressesRawTerminalNotification, then calls TerminalNotificationStore.shared.addNotification(tabId:surfaceId:title:subtitle:body:).
- **Windows approach:** xterm.js does NOT parse OSC 9/777/99 into events by default. Register custom handlers: term.parser.registerOscHandler(9, cb), registerOscHandler(777, cb), registerOscHandler(99, cb) in the renderer; parse the payload (split on ';', strip ST/BEL), then invoke a Tauri command (e.g. notify.osc) over IPC/event carrying paneId+title+body. Rust side feeds the same notification store as the CLI 'notify' path. Must handle chunked OSC across pty data writes (xterm buffers within a single feed but verify across feeds).
- **Deps:** Terminal panes (xterm.js), notification store (Rust), pane->tab/leaf id mapping

### [todo/P2/S] Terminal bell (BEL / OSC ring-bell) handling
- **Behavior:** A raw BEL (0x07) or bell escape from a pane triggers a bell reaction (audible/visual) distinct from a full notification. cmux currently routes it to ringBell() on the pane.
- **Shortcut/CLI:** -
- **cmux impl:** Ghostty emits GHOSTTY_ACTION_RING_BELL; GhosttyTerminalView.handleAction (~L4385) calls performOnMain { self.ringBell() }. Separate from desktop_notification.
- **Windows approach:** xterm.js exposes term.onBell(cb). Wire onBell to either play a sound (Rust beep / MessageBeep via winapi) and/or trigger a brief pane flash. Decide policy: bell alone need not create a panel row (matches cmux, which only rings). Optionally gate behind a setting.
- **Deps:** Terminal panes, pane flash/sound side-effects

### [partial/P0/M] cmux notify CLI command
- **Behavior:** From a shell or agent hook, `cmux notify --title T --subtitle S --body B [--workspace W] [--surface S] [--window N]` injects a notification into a specific pane/workspace (or the caller's own pane via env vars). This is how agents that lack OSC support (Claude Code, Codex, OpenCode) surface 'waiting for input'.
- **Shortcut/CLI:** cmux notify --title <t> [--subtitle <t>] [--body <t>] [--workspace <id|ref|index>] [--surface <id|ref|index>] [--window <id|ref|index>]
- **cmux impl:** CLI/cmux.swift case "notify" (~L4189): resolves workspace/surface (explicit args, refs, indexes, or caller via CMUX_WORKSPACE_ID/CMUX_SURFACE_ID/caller TTY), then sends a socket command notify_target / notification.create / notification.create_for_caller to the app, which calls TerminalNotificationStore.addNotification.
- **Windows approach:** Go CLI already has `scanline notify` but it only does console.log (no UI). Extend: add notify subcommand flags (--title/--subtitle/--body/--pane/--workspace), resolve target pane from $SCANLINE_PANE/$TMUX_PANE env (caller path) or explicit id, write a one-line JSON {cmd:'notify', pane, title, subtitle, body} to the named pipe \\.\pipe\scanline. Rust control server routes to a real notification store + emits a Tauri event the frontend renders. This is the keystone for agent integration on Windows.
- **Deps:** Control server (named pipe), notification store, caller-pane env tracking

### [todo/P0/M] In-app notification store / queue (record, dedup, cooldown)
- **Behavior:** All notifications (from OSC or CLI) accumulate in a single ordered, newest-first list. A new notification for a pane replaces the prior one for that same pane/surface (one live notification per pane). Optional cooldownKey+interval throttling drops duplicate bursts. Each entry has title, subtitle, body, createdAt, isRead, paneFlash, optional clickAction.
- **Shortcut/CLI:** -
- **cmux impl:** TerminalNotificationStore (Sources/TerminalNotificationStore.swift): @Published notifications:[TerminalNotification]; addNotification -> applyNotification -> recordNotification removes existing same tab/surface entries and inserts at index 0; lastNotificationDateByCooldownKey enforces cooldown; indexes (unreadCount, byTab, byTabSurface, latest) rebuilt on didSet.
- **Windows approach:** Build a Rust struct NotificationStore (Vec<Notification> newest-first + HashMap indexes by pane/leaf id) behind a Mutex in Tauri state, OR a TS store in the renderer. Given Scanline keeps layout in layout.ts (frontend), a frontend TS store is simpler: Notification {id, leafId, title, subtitle, body, createdAt, isRead, paneFlash}. Implement dedup-per-leaf and optional cooldown map. Expose add/markRead/remove/clear.
- **Deps:** OSC parsing OR notify CLI as producers; leaf/pane id model (layout.ts)

### [todo/P0/S] Pane notification ring (blue ring on waiting pane)
- **Behavior:** A pane whose agent is waiting/has an unread notification gets a colored (accent/blue) ring drawn around its border, so you can spot which split needs attention. Ring clears when the pane is focused/read. Toggleable via a setting.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyTerminalView.setNotificationRing(visible:) (~L12116) toggles notificationRingOverlayView.isHidden + notificationRingLayer.opacity; updateNotificationRingPath (~L14033) builds the rounded-rect CAShapeLayer path. Driven by store.hasUnreadNotification(forTabId:surfaceId:) and focusedReadIndicator. Setting: NotificationPaneRingSettings.enabledKey / notifications.unreadPaneRing (default true).
- **Windows approach:** Pure DOM/CSS: each grid leaf is a div; add a CSS class .notif-ring -> box-shadow:inset 0 0 0 2px var(--accent) or an absolutely-positioned overlay border. Frontend subscribes to the notification store; on unread-for-leaf set the class, clear on focus/read. No native code needed. Honor a settings flag once settings UI exists (hardcode-enabled until then).
- **Deps:** Notification store, layout leaf DOM nodes, focus tracking

### [todo/P1/S] Pane flash on notification
- **Behavior:** When a notification arrives for a pane, the pane briefly flashes/pulses (separate, more transient cue than the persistent ring). Per-notification paneFlash flag can disable it; global setting notifications.paneFlash toggles it.
- **Shortcut/CLI:** -
- **cmux impl:** TerminalNotification.paneFlash:Bool (default true), set from policy effects.paneFlash. store.hasUnreadNotificationRequiringPaneFlash(forTabId:surfaceId:). NotificationPaneFlashSettings.isEnabled (notifications.paneFlash, default true). Rendering via the surface flash overlay (onTriggerFlash / setInactiveOverlay).
- **Windows approach:** CSS keyframe animation on the leaf div (e.g. @keyframes notif-flash { 0%{background:accent/20%} 100%{transparent} }) added for ~400ms then removed via setTimeout. Read paneFlash flag from the notification; gate on settings flag later. Distinct class from the persistent ring.
- **Deps:** Notification store, pane DOM nodes

### [todo/P2/M] Sidebar tab light-up + per-workspace unread badge
- **Behavior:** In the vertical/horizontal tab sidebar, a workspace/tab whose pane has an unread notification lights up (badge / dot / count) and shows the latest notification text, so you can tell across tabs (not just visible splits) which one needs you.
- **Shortcut/CLI:** -
- **cmux impl:** Store exposes workspaceIsUnread(forTabId:), unreadCount(forTabId:), latestNotification(forTabId:), hasVisibleNotificationIndicator(...). Sidebar rows (ExtensionSidebarWorkspaceRowView / VerticalTabsSidebar) bind to these; manual/panel-derived/restored unread sets feed the workspace-level badge. Latest notification text shown as the tab's status line.
- **Windows approach:** Scanline has NO sidebar/tabs yet (explicitly not done). Once tabs/sidebar exist, each tab row reads aggregated unread state for its panes from the notification store (count + latest text) and renders a dot/badge + truncated body. Pure DOM. Until tabs exist this is blocked; the per-pane ring covers the visible-split case.
- **Deps:** Sidebar + vertical/horizontal tabs (not built), notification store

### [todo/P1/M] Notifications panel (list of all pending notifications)
- **Behavior:** A dedicated panel/page lists every notification newest-first: unread dot, title, body (3 lines), originating tab name, timestamp; click a row to jump to that pane and mark read; per-row clear (x); 'Clear All' button; empty state. Opened with Cmd+I.
- **Shortcut/CLI:** Cmd+I (Show notifications panel)
- **cmux impl:** NotificationsPage.swift: SwiftUI view bound to TerminalNotificationStore.notifications via ForEach + NotificationRow; onOpen -> AppDelegate.openTerminalNotification + select tabs; onClear -> store.remove(id:); header has Clear All (store.clearAll) and Jump-to-Unread button. Shortcut routed in AppDelegate via .showNotifications.
- **Windows approach:** Build a React/TS panel component (overlay or dedicated grid region) listing store entries; row click -> focus the target leaf (layout.ts focus) + markRead; x button -> remove; Clear All. Register a global key handler (xterm attachCustomKeyEventHandler / window keydown) for Ctrl+I (Windows analog of Cmd+I) that toggles the panel. Empty-state view. Pure frontend.
- **Deps:** Notification store, focus/jump to leaf

### [todo/P1/S] Jump to latest unread
- **Behavior:** One keystroke focuses the pane of the most recent unread notification (across all tabs/windows), selecting its workspace and surface and marking it read. If no concrete notification, falls back to the latest workspace-level unread.
- **Shortcut/CLI:** Cmd+Shift+U (Windows: Ctrl+Shift+U)
- **cmux impl:** AppDelegate.jumpToLatestUnread (~L11441) iterates notifications newest-first, picks first openable unread (shouldOpenFromJumpToLatestUnread), calls openTerminalNotification; fallback openLatestWorkspaceUnread. Routed via matchConfiguredShortcut(.jumpToUnread).
- **Windows approach:** Frontend: function jumpToLatestUnread() scans store newest-first for first unread, calls layout focus(leafId) + markRead. Bind Ctrl+Shift+U via the existing xterm attachCustomKeyEventHandler capture path already used for Scanline shortcuts. No native code.
- **Deps:** Notification store, layout focus by leaf id

### [todo/P2/S] Toggle current item unread
- **Behavior:** Toggles the read/unread state of the currently focused notification (in the panel) or the focused pane's notification, letting you re-flag something to revisit.
- **Shortcut/CLI:** Opt+Cmd+U (Windows: Alt+Ctrl+U)
- **cmux impl:** AppDelegate.toggleFocusedNotificationUnread (routed via .toggleUnread). Store markRead(id:) / markUnread(id:) flip isRead; markUnread also clears manual/restored workspace unread to avoid double count.
- **Windows approach:** Frontend store methods markRead/markUnread(id) already needed; add toggle that targets the panel's focused row or the focused leaf's latest notification. Bind Alt+Ctrl+U through the shortcut capture handler.
- **Deps:** Notification store, notifications panel focus, shortcut capture

### [todo/P3/S] Mark current as oldest-unread and jump to next latest unread
- **Behavior:** Marks the focused notification so it sorts as the oldest unread (defers it) and immediately jumps to the next-latest unread pane — a triage flow for clearing a queue of waiting agents.
- **Shortcut/CLI:** Ctrl+Cmd+U (Windows analog: Ctrl+Alt+U or chord)
- **cmux impl:** AppDelegate.markFocusedNotificationAsOldestUnreadAndJumpToNextLatestUnread (routed via .markOldestUnreadAndJumpNext); store.markLatestNotificationAsOldestUnread(forTabId:surfaceId:) (~L1636) then jumpToLatestUnread(excluding...).
- **Windows approach:** Frontend: combine markOldestUnread (reorder/flag in store) + jumpToLatestUnread(excludingCurrent). Lower priority triage nicety; implement after panel + jump exist. Pick a non-conflicting Windows chord.
- **Deps:** Jump to latest unread, toggle unread, notification store ordering

### [todo/P1/L] Native OS desktop notification (toast) delivery
- **Behavior:** When the app is in the background or the target pane is not focused, the notification is also delivered as a native OS notification (title/subtitle/body, sound, click-to-focus). If the app+pane are already focused, the external toast is suppressed (only in-app cues + optional sound/command fire).
- **Shortcut/CLI:** -
- **cmux impl:** scheduleUserNotification (~L1901) builds UNMutableNotificationContent and posts via UNUserNotificationCenter with userInfo {tabId,notificationId,surfaceId,clickAction}; categoryIdentifier for actions. shouldSuppressExternalDelivery (~L1474) = app focused AND active tab AND focused surface -> route to playSuppressedNotificationFeedback (local sound/command only). Click handled in AppDelegate didReceive response -> openTerminalNotification.
- **Windows approach:** Use Tauri notification plugin (tauri-plugin-notification) for simple toasts, OR WinAppSDK/winrt-toast for rich actionable toasts with AppUserModelID (needed for click-activation + grouping). Implement focus-suppression: only call OS notify when app window not foreground (GetForegroundWindow vs our HWND) or target leaf not focused. Click activation -> bring window to front + focus leaf (deep-link via toast launch arg carrying leafId).
- **Deps:** Notification store, focus state detection, window foreground detection, AppUserModelID/installer identity for toasts

### [todo/P2/M] Notification sound (system/custom/none) + preview
- **Behavior:** Plays a sound when a notification fires. Choice of macOS system sounds, a custom audio file (transcoded/staged), or none. Settings can preview the selected sound. Sound is part of OS toast and also plays for suppressed (focused) notifications unless silent.
- **Shortcut/CLI:** -
- **cmux impl:** NotificationSoundSettings (TerminalNotificationStore.swift L38-556): systemSounds list, sound(defaults:) -> UNNotificationSound, custom file staged to ~/Library/Sounds via afconvert to .caf, playSelectedSound/previewSound; setting notifications.sound + notifications.customSoundFilePath.
- **Windows approach:** For OS toast, sound is the toast's audio element (ms-winsoundevent:* or custom wav via Notifications XML). For in-app/suppressed sound, play a wav with rodio (Rust) or an <audio> element. Custom-file: validate + reference a .wav (Windows toasts require wav, not caf — no transcode needed if user supplies wav; reject others or convert via ffmpeg if bundled). 'None' = silent. Preview = play on demand.
- **Deps:** Native toast delivery (for toast sound), settings UI for selection

### [todo/P2/S] Custom notification command (run shell on notify)
- **Behavior:** User configures a shell command that runs on every notification, receiving CMUX_NOTIFICATION_TITLE/SUBTITLE/BODY env vars — lets users pipe notifications to Slack, ntfy, phone push, etc.
- **Shortcut/CLI:** -
- **cmux impl:** NotificationSoundSettings.runCustomCommand (~L534) spawns /bin/sh -c <command> with CMUX_NOTIFICATION_* env; gated by effects.command; setting notifications.command.
- **Windows approach:** Rust std::process::Command with cmd.exe /C <command> (or powershell -Command), inject SCANLINE_NOTIFICATION_TITLE/SUBTITLE/BODY env vars; run detached, ignore output, off the UI thread (spawn a thread/task). Wire into the notification side-effect path. Gate behind a setting string.
- **Deps:** Notification store side-effect hook, settings UI for the command string

### [todo/P2/M] Dock/taskbar unread badge
- **Behavior:** The app's Dock icon shows a numeric badge of total unread notifications (capped at 99+), optionally prefixed with a run tag (CMUX_TAG). Toggleable via setting.
- **Shortcut/CLI:** -
- **cmux impl:** refreshDockBadge (~L2285) sets NSApp.dockTile.badgeLabel = dockBadgeLabel(unreadCount, isEnabled, runTag); recomputed on notifications didSet/UserDefaults change. Setting notifications.dockBadge (default true). TaggedRunBadgeSettings reads CMUX_TAG.
- **Windows approach:** Windows has no numeric dock badge; use a taskbar overlay icon via ITaskbarList3::SetOverlayIcon (small HICON, render the count) through the windows crate, or Tauri's set_overlay_icon if exposed. Update on unread count change. Tag prefix optional. Overlay icons are tiny so render count as a 16x16 badge image.
- **Deps:** Notification store unread count, win32 ITaskbarList3 interop

### [partial/P1/L] Agent hook wiring (Claude Code / Codex / OpenCode) for waiting notifications
- **Behavior:** `cmux hooks setup [agent]` installs hooks into supported agent CLIs so that when an agent stops / waits for input / sends its own notification, it calls back into cmux (which emits the in-app notification + ring + toast). This is what makes 'agent is waiting' light up without OSC support.
- **Shortcut/CLI:** cmux hooks setup [agent] / cmux claude-hook <stop|notification|idle|...>
- **cmux impl:** CLI/cmux.swift: hooks setup (~L12747) installs per-agent hook scripts; claude-hook subcommands (session-start/stop/idle/notification) parse agent JSON on stdin and send notify_target_async to the app (~L20696-28014). terminal-notifier shim for OpenCode (~L18642) re-routes to `cmux notify`.
- **Windows approach:** Scanline has the tmux-shim launch path but NO agent-hook config/resume. Implement a `scanline hooks setup` in the Go CLI that writes agent-specific hook config (Claude Code settings.json hooks, Codex, OpenCode) pointing at a `scanline notify`/`scanline agent-hook` command; the hook reads the agent's stdin JSON, derives pane from $SCANLINE_PANE, and writes notify JSON to the named pipe. Pure Go + JSON; no native deps. Big surface area (per-agent formats).
- **Deps:** notify CLI over named pipe, caller-pane env tracking, per-agent hook formats

### [todo/P3/L] Per-pane notification policy hooks (programmable transform/suppress)
- **Behavior:** Project-defined hook programs (from cmux.json) receive the notification as JSON on stdin and can rewrite title/body or set effects (suppress desktop, mute sound, skip pane flash, mark read, reorder workspace, stop chain). Lets a repo customize how agent notifications behave.
- **Shortcut/CLI:** -
- **cmux impl:** TerminalNotificationPolicy.swift: TerminalNotificationPolicyEngine.evaluate runs each CmuxResolvedNotificationHook via posix_spawn /bin/sh -c, pipes envelope JSON to stdin, parses a JSON patch from stdout (effects/notification/stop), with timeout+kill+output cap; NotificationPolicyHookAuthorizer gates untrusted hooks. Effects struct: record/markUnread/reorderWorkspace/desktop/sound/command/paneFlash. Settings notifications.hooks / hooksMode.
- **Windows approach:** Depends on cmux.json/custom-commands (not built in Scanline). Rust: spawn cmd/sh with std::process::Command, write envelope JSON to stdin, read stdout JSON patch, enforce timeout (tokio::time::timeout + kill), output byte cap. Merge patch into effects. Defer until config system + a trust/authorization model exist — non-trivial and not core for v1.
- **Deps:** cmux.json config system (not built), action-trust/authorization model, notification store effects

### [todo/P1/S] Suppress notification when pane is focused (smart suppression)
- **Behavior:** If the notification's pane is the focused pane in the active window and the app is foreground, no OS toast is shown (you're already looking at it) — only optional local sound/command run, and a subtle focused-read indicator is set instead of a persistent unread ring.
- **Shortcut/CLI:** -
- **cmux impl:** shouldSuppressExternalDelivery (~L1474): AppFocusState.isAppFocused() && selectedTabId==tab && focusedSurfaceId==surface. When suppressed, recordNotification sets focusedReadIndicator and routes to playSuppressedNotificationFeedback (no toast).
- **Windows approach:** Frontend tracks focused leaf; Rust/JS checks app-foreground (GetForegroundWindow == our HWND, exposed via a Tauri command or window focus events) + focused-leaf == target. If both true, skip OS toast, optionally play sound, and mark as a transient 'focused read' indicator rather than a persistent ring.
- **Deps:** Native toast delivery, focus tracking, window foreground detection

### [todo/P2/M] Clear / mark-read management (clear all, dismiss, mark read, clear-read) + CLI
- **Behavior:** Users can clear all notifications, dismiss one, mark one/all read without opening, clear only already-read ones, and clear per-workspace — both from the panel UI and via CLI (clear-notifications, dismiss-notification, mark-notification-read, open-notification, list-notifications).
- **Shortcut/CLI:** CLI: cmux clear-notifications / dismiss-notification / mark-notification-read --all / open-notification --id
- **cmux impl:** Store methods clearAll, remove(id:), markRead(id:)/markRead(forTabId:)/markUnread(id:); CLI cases list-notifications/dismiss-notification/mark-notification-read/open-notification/jump-to-unread/clear-notifications (help blocks ~L14066-14125). Menu-bar extra (MenuBarExtraController.swift L114-128) exposes Show/Jump/Mark All Read/Clear All.
- **Windows approach:** Frontend store: clearAll(), remove(id), markRead(id), markReadForLeaf(leafId), clearRead(). Panel buttons + per-row x. CLI: add scanline subcommands that send JSON over the pipe (clear/dismiss/mark-read) which the Rust server applies and re-emits state to the frontend. Optional system-tray menu (Tauri tray) mirroring Show/Jump/Mark-all-read/Clear-all.
- **Deps:** Notification store, notifications panel, control server, (optional) system tray

### [todo/P3/S] Reveal-in-Finder / click-action notifications
- **Behavior:** A notification can carry a click action (e.g. reveal a file path in Finder) so clicking the toast or row performs an action instead of just focusing the pane. Such notifications are skipped by jump-to-unread (they aren't pane-focus targets).
- **Shortcut/CLI:** -
- **cmux impl:** TerminalNotificationClickAction enum (.revealInFinder(path)) encoded into UNNotification userInfo; AppDelegate.performTerminalNotificationClickAction (~L15621) handles it; jumpToLatestUnread skips notifications with non-nil clickAction.
- **Windows approach:** Add a clickAction variant (e.g. revealInExplorer(path)); on toast/row click run explorer.exe /select,<path> via Command. Carry the action in toast launch args + store entry. Low priority; only needed once features emit file-path notifications.
- **Deps:** Notification store, native toast click handling

### [todo/P3/S] Workspace auto-reorder on notification
- **Behavior:** When a notification arrives, the owning workspace/tab can be moved to the top of the sidebar so the most-recently-active agent surfaces float up (toggleable).
- **Shortcut/CLI:** -
- **cmux impl:** In recordNotification/applyNotification: if effects.reorderWorkspace && WorkspaceAutoReorderSettings.isEnabled() -> tabManager.moveTabToTopForNotification(tabId).
- **Windows approach:** Blocked on tabs/sidebar (not built). Once tab ordering exists in layout/tab model, on notification add move the tab to the top of its list; gate behind a setting. Pure frontend reorder.
- **Deps:** Sidebar/tabs (not built), notification store

### [todo/P2/M] Notification authorization / permission flow
- **Behavior:** On first delivery the app requests OS notification permission; settings show the current authorization status (Allowed/Denied/Deliver Quietly), offer a 'request'/'open system settings' button, and a 'send test notification' button. Delivery falls back to local sound/command if denied.
- **Shortcut/CLI:** -
- **cmux impl:** TerminalNotificationStore: refreshAuthorizationStatus, ensureAuthorization, requestAuthorizationFromSettings, openNotificationSettings (x-apple.systempreferences URL), sendSettingsTestNotification, authorizationState enum; promptToEnableNotifications alert.
- **Windows approach:** Windows toast permission is implicit once the app has a registered AppUserModelID/shortcut, but the user can disable in Settings > Notifications. Implement: detect notifications-enabled where available, provide a 'Send test notification' button, and an 'Open Windows notification settings' deep link (ms-settings:notifications). Fallback to in-app cues when disabled.
- **Deps:** Native toast delivery, settings UI

## browser

### [done/P0/S] Split a browser pane
- **Behavior:** User splits a real browser into a tile next to terminals. Renders any site (ignores X-Frame-Options), as a leaf in the tiling grid.
- **Shortcut/CLI:** Cmd+Shift+L (split right); menu Split Browser Right/Down (.splitBrowserRight/.splitBrowserDown). CLI: cmux browser open <url>
- **cmux impl:** BrowserPanel/BrowserPanelView wrap a WKWebView as a panel kind alongside terminal panels; placement via surface.split. cmuxApp.swift menu actions .splitBrowserRight/Down.
- **Windows approach:** Already done: native WebView2 child in a grid leaf via browser_open (main-thread async Tauri command), bounds pushed on layout refit. browser.ts BrowserPane + lib.rs browser_open/browser_bounds.
- **Deps:** Tiling grid; browser pane

### [done/P0/S] Address bar / omnibar navigation
- **Behavior:** Type a URL or search term into the address bar and press Enter to navigate; bare terms become a web search.
- **Shortcut/CLI:** Cmd+L (focus address bar). CLI: cmux browser <surface> goto <url>
- **cmux impl:** BrowserPanelView omnibar (NSTextField via BrowserOmnibarAppKitBridge); URL normalization + BrowserSearchEngine; navigate routed to WKWebView load.
- **Windows approach:** Already done: DOM <input> URL bar in the control bar, toUrl() normalization (scheme/localhost/search), invoke browser_navigate -> WebView2 Navigate. Add Cmd/Ctrl+L focus binding.
- **Deps:** Browser pane

### [done/P0/S] Back / Forward / Reload
- **Behavior:** Navigate the browser history backward/forward and reload the current page via toolbar buttons or shortcuts.
- **Shortcut/CLI:** Cmd+[ back, Cmd+] forward, Cmd+R reload. CLI: cmux browser <surface> back|forward|reload
- **cmux impl:** BrowserPanelView toolbar buttons call WKWebView goBack/goForward/reload; v2 socket browser.back/forward/reload.
- **Windows approach:** Already done: control-bar buttons invoke browser_back/forward; WebView2 GoBack/GoForward/Reload. Reload currently re-navigates URL; switch to ICoreWebView2.Reload. Add keybindings.
- **Deps:** Browser pane

### [todo/P1/S] Toggle DevTools
- **Behavior:** Open/close the browser developer tools (Elements/Network/etc.) for the focused browser pane, attached inline or in a separate window.
- **Shortcut/CLI:** Opt+Cmd+I (.toggleBrowserDeveloperTools, Safari default, customizable)
- **cmux impl:** BrowserPanel.toggleDeveloperTools() drives WKWebView.isInspectable + developerExtrasEnabled; inline-hosted inspector view (BrowserPanelView ~line 5063) or detached.
- **Windows approach:** WebView2 ICoreWebView2.OpenDevToolsWindow() (separate window, simplest). Inline-docked devtools is not natively supported by WebView2; would need a second WebView2 + CDP-driven devtools frontend (heavy) — ship the window version first.
- **Deps:** Browser pane

### [todo/P2/S] Show JavaScript Console
- **Behavior:** Open devtools focused on the Console tab to read logs/errors for the focused browser pane.
- **Shortcut/CLI:** Opt+Cmd+C (Safari default, customizable)
- **cmux impl:** manager.showJavaScriptConsoleFocusedBrowser() opens the inspector on the console pane (cmuxApp.swift ~787).
- **Windows approach:** WebView2 OpenDevToolsWindow() (cannot deep-link to Console tab via public API). Alternatively surface console via CDP Runtime/Log domain into an in-app panel. Pair with the scriptable browser.console.list (CDP Log.enable).
- **Deps:** Toggle DevTools

### [todo/P2/M] Find in page (browser)
- **Behavior:** Cmd+F over a browser pane highlights all matches with a floating count pill, next/prev cycling, scroll-into-view of the current match.
- **Shortcut/CLI:** Cmd+F find, Cmd+G / Opt+Cmd+G next/prev, Opt+Cmd+Shift+F hide
- **cmux impl:** BrowserSearchOverlay (SwiftUI) + BrowserFindJavaScript injects a TreeWalker scan wrapping matches in <mark>, .current class scrolled into view; returns {total,current} JSON.
- **Windows approach:** Port BrowserFindJavaScript verbatim and run via WebView2 ExecuteScriptAsync (returns JSON), or use ICoreWebView2.FindController (Find API). Floating overlay = DOM widget over the pane. JS-injection port is the lower-risk, behavior-identical route.
- **Deps:** Browser pane; find/find bar infra

### [todo/P2/M] Omnibar suggestions (history frecency + search)
- **Behavior:** As you type in the address bar, a dropdown shows browsing-history matches (ranked by recency+repeat visits) and a search-engine suggestion.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserPanelView OmnibarSuggestionRefreshScheduler/suggestionTask; BrowserHistoryStore (browser_history.json) with frecency blend; BrowserSearchSettings search engine.
- **Windows approach:** Persist a JSON history store on navigation (didFinish equiv: WebView2 NavigationCompleted/SourceChanged), compute frecency in TS, render a DOM dropdown under the URL input. Optional network search-suggest fetch via Rust reqwest.
- **Deps:** Address bar; browsing history store

### [todo/P2/S] Browsing history store + clear history
- **Behavior:** Visited pages are recorded per profile and power omnibar suggestions; user can clear history from Settings > Browser.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserHistoryStore persisted to profiles dir browser_history.json; BrowserSection 'Clear History' dialog; per-profile historyStore(for:).
- **Windows approach:** JSON store keyed by profile dir; append on WebView2 NavigationCompleted. Clear = delete file + flush in-memory. Trivial on Windows once history store exists.
- **Deps:** Settings UI; omnibar suggestions

### [todo/P3/S] Favicon display
- **Behavior:** The browser pane/tab shows the site favicon for visual identification.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserPanel favicon extraction via JS/page metadata (debug.browser.favicon test hook; CmuxWebView link-rel scraping).
- **Windows approach:** WebView2 exposes FaviconChanged event + GetFavicon (recent SDK) — use it directly; fallback to ExecuteScriptAsync scraping <link rel=icon>. Render <img> in the pane control bar.
- **Deps:** Browser pane; tabs/sidebar

### [todo/P1/M] Popup / target=_blank window handling
- **Behavior:** Links that open new windows (OAuth popups, etc.) open in a managed popup window instead of being dropped.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserPopupWindowController hosts a child WKWebView (isInspectable) for createWebViewWith requests; routes window.open.
- **Windows approach:** WebView2 NewWindowRequested event: set Handler/NewWindow to a freshly created WebView2 in a Tauri window, or deferral. Needed for real auth flows (Google/GitHub login).
- **Deps:** Browser pane; multi-window

### [todo/P2/S] WebAuthn / passkey support
- **Behavior:** Sites requesting passkeys/security-key auth work inside the in-app browser.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserWebAuthnSupport configures WKWebView for WebAuthn flows.
- **Windows approach:** WebView2 supports WebAuthn natively on Win10+/Win11 via the platform authenticator; mostly works out of the box. Verify under Tauri child webview; may need feature flag in WebView2 environment options.
- **Deps:** Browser pane

### [todo/P1/M] Browser profiles (isolated cookie/storage stores)
- **Behavior:** Multiple named browser profiles, each with its own cookies/storage/history; create/rename/delete/clear; panes bind to a chosen profile.
- **Shortcut/CLI:** CLI: cmux browser profiles list|create|rename|clear|delete
- **cmux impl:** BrowserProfileStore + BrowserProfileAutomation (BrowserAutomation.swift); per-profile WKWebsiteDataStore; v2 browser.profiles.* socket methods.
- **Windows approach:** WebView2 environment with a distinct UserDataFolder per profile (each profile = its own CoreWebView2Environment). Profile registry in JSON; clear = delete the user-data folder. Bind pane creation to a profile id.
- **Deps:** Browser pane

### [partial/P0/S] Self-identify with browser context
- **Behavior:** An agent asks 'where am I' and gets focused window/workspace/pane/surface ids plus surface_type and browser url/title/loading for the focused browser.
- **Shortcut/CLI:** CLI: cmux browser identify --surface <id> (wrapper over system.identify)
- **cmux impl:** system.identify returns focused.* ids + focused.browser.{url,title,loading}; canonical first call per port spec.
- **Windows approach:** Scanline control server already returns ids for focus; add browser fields by querying WebView2 Source/DocumentTitle of the focused pane. Extend named-pipe JSON protocol with identify.
- **Deps:** Control server; pane focus tracking

### [todo/P0/L] Scriptable: snapshot accessibility tree with element refs
- **Behavior:** Agent gets a structured a11y/DOM tree (roles+names) with stable ephemeral refs (@e1...) it can act on; supports interactive-only, compact, max-depth, selector scope.
- **Shortcut/CLI:** CLI: cmux browser <surface> snapshot --interactive [--compact --max-depth N --selector css]
- **cmux impl:** TerminalController.v2BrowserSnapshot builds a large injected JS (role inference, name computation, visibility, CSS-path refs) run via evaluateJavaScript; returns refs map. browser.snapshot.
- **Windows approach:** Port the snapshot JS verbatim and run via WebView2 ExecuteScriptAsync (or CDP Runtime.evaluate via with_webview — already proven in Scanline spike). JS is platform-agnostic; the ref registry lives in injected JS. This is the keystone of the agent API.
- **Deps:** Browser pane; CDP/script-eval bridge

### [partial/P0/S] Scriptable: evaluate JS
- **Behavior:** Agent runs arbitrary JavaScript in the page and gets the normalized return value.
- **Shortcut/CLI:** CLI: cmux browser <surface> eval '<js>'
- **cmux impl:** v2BrowserEval -> v2RunBrowserJavaScript(webView, script, timeout 10s); v2NormalizeJSValue of result. browser.eval.
- **Windows approach:** Scanline spike already does Runtime.evaluate via CDP returning values; or WebView2 ExecuteScriptAsync (returns JSON string). Wrap as a control-server method. Mostly plumbing on top of the existing CDP bridge.
- **Deps:** Browser pane; CDP/script-eval bridge

### [todo/P0/M] Scriptable: wait conditions
- **Behavior:** Agent waits for selector visible, text present, URL contains, load-state, or a predicate function, with a timeout.
- **Shortcut/CLI:** CLI: cmux browser <surface> wait --selector|--text|--url-contains|--load-state|--function --timeout-ms N
- **cmux impl:** browser.wait variants (selector/timeout/URL/load-state/function/text) — injected polling JS + navigation observation.
- **Windows approach:** Polling loop in injected JS via ExecuteScriptAsync, plus WebView2 NavigationCompleted/SourceChanged for URL/load-state waits. Implement as a control-server method with server-side timeout.
- **Deps:** Scriptable eval; Scriptable snapshot

### [todo/P0/M] Scriptable: click / dblclick / hover / focus
- **Behavior:** Agent clicks, double-clicks, hovers, or focuses an element by ref or CSS selector.
- **Shortcut/CLI:** CLI: cmux browser <surface> click|dblclick|hover|focus <ref-or-selector>
- **cmux impl:** v2BrowserClick et al resolve ref/selector via the snapshot ref registry then dispatch synthetic events in injected JS. browser.click/dblclick/hover/focus.
- **Windows approach:** Resolve ref to element in injected JS (shared registry) then element.click()/dispatchEvent; for real input fidelity use CDP Input.dispatchMouseEvent. ExecuteScriptAsync path is simplest and matches cmux semantics.
- **Deps:** Scriptable snapshot; Scriptable eval

### [todo/P0/M] Scriptable: fill / type / press / keydown / keyup
- **Behavior:** Agent sets an input's value (empty clears), types text char-by-char, or sends key events to the page.
- **Shortcut/CLI:** CLI: cmux browser <surface> fill|type <ref-or-selector> [text]; press|keydown|keyup <key>
- **cmux impl:** browser.fill (empty = clear), browser.type, browser.press/keydown/keyup; injected JS sets value + dispatches input/change/key events.
- **Windows approach:** fill via injected JS (set value + input/change events); type/press via CDP Input.dispatchKeyEvent / insertText for real keyboard fidelity, or JS event dispatch for the simple path. Mirror cmux's empty-text-clears rule.
- **Deps:** Scriptable snapshot; Scriptable eval

### [todo/P0/S] Scriptable: check / uncheck / select
- **Behavior:** Agent toggles checkboxes/radios and selects <option>s in dropdowns by ref or selector.
- **Shortcut/CLI:** CLI: cmux browser <surface> check|uncheck|select <ref-or-selector> [value]
- **cmux impl:** browser.check/uncheck/select via injected JS setting checked/selected + dispatching change.
- **Windows approach:** Injected JS via ExecuteScriptAsync: set checked/selectedIndex/value and dispatch change. Direct port of cmux JS.
- **Deps:** Scriptable snapshot; Scriptable eval

### [todo/P1/S] Scriptable: scroll / scroll into view
- **Behavior:** Agent scrolls the page by dx/dy or scrolls a specific element into view.
- **Shortcut/CLI:** CLI: cmux browser <surface> scroll [--selector css] [--dx n] [--dy n]; scrollintoview
- **cmux impl:** browser.scroll/scroll_into_view via injected window.scrollBy / element.scrollIntoView.
- **Windows approach:** Injected JS via ExecuteScriptAsync (window.scrollBy / el.scrollIntoView). Trivial port.
- **Deps:** Scriptable eval

### [todo/P0/S] Scriptable: getters (text/html/value/attr/title/url/count/box/styles)
- **Behavior:** Agent reads element text/html/value/attribute, page title/url, element count for a selector, bounding box, or computed styles.
- **Shortcut/CLI:** CLI: cmux browser <surface> get text|html|value|attr|title|url|count|box|styles <ref-or-selector>
- **cmux impl:** browser.get.* family via injected JS (innerText/innerHTML/value/getAttribute/getBoundingClientRect/getComputedStyle) + WKWebView title/URL.
- **Windows approach:** Injected JS via ExecuteScriptAsync for DOM getters; title/url from WebView2 DocumentTitle/Source for the page-level ones. Direct JS port.
- **Deps:** Scriptable snapshot; Scriptable eval

### [todo/P0/S] Scriptable: state checks (visible/enabled/checked)
- **Behavior:** Agent asks whether an element is visible, enabled, or checked.
- **Shortcut/CLI:** CLI: cmux browser <surface> is visible|enabled|checked <ref-or-selector>
- **cmux impl:** browser.is.* via injected JS visibility/disabled/checked evaluation.
- **Windows approach:** Injected JS via ExecuteScriptAsync reusing the snapshot's __isVisible logic. Direct port.
- **Deps:** Scriptable snapshot; Scriptable eval

### [todo/P1/M] Scriptable: locators (find by role/text/label/placeholder/alt/title/testid/nth/first/last)
- **Behavior:** Agent finds elements by accessible role, visible text, label, placeholder, alt, title, data-testid, or by index (nth/first/last), returning refs.
- **Shortcut/CLI:** CLI: cmux browser <surface> find role|text|label|placeholder|alt|title|testid|first|last|nth ...
- **cmux impl:** browser.find.* family resolving against the snapshot a11y model / DOM queries, returning element refs.
- **Windows approach:** Injected JS via ExecuteScriptAsync querying the DOM and matching against the same role/name logic as snapshot; allocate refs in the shared registry. Port of cmux's locator JS.
- **Deps:** Scriptable snapshot

### [partial/P1/S] Scriptable: screenshot
- **Behavior:** Agent captures a screenshot of the browser surface (and full-page where feasible).
- **Shortcut/CLI:** CLI: cmux browser <surface> screenshot
- **cmux impl:** browser.screenshot via BrowserScreenshot/BrowserScreenshotPipeline/Snapshotter (WKWebView takeSnapshot / image pipeline).
- **Windows approach:** Scanline spike already proved Page.captureScreenshot via CDP. Use CDP captureScreenshot (supports clip/full-page via captureBeyondViewport). Wrap as control-server method returning base64 PNG.
- **Deps:** CDP/script-eval bridge

### [todo/P1/M] Scriptable: frame context (select/main)
- **Behavior:** Agent switches the automation context into an iframe by selector, or back to the main frame.
- **Shortcut/CLI:** CLI: cmux browser <surface> frame <selector>|main
- **cmux impl:** browser.frame.select/main set the active frame for subsequent injected-JS evaluation.
- **Windows approach:** CDP supports per-frame execution contexts (Runtime.evaluate with contextId / Page.getFrameTree); or inject into the iframe's contentWindow when same-origin. Track active frame server-side.
- **Deps:** Scriptable eval; CDP bridge

### [todo/P1/M] Scriptable: dialog handling (accept/dismiss)
- **Behavior:** Agent accepts or dismisses native JS dialogs (alert/confirm/prompt), optionally with prompt text.
- **Shortcut/CLI:** CLI: cmux browser <surface> dialog accept|dismiss [text]
- **cmux impl:** browser.dialog.accept/dismiss + browser.import.dialog; WKUIDelegate runJavaScript*Panel handlers wired to a pending-dialog resolver.
- **Windows approach:** WebView2 ScriptDialogOpening event (Accept()/Dismiss()/ResultText) with deferral, or CDP Page.javascriptDialogOpening + Page.handleJavaScriptDialog. Track pending dialog per pane.
- **Deps:** Browser pane; control server

### [todo/P2/M] Scriptable: download waiting
- **Behavior:** Agent triggers a download and waits for it to complete, getting the saved file path.
- **Shortcut/CLI:** CLI: cmux browser <surface> download wait --timeout-ms N
- **cmux impl:** browser.download.wait observes WKDownloadDelegate completion.
- **Windows approach:** WebView2 DownloadStarting event + DownloadOperation StateChanged/BytesReceivedChanged; resolve the wait when state=Completed. Return ResultFilePath.
- **Deps:** Browser pane; control server

### [todo/P2/M] Scriptable: console + errors buffers
- **Behavior:** Agent lists captured console messages and page errors for the pane, and can clear them.
- **Shortcut/CLI:** CLI: cmux browser <surface> console list|clear; errors list|clear
- **cmux impl:** browser.console.list/clear, browser.errors.list/clear; ring buffers fed by injected console hooks / page error listeners.
- **Windows approach:** CDP Log.enable + Runtime.consoleAPICalled / Runtime.exceptionThrown events accumulated server-side into a per-pane ring buffer (proven CDP path). Or inject console overrides via AddScriptToExecuteOnDocumentCreated.
- **Deps:** CDP bridge; control server

### [todo/P2/S] Scriptable: highlight element
- **Behavior:** Agent visually highlights an element on the page (debug aid for selectors/refs).
- **Shortcut/CLI:** CLI: cmux browser <surface> highlight <selector>
- **cmux impl:** browser.highlight injects an outline/overlay on the matched element.
- **Windows approach:** Injected JS via ExecuteScriptAsync drawing an outline overlay. Direct port; trivial.
- **Deps:** Scriptable eval

### [todo/P1/S] Scriptable: cookies get/set/clear
- **Behavior:** Agent reads, sets, or clears cookies for the browser surface.
- **Shortcut/CLI:** CLI: cmux browser <surface> cookies get|set|clear ...
- **cmux impl:** browser.cookies.get/set/clear via WKHTTPCookieStore.
- **Windows approach:** WebView2 CookieManager (GetCookies/AddOrUpdateCookie/DeleteCookies) or CDP Network.getCookies/setCookie/clearBrowserCookies. CookieManager is the clean native API.
- **Deps:** Browser pane; control server

### [todo/P1/S] Scriptable: localStorage/sessionStorage get/set/clear
- **Behavior:** Agent reads/writes/clears local or session storage keys for the page.
- **Shortcut/CLI:** CLI: cmux browser <surface> storage local|session get|set|clear ...
- **cmux impl:** browser.storage.get/set/clear via injected JS against window.localStorage/sessionStorage.
- **Windows approach:** Injected JS via ExecuteScriptAsync hitting window.localStorage/sessionStorage. Direct port; trivial.
- **Deps:** Scriptable eval

### [todo/P2/M] Scriptable: browser tabs (new/list/switch/close)
- **Behavior:** agent-browser tab commands mapped to cmux browser surfaces (list, open new, switch, close).
- **Shortcut/CLI:** CLI: cmux browser <surface> tab list|new|switch|close
- **cmux impl:** browser.tab.* mapped onto surface tabs within a pane (per locked decision: tab == browser surface).
- **Windows approach:** Map to Scanline's pane/surface model: tab.new = create another browser pane/surface, list/switch/close operate on those. Depends on Scanline gaining tabs-within-pane (it has panes, not yet surface-tabs).
- **Deps:** Vertical/horizontal tabs (surfaces)

### [todo/P2/M] Scriptable: state save/load
- **Behavior:** Agent saves the browser auth/session state (cookies/storage) to a file and reloads it later.
- **Shortcut/CLI:** CLI: cmux browser <surface> state save|load <path>
- **cmux impl:** browser.state.save/load serializes cookie + storage state for a surface.
- **Windows approach:** Compose CookieManager export + injected-JS storage dump into a JSON file; load reverses it. Built on cookies + storage methods.
- **Deps:** Scriptable cookies; Scriptable storage

### [todo/P2/S] Scriptable: script/style injection (addinitscript/addscript/addstyle)
- **Behavior:** Agent injects a script to run on every new document, injects a one-off script, or injects a stylesheet.
- **Shortcut/CLI:** CLI/protocol: browser.addinitscript|addscript|addstyle
- **cmux impl:** browser.addinitscript (WKUserScript at document start), browser.addscript/addstyle (one-off injected).
- **Windows approach:** WebView2 AddScriptToExecuteOnDocumentCreated (addinitscript), ExecuteScriptAsync (addscript), and inject a <style> via JS (addstyle). Direct native mapping.
- **Deps:** Scriptable eval

### [todo/P1/S] Scriptable: snapshot-after verification
- **Behavior:** Mutating actions can opt in to return a fresh post-action snapshot (refs/title/url) so the agent can verify the result in one round-trip.
- **Shortcut/CLI:** CLI flag: --snapshot-after on mutating commands
- **cmux impl:** snapshot_after param re-runs v2BrowserSnapshot and returns post_action_snapshot (locked decision 15).
- **Windows approach:** After any mutating control-server method, optionally re-run the snapshot routine and attach to the response. Pure plumbing once snapshot + actions exist.
- **Deps:** Scriptable snapshot; click/fill/etc.

### [todo/P2/S] Scriptable: explicit not_supported for WKWebView gaps
- **Behavior:** Commands that cannot be implemented correctly return a clear not_supported error rather than silently failing.
- **Shortcut/CLI:** Affected: viewport/geolocation/offline/trace/network.route/screencast/input_mouse|keyboard|touch
- **cmux impl:** TerminalController dispatches these to handlers that return not_supported (documented in skills/cmux-browser/references/commands.md).
- **Windows approach:** Opportunity: WebView2/CDP can actually implement several of these that WKWebView could not — Network.* interception, Emulation.setDeviceMetricsOverride (viewport), Emulation.setGeolocationOverride, Network.emulateNetworkConditions (offline), Input.dispatch* (raw input), Page.startScreencast. So Scanline can upgrade some cmux not_supported cases to real support, but ship the not_supported stubs first for parity.
- **Deps:** CDP bridge; control server

### [partial/P0/M] cmux browser CLI command grammar
- **Behavior:** Agents drive the browser with agent-browser-style verbs through one CLI: cmux browser [<surface>] <verb> ... with --json, --id-format, short refs (surface:N).
- **Shortcut/CLI:** CLI: cmux browser <surface> <verb> [args] [--json] [--id-format refs|uuids|both]
- **cmux impl:** CLI/cmux.swift browser command group parses agent-browser grammar -> JSON socket calls; short-ref allocator/resolver; --surface targeting with system.identify fallback.
- **Windows approach:** Extend the Go CLI (cli/main.go) with a `browser` subcommand tree mirroring this grammar, emitting one-line JSON over the named pipe. Short-ref allocator lives in the control server. Builds on the existing scanline CLI + pipe protocol.
- **Deps:** Control server; browser.* methods

### [partial/P0/L] Browser automation socket method namespace (browser.*)
- **Behavior:** All browser automation is exposed as ~70 one-line-JSON socket methods so any client (CLI, agent, scripts) can drive it.
- **Shortcut/CLI:** Socket: browser.snapshot/click/fill/eval/... over the control socket
- **cmux impl:** TerminalController processCommand switch (~lines 3598-3765) dispatches every browser.* method to v2Browser* handlers, returning structured JSON with ids/refs.
- **Windows approach:** Extend Scanline's named-pipe JSON protocol with the browser.* method set, dispatched in lib.rs handle_control_client to per-pane WebView2/CDP handlers. Scanline already has the pipe + debug.cdp; this is the structured method layer on top.
- **Deps:** Control server; CDP bridge; per-pane webview registry

### [todo/P2/XL] Browser import wizard (cookies/history/sessions)
- **Behavior:** A multi-step UI imports cookies + history from an installed browser into a cmux profile, with source-profile selection, destination mapping (merge/separate), domain filters, and a result summary.
- **Shortcut/CLI:** Settings > Browser > Import Browser Data > Choose…
- **cmux impl:** BrowserDataImportCoordinator import wizard window; BrowserImportPlanResolver (default/separate/merge plans); BrowserImportOutcome summary; scope cookiesOnly / cookiesAndHistory.
- **Windows approach:** Build a DOM wizard driven by Rust import commands. Read Chromium 'Network/Cookies' + 'History' SQLite via rusqlite; decrypt Chromium cookies with DPAPI (CryptUnprotectData) + AES-GCM using the key from 'Local State' os_crypt.encrypted_key (Windows scheme, not Keychain). Firefox cookies.sqlite/places.sqlite via rusqlite (unencrypted). Inject cookies via WebView2 CookieManager.
- **Deps:** Browser profiles; Settings UI; WebView2 CookieManager

### [todo/P2/L] Installed-browser detection (20+ browsers)
- **Behavior:** cmux auto-detects which browsers are installed and have data, ranks them, and offers them as import sources.
- **Shortcut/CLI:** (auto, shown in import wizard / blank-tab hint)
- **cmux impl:** InstalledBrowserDetector.allBrowserDescriptors (~22: Chrome, Firefox, Arc, Brave, Edge, Safari, Zen, Vivaldi, Opera, Opera GX, Orion, Dia, Comet, Floorp, Waterfox, SigmaOS, Sidekick, Helium, Atlas, Ladybird, Chromium, Ungoogled) across chromium/firefox/webkit families; scored detection via app bundle + data-root presence.
- **Windows approach:** Port descriptors to Windows paths/registry: detect via %LOCALAPPDATA%/%APPDATA% data roots and HKCU/HKLM App Paths or installed-apps registry instead of macOS .app bundles. Drop Safari/Orion/Ladybird-webkit (not on Windows); Windows gains Chrome/Edge/Brave/Firefox/Vivaldi/Opera/Arc(Win)/etc. Reuse the scored-candidate model.
- **Deps:** Browser import wizard

### [todo/P2/L] Chromium cookie decryption (encrypted store)
- **Behavior:** Encrypted Chrome/Brave/Edge cookies are decrypted during import so imported sessions are actually authenticated; failures produce clear warnings.
- **Shortcut/CLI:** (internal to import)
- **cmux impl:** ChromiumCookieKeychainItem + decryptCookieValue: pulls the storage key from macOS Keychain, AES-decrypts v10/v11 cookie blobs; warns on Keychain/decrypt failure.
- **Windows approach:** Windows scheme differs: read 'Local State' -> os_crypt.encrypted_key, strip DPAPI prefix, CryptUnprotectData (DPAPI) to get the AES key, then AES-256-GCM decrypt the v10 cookie blobs (nonce+ciphertext+tag). Newer Chrome adds app-bound encryption (v20) needing extra handling. Use rust crates (aes-gcm, windows DPAPI).
- **Deps:** Installed-browser detection; Browser import wizard

### [todo/P3/M] CLI/socket browser import (headless)
- **Behavior:** An agent/script imports cookies from a chosen browser+profile into a cmux profile without the GUI wizard, with domain filters and create-destination options.
- **Shortcut/CLI:** CLI/socket: browser.import.cookies (params: browser, profile/all_profiles, destination_profile, domains, create_destination_profile)
- **cmux impl:** BrowserImportAutomation.importCookies (BrowserAutomation.swift) resolves browser/source-profiles/destination, builds a plan, runs BrowserDataImporter scope cookiesOnly.
- **Windows approach:** Expose a Rust import command behind a control-server method + Go CLI verb, reusing the Windows detection + DPAPI decryption + CookieManager injection pipeline. Headless layer over the GUI import core.
- **Deps:** Browser import wizard; Chromium cookie decryption

### [todo/P3/S] Blank-tab import hint
- **Behavior:** A new blank browser tab shows a dismissible hint/toolbar chip prompting the user to import browser data; toggle in Settings.
- **Shortcut/CLI:** (toolbar chip on blank tabs; Settings toggle)
- **cmux impl:** BrowserImportHintSettings/Presentation (toolbarChip/floatingCard/settingsOnly variants), shown until imported or dismissed.
- **Windows approach:** DOM chip rendered on about:blank/new browser panes when no profile data exists and hint not dismissed; persist dismissal in settings store. Pure UI.
- **Deps:** Browser import wizard; Settings UI

### [todo/P3/M] Drag image into browser/remote session to upload
- **Behavior:** Dragging an image file onto a (remote) session uploads it; browser pane is a drop target.
- **Shortcut/CLI:** (drag-and-drop onto pane)
- **cmux impl:** BrowserPaneDropTargetView + BrowserPaneDropRouting handle drops; for SSH sessions upload via scp.
- **Windows approach:** Tauri drag-drop events on the pane element; for local just hand the file to the page input. SSH/scp upload is out of the browser area's core scope (depends on SSH/remote, which Scanline lacks). Build the local drop-target first.
- **Deps:** Browser pane; SSH/remote (for scp path)

### [todo/P3/XL] Browser pane routes through remote network (SSH localhost)
- **Behavior:** In an SSH workspace, browser panes proxy through the remote machine so the agent's localhost dev server just works in the in-app browser.
- **Shortcut/CLI:** (implicit when in an SSH workspace)
- **cmux impl:** Remote daemon (daemon/remote) + proxy rebinding on browser move; favicon/navigation routed via the SSH proxy (tests_v2 test_ssh_remote_browser_*).
- **Windows approach:** Requires the whole SSH/remote subsystem Scanline does not have. On Windows: a local SOCKS/HTTP proxy over an SSH tunnel (ssh -D / port-forward) configured on the WebView2 environment (--proxy-server) per pane. Large, out of the immediate browser MVP.
- **Deps:** SSH/remote subsystem; Browser profiles

## agent-integration

### [partial/P0/M] Claude Code Teams (cmux claude-teams)
- **Behavior:** One command launches Claude Code in teammate mode; each teammate Claude spawns spawns as a native split pane in the current workspace with sidebar metadata + notifications, no tmux installed. cmux defaults --teammate-mode auto, sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, and routes Claude's internal tmux split/focus/kill calls into real cmux panes anchored to the leader surface.
- **Shortcut/CLI:** cmux claude-teams [claude-args...] (e.g. --continue, --model sonnet)
- **cmux impl:** CLI/cmux.swift runClaudeTeams() + configureClaudeTeamsEnvironment(): writes a tmux shim dir ~/.cmuxterm/claude-teams-bin/tmux that execs `cmux __tmux-compat`, prepends it to PATH, fakes TMUX/TMUX_PANE/TERM, sets CMUX_CLAUDE_TEAMS_CMUX_BIN + socket env, injects a NODE_OPTIONS restore module, anchors teammate split-window to the leader CMUX_SURFACE_ID, then execv claude. Resume builder treats launcher 'claudeTeams'.
- **Windows approach:** Scanline already has the primitive: Go CLI `scanline <agent>` writes a tmux.cmd shim, prepends PATH, sets TMUX/TMUX_PANE/SCANLINE_BIN and execs the agent; __tmux-compat maps split-window->split etc via the named pipe. Add an explicit `scanline claude-teams` subcommand that resolves claude.cmd on PATH (skipping any cmux wrapper), prepends --teammate-mode auto, sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, writes the tmux.cmd shim, and execs via os/exec (Windows has no execv; use exec.Command + cmd.Run and propagate exit). Anchor teammate splits to the caller leaf id. NODE_OPTIONS restore module is the same trick on Windows.
- **Deps:** tmux-compat shim (have), caller-pane/leader-surface anchoring (todo), named-pipe split/focus/close (have)

### [todo/P1/L] Generic agent hook installer (cmux hooks setup)
- **Behavior:** Installs cmux integration hooks into each detected agent's config so cmux can show running/idle state, Feed approvals, notifications and save resume sessions. `cmux hooks setup` installs all agents whose binary is on PATH and prints a skip summary; `cmux hooks setup <agent>` or `--agent <name>` targets one; `cmux hooks uninstall` removes them. Supports Codex, Grok, OpenCode, Pi, Amp, Cursor, Gemini, Antigravity, Rovo Dev, Hermes, Copilot, CodeBuddy, Factory, Qoder (13+).
- **Shortcut/CLI:** cmux hooks setup | cmux hooks setup <agent> | cmux hooks setup --agent <name> | cmux hooks uninstall
- **cmux impl:** CLI/CMUXCLI+AgentHookDefinitions.swift declares an AgentHookDef table (configDir, configFile, env override, hook events mapping agentEvent->cmuxSubcommand, format flat/nested/yaml/antigravityJSON, feedHookEvents). runSetupHooks() in cmux.swift iterates agentDefs, gates on binary-on-PATH + config dir, writes per-format hook entries whose command invokes `cmux hooks <agent> <subcommand>` guarded by CMUX_SURFACE_ID and a disable env var. OpenCode/Pi/Amp install JS/TS plugins instead.
- **Windows approach:** Port the AgentHookDef table to Go (clean-room). For each agent merge cmux hook entries into the JSON/TOML/YAML config under %USERPROFILE%/.codex etc (Windows uses USERPROFILE not HOME; honor CODEX_HOME/GROK_HOME etc). The injected hook command must be a Windows shell line invoking `scanline hooks <agent> <sub>` with cmd.exe-safe quoting and an `if defined SCANLINE_SURFACE_ID` guard, or better a small `scanline-hook.exe` to avoid POSIX sh. Binary-on-PATH check via exec.LookPath. Write plugins (JS/TS) verbatim for opencode/pi/amp. JSON merge must preserve user keys.
- **Deps:** hook dispatch command (scanline hooks <agent>), session store, lifecycle/status socket commands

### [todo/P1/M] Per-agent hook dispatch (cmux hooks <agent> <event>)
- **Behavior:** When the agent fires a lifecycle event (session-start, prompt-submit, stop, notification, session-end/finalize, approval-response), the installed hook shells out to cmux, which records session state and updates the pane's running/idle/needs-input indicator and the sidebar. Stop marks idle, prompt-submit marks running, notification surfaces text.
- **Shortcut/CLI:** cmux hooks <agent> <session-start|prompt-submit|stop|notification|session-end|session-finalize|approval-response> (invoked by agents, not users)
- **cmux impl:** cmux.swift runGenericAgentHook()/runClaudeHook(): reads stdin JSON (session_id, cwd, transcript_path, turn_id), resolves workspace/surface from CMUX_WORKSPACE_ID/CMUX_SURFACE_ID, upserts ClaudeHookSessionStore/RestorableAgentHookSessionStore, and sends socket commands set_agent_pid / set_status / set_agent_lifecycle. subcommandActions maps event names to AgentHookAction. sessionEndIsTurnBoundary distinguishes per-turn from teardown for restorable agents (grok/antigravity/hermes).
- **Windows approach:** Add `scanline hooks <agent> <sub>` to the Go CLI: parse stdin JSON, read SCANLINE_WORKSPACE_ID/SCANLINE_SURFACE_ID env, write the session record to %USERPROFILE%/.scanline/<agent>-hook-sessions.json, and send one-line JSON over the named pipe to set lifecycle/status. Requires the control server to grow set_agent_lifecycle / set_status / set_agent_pid methods that update pane state. Cross-platform JSON parsing is trivial in Go stdlib.
- **Deps:** named-pipe protocol extension (set_agent_lifecycle/set_status), session store, sidebar/ring UI (other area) to render the state

### [todo/P2/M] Claude Code wrapper (auto hook injection)
- **Behavior:** When Claude Code integration is enabled in Settings, cmux installs a `claude` wrapper on PATH that transparently injects cmux's hooks and session tracking into every Claude launch, so the user never runs `cmux hooks setup` for Claude. The wrapper restores NODE_OPTIONS and forwards to the real claude binary.
- **Shortcut/CLI:** (automatic; toggled in Settings > Automation > Claude Code; custom path via claudeCodeCustomClaudePath / CMUX_CUSTOM_CLAUDE_PATH)
- **cmux impl:** App installs a shell wrapper whose header contains the marker 'cmux claude wrapper - injects hooks and session tracking' (detected by CMUXCLI+ExecutableResolution.swift isCmuxClaudeWrapper); resolveClaudeExecutable() skips the wrapper to find the real binary. runClaudeHook handles claude lifecycle including SessionStart/clear-boundary logic and publishAgentSurfaceResumeBinding.
- **Windows approach:** Ship a `claude.cmd`/`claude.exe` shim placed in a scanline-managed dir prepended to PATH (or a per-user shim dir). The shim sets the cmux-equivalent hook settings (CLAUDE settings.json with hook commands pointing at scanline-hook.exe), restores NODE_OPTIONS, and execs the real claude via LookPath skipping itself (detect by a marker line / file). Windows PATH precedence + .cmd resolution makes this work; must guard against recursive self-launch by marker detection.
- **Deps:** Claude hook dispatch, Settings UI (other area), PATH shim install with elevation-free per-user dir

### [todo/P1/L] Agent session resume on relaunch (native session id)
- **Behavior:** Quitting cmux and relaunching restores each agent terminal by re-running the agent's NATIVE resume command with the saved session id (e.g. `claude --resume <id>`, `codex resume <id>`, `opencode --session <id>`, `amp threads continue <id>`, `acli rovodev run --restore <id>`). Restores the actual conversation, not just a blank shell. Can be disabled (Settings > Terminal > Resume Agent Sessions on Reopen / autoResumeAgentSessions:false).
- **Shortcut/CLI:** (automatic on relaunch; per-agent resume command auto-built)
- **cmux impl:** Sources/RestorableAgentSession.swift AgentResumeCommandBuilder.resumeShellCommand() builds argv per RestorableAgentKind (15 kinds + custom), preserving sanitized flags via AgentLaunchSanitizer.preservedArguments(kind:), prepending env + a `cd` prefix. RestorableAgentSessionIndex.load() reads ~/.cmuxterm/<agent>-hook-sessions.json, validates restorability (Claude checks transcript .jsonl exists), and the session restore path injects resumeStartupInput into the new terminal.
- **Windows approach:** Port AgentResumeCommandBuilder + RestorableAgentSessionIndex to Go/Rust. Persist session records on hook events; at startup, for each restored terminal pane look up its session and feed the resume command line into the ConPTY (Scanline already supports 'run a one-off command line'). Windows path quoting differs (no single-quote shell semantics) so build argv arrays and let portable-pty spawn directly rather than shell-quoting; replace `cd --` prefix with setting the pty cwd. Claude transcript existence check maps to %USERPROFILE%/.claude/projects/<encoded-cwd>/<id>.jsonl.
- **Deps:** session restore (other area: layout/cwd/scrollback persistence), hook session store, per-agent argv sanitizer

### [todo/P1/M] Launch-command sanitizer (safe resume args)
- **Behavior:** When building a resume/fork command, cmux preserves model/sandbox/config/cwd flags but drops the original prompt text, credentials/tokens, old session selectors, and noninteractive (-p) flags, so relaunch resumes the conversation instead of re-running a one-shot task or leaking secrets.
- **Shortcut/CLI:** (internal; affects all resume/fork commands)
- **cmux impl:** Packages/CMUXAgentLaunch AgentLaunchSanitizer.swift (+ PrimaryPolicies/AdditionalPolicies) preservedArguments(kind:args:) / preservedCodexForkArguments(); AgentLaunchEnvironmentPolicy.selectedEnvironment() filters env keys (drops secrets, keeps Claude auth-selection keys via CMUX_PRESERVE_CLAUDE_AUTH_SELECTION_ENV). removingSavedWorkingDirectoryOptions strips redundant cwd flags.
- **Windows approach:** Direct clean-room port of the per-agent allow/deny flag policy tables to Go (pure data + string logic, no OS dependency). Env secret-key denylist is identical cross-platform. This is the highest-fidelity port target since it is platform-agnostic and well unit-tested in cmux (AgentLaunchSanitizerTests).
- **Deps:** session resume feature (consumes it)

### [todo/P2/M] Agent conversation fork
- **Behavior:** Fork an agent conversation into a new branch from the saved session (e.g. `claude --resume <id> --fork-session`, `codex fork <id>`, `opencode --session <id> --fork`). Available for agents that support forking; OpenCode is gated on version >= 1.14.50 via a live --version probe.
- **Shortcut/CLI:** (ContentView+ForkAgentConversation action / fork command built by AgentForkSupport)
- **cmux impl:** Sources/AgentForkSupport.swift supportsFork(snapshot:) checks forkCommand != nil and runs an OpenCode `--version` probe (cached, with a ProcessTerminationGate + timeout) comparing SemanticVersion to minimumOpenCodeForkVersion. AgentResumeCommandBuilder.forkArguments() builds the fork argv for claude/codex/opencode/claudeTeams/codexTeams/omo.
- **Windows approach:** Port forkArguments + supportsFork to Go. The version probe is exec.Command(opencode --version) with a context.WithTimeout (much simpler than the Swift Process gate). Surface a 'Fork conversation' action in the UI/command palette. Pure-logic + one subprocess, no OS-specific concerns beyond exec.
- **Deps:** session resume, launch sanitizer, command palette (other area)

### [todo/P3/XL] Agent hibernation (free idle background terminals)
- **Behavior:** Opt-in. When live restorable-agent terminals exceed a configured limit, cmux hibernates the oldest idle ones: terminates the scoped agent process and shows a placeholder pane that auto-resumes (runs the saved resume command) when you revisit its tab. A manual Resume button is the fallback. Hibernates only when the agent lifecycle is idle, the tail is stable, the pane is offscreen, and it has been idle past the threshold.
- **Shortcut/CLI:** cmux agent-hibernation on | cmux agent-hibernation off (also Settings > Terminal > Agent Hibernation; idleSeconds/maxLiveTerminals in cmux.json)
- **cmux impl:** Sources/App/AgentHibernationController.swift: 30s timer evaluates AgentHibernationPlannerInput; AgentHibernationPlanner.selectedPanelKeys picks excess idle panes; double-confirms via scrollback tail fingerprint (readTerminalTextForHibernationFingerprint, 12 lines) before terminateScopedProcessesForHibernation (SIGTERM to scoped pgid/pid) and workspace.enterAgentHibernation. AgentHibernationLifecycleState.allowsHibernation==idle. CLI handler at cmux.swift agent-hibernation on/off.
- **Windows approach:** Large, depends on session-resume + lifecycle tracking first. Port the planner (pure logic). Scrollback tail fingerprint = read last 12 xterm.js buffer lines. Process termination on Windows: track the agent process tree (Job Object per pane, or GenerateConsoleCtrlEvent / TerminateProcess on the ConPTY child) instead of POSIX process-group SIGTERM. Placeholder pane = render a 'hibernated' leaf overlay in layout.ts that re-runs the resume command on focus. Defer until resume + lifecycle land.
- **Deps:** session resume, launch sanitizer, lifecycle tracking via hooks, scrollback access, per-pane process-tree tracking, settings UI

### [todo/P2/M] Custom surface resume commands (cmux surface resume)
- **Behavior:** Attach an arbitrary resume command to the current terminal surface for tools with their own durable state (tmux sessions, custom agent CLIs). `set` binds a command (with --kind/--checkpoint/--shell or `-- argv`), `show` prints it (or --json), `clear` removes it. The binding survives quit/relaunch. By default CLI/socket-created bindings are stored for inspection/manual restore only; auto-run requires user approval of a signed command prefix.
- **Shortcut/CLI:** cmux surface resume set --kind tmux --checkpoint work --shell "tmux attach -t work" | cmux surface resume show --json | cmux surface resume clear --checkpoint work
- **cmux impl:** CLI/cmux.swift runSurfaceResumeCommand() -> socket methods surface.resume.set/get/clear with params (command, kind, checkpoint_id, source, cwd). Stored as SurfaceResumeBindingSnapshot (SurfaceResumeBindingIndex in RestorableAgentSession.swift); live tmux bindings are process-detected and auto-trusted.
- **Windows approach:** Add `scanline surface resume set/show/clear` to the Go CLI mapping to new named-pipe methods surface.resume.set/get/clear; the Rust side persists the binding keyed by workspace+pane id in a JSON store, and the session-restore path runs trusted bindings. argv form avoids shell-quoting issues. The tmux auto-detect case is N/A on Windows (no tmux) so only explicit --shell bindings matter; --shell runs through cmd.exe/pwsh.
- **Deps:** session restore, named-pipe protocol extension, resume-command trust

### [todo/P3/M] Signed resume-command trust / approval
- **Behavior:** A process can propose a surface resume command but cannot make it auto-run without the user choosing Auto-Restore or Ask Each Time. Approvals are prefix-based, signed by cmux, and also bind the working directory and exact env values. Sensitive env keys (tokens/passwords/secrets/API keys) are dropped before storing. Approvals are reviewed/edited in Settings > Terminal > Resume Commands.
- **Shortcut/CLI:** (approval prompt on restore; managed in Settings > Terminal > Resume Commands)
- **cmux impl:** Sources/CmuxActionTrust.swift: CmuxActionTrustDescriptor (actionID/kind/command/target/cwd...) -> SHA256 fingerprint; CmuxActionTrust.shared persists trusted fingerprints to Application Support/cmux/trusted-actions.json; isTrusted/trust gate auto-run. Sensitive env stripping happens before binding storage.
- **Windows approach:** Port CmuxActionTrust to Rust: store trusted SHA256 fingerprints under %APPDATA%/scanline/trusted-actions.json (CryptoKit -> sha2 crate). Show a WebView2 dialog (Auto-Restore / Ask Each Time / Never) on first auto-run attempt. Env secret-key denylist identical. Pure logic + a dialog; no platform blockers.
- **Deps:** Custom surface resume commands, settings UI

### [todo/P2/L] Feed bridge hooks (approval/permission cards)
- **Behavior:** Installed alongside lifecycle hooks for most agents: when the agent requests a tool/permission/plan/question, a second hook calls `cmux hooks feed --source <agent> --event <name>` (120s timeout) which surfaces an approval card in the Feed panel; the user's approve/deny flows back to the agent. Covers Codex (PreToolUse/PermissionRequest), Cursor (beforeShellExecution), Gemini/Copilot/CodeBuddy/Factory/Qoder/Antigravity (PreToolUse[/PostToolUse]), Hermes (pre/post tool + approval). Pi/Amp/Rovo have no Feed cards.
- **Shortcut/CLI:** cmux hooks feed --source <agent> --event <event> (invoked by agents)
- **cmux impl:** feedHookEvents in AgentHookDef installs the second hook; CLI runFeedHook + Sources/Feed/* (FeedCoordinator, FeedPanelView, FeedPermissionActionPolicy, FeedEventClassifier) render the card and block on the socket reply for the agent's decision.
- **Windows approach:** Add `scanline hooks feed` to the Go CLI that sends the event over the named pipe and BLOCKS for the user's reply (Rust holds the request until the Feed UI resolves). Build the Feed panel as DOM in the WebView2 frontend. Windows-specific: the 120s blocking read over the named pipe is fine with tokio. Deep work; depends on the whole hook + UI stack. Largely a UI-area feature but the hook plumbing lives here.
- **Deps:** hook installer, hook dispatch, named-pipe request/reply (currently fire-and-forget), Feed panel UI (other area)

### [todo/P1/M] Agent lifecycle / status reporting to UI
- **Behavior:** Hooks translate agent events into per-pane visible state: running (working), idle (done), needs-input (waiting on you), unknown. This drives the pane ring color, sidebar lifecycle, and hibernation eligibility. Also sets a per-agent status badge (icon/color/priority) and registers the agent PID for scope/stale detection.
- **Shortcut/CLI:** (internal socket: set_agent_lifecycle <key> <state>, set_status <key> <value> --icon --color --priority, set_agent_pid <key> <pid>)
- **cmux impl:** cmux.swift emits set_agent_lifecycle/set_status/set_agent_pid socket commands from the hook handlers; AgentHibernationLifecycleState enum (running/idle/needsInput/unknown) in AgentHibernation/. allowedStatusKeys whitelists the 15 agent keys. claudeCodeStatusKey path maps Stop->idle, prompt-submit->running, notification->needsInput.
- **Windows approach:** Extend the Scanline named-pipe protocol with set_agent_lifecycle / set_status / set_agent_pid methods; Rust stores per-pane lifecycle and emits an event the WebView2 frontend renders as a ring/badge on the grid leaf. The lifecycle enum + status-key whitelist port directly. PID registration uses the ConPTY child pid (already tracked for cleanup).
- **Deps:** named-pipe protocol extension, hook dispatch, ring/sidebar UI (other area)

### [todo/P3/L] Codex Teams (cmux codex-teams)
- **Behavior:** Launches Codex with cmux-managed subagent panes: a background watcher connects to the Codex app-server, observes spawned subagent threads, and opens each ready subagent as a native split (up to a max auto-depth of 2). Forwards remaining args to codex; supports `codex-teams resume --last`.
- **Shortcut/CLI:** cmux codex-teams [codex-args...] | cmux codex-teams resume --last | cmux codex-teams --model gpt-5.4
- **cmux impl:** cmux.swift runCodexTeams() launches codex with an app-server URL/port env (CMUX_CODEX_TEAMS_APP_SERVER_URL, MAX_AUTO_DEPTH) and spawns `cmux __codex-teams-watch` which JSON-RPCs the app-server, tracks thread depth/parent, and opens attachable subagent threads as panes (openObservedSubagent/openSubagent). Resume builder handles launcher 'codexTeams'.
- **Windows approach:** Port runCodexTeams + the watcher to Go: spawn codex with the app-server URL env, run a background `scanline __codex-teams-watch` goroutine that speaks the Codex app-server JSON-RPC over HTTP/socket, and call the named-pipe pane.split/new per ready subagent. No POSIX dependency; the watcher is network + pipe. Lower priority than Claude teams unless Codex usage is a target.
- **Deps:** tmux-compat/agent launch path, named-pipe split, Codex app-server protocol knowledge

### [todo/P3/L] Process-detected agent sessions (resume without hooks)
- **Behavior:** Even without hooks firing, cmux scans running processes to detect live agent sessions (matching CMUX scope env vars) so they can be resumed/hibernated. Augments the hook session index with currently-running agents.
- **Shortcut/CLI:** (internal; RestorableAgentSessionIndex.loadIncludingProcessDetectedSnapshots)
- **cmux impl:** Sources/VaultAgentProcessScanner.swift + RestorableAgentSessionIndex.processDetectedSnapshots() scan CmuxTopProcessSnapshot for processes whose env matches CMUX_AGENT_LAUNCH_KIND/workspace/surface scope (matchesCMUXScope), merging with hook records by session/panel.
- **Windows approach:** Port via Windows process enumeration: ToolHelp32Snapshot / NtQueryInformationProcess to read each process command line + environment block (reading another process env requires PROC_VM_READ; or have the launcher record pid+scope in a file at spawn so no remote-env read is needed — preferred on Windows). Match on a recorded SCANLINE_AGENT_LAUNCH_KIND/workspace/surface. Defer; the file-based launcher record sidesteps the hard Win32 env-read.
- **Deps:** session resume, agent launch records pid+scope at spawn

## cli-socket — CLI + socket/scripting API for automation

### [partial/P0/M] Socket request/response protocol (V2 JSON-RPC)
- **Behavior:** Every CLI command opens the socket, sends one JSON line {id,method,params}, reads back {ok:true,result:{...}} or {ok:false,error:{code,message,action,reason,details}}, and prints the structured result. Commands can RETURN data (ids, lists, URLs), not just fire-and-forget.
- **Shortcut/CLI:** (transport, underlies every command)
- **cmux impl:** cmux.swift sendV2() builds {id:UUID,method,params}, writes one line to the Unix socket, parses ok/result/error; formatV2Error() renders code/reason/action/details. Daemon-side mirror in daemon/remote cli.go socketRoundTripV2().
- **Windows approach:** Upgrade Scanline's named-pipe server: parse {id,method,params}, route to a Rust dispatcher that returns {ok,result|error} on the same pipe connection (today lib.rs handle_control_client only emits control://command to the frontend and acks a static {ok:true}). Add a per-request oneshot channel so the frontend (or Rust) can reply with a real result keyed by id. Keep one-line-JSON framing.
- **Deps:** Frontend command bus that can produce return values; pane/surface registry in Rust

### [todo/P3/S] V1 text protocol (legacy commands)
- **Behavior:** A handful of window-level commands (ping, list_windows, current_window, new_window, focus_window, close_window) use a plain text line in / text lines out, terminated by idle.
- **Shortcut/CLI:** ping, list-windows, current-window, new-window, focus-window, close-window
- **cmux impl:** cmux.swift sendV1Command(); daemon cli.go execV1() reads until newline+idle (120ms). Distinct from V2.
- **Windows approach:** Optional. Simpler to implement everything as V2 on Windows; only add V1 framing if reusing the exact cmux Go relay. Recommend skipping — collapse these into V2 window.* methods.
- **Deps:** V2 protocol

### [todo/P1/S] Arbitrary RPC passthrough (cmux rpc <method> [json])
- **Behavior:** Power-user/agent escape hatch: send any method name with raw JSON params and print the raw result. Lets scripts call methods the CLI has no wrapper for.
- **Shortcut/CLI:** cmux rpc <method> [json-params]
- **cmux impl:** cmux.swift case "rpc" (line 3487) and daemon cli.go runRPC() — marshals args[1] as params, calls socketRoundTripV2, prints result JSON.
- **Windows approach:** Add `scanline rpc <method> [json]` in cli/main.go that writes the JSON line verbatim to the pipe and prints the reply. Trivial once the V2 dispatcher exists.
- **Deps:** V2 protocol

### [todo/P1/L] Event stream subscription (cmux events)
- **Behavior:** Long-lived NDJSON stream of app events (notifications, feed items, surface/workspace changes). Supports --after <seq> replay, --cursor-file persistence, --name/--category filters, --reconnect (resume from last seq), --limit, --no-ack, --no-heartbeat. Core primitive for agents to react to app state.
- **Shortcut/CLI:** cmux events [--after <seq>] [--cursor-file <p>] [--name <e>] [--category <c>] [--reconnect] [--limit <n>] [--no-ack] [--no-heartbeat]
- **cmux impl:** CMUXCLI+Events.swift runEventsCommand() opens socket, calls streamV2(method:"events.stream", params:{after_seq,names,categories,include_heartbeats}); server pushes ack/event/heartbeat frames each with monotonic seq; CLI writes cursor file and reconnects on transient errors.
- **Windows approach:** Add an events.stream method on the pipe: keep the pipe connection open, push NDJSON frames {type:event|ack|heartbeat,seq,...} from a tokio broadcast channel fed by app state changes. Maintain a ring buffer of retained events for --after replay. CLI side: a Go loop reading lines, writing cursor file, reconnecting. Named pipes support full-duplex streaming so this works the same as Unix sockets.
- **Deps:** V2 protocol; an internal event bus in Rust/frontend that emits notification/feed/surface lifecycle events; notification system

### [partial/P2/S] Socket path discovery + variants
- **Behavior:** CLI auto-finds the running app's socket without config: tries default path, last-socket-path marker file, legacy/user-scoped paths, and discovers tagged dev/nightly/staging sockets by bundle id and CMUX_TAG. Lets multiple builds run side by side.
- **Shortcut/CLI:** (implicit; --socket / CMUX_SOCKET_PATH to override)
- **cmux impl:** CLISocketPathResolver.swift resolve()/candidatePaths() + CMUXSocketPathDomain SocketPathMarkerFiles; probes each candidate with a non-blocking connect() and prefers live listeners, then owned socket files.
- **Windows approach:** On Windows the pipe name \\.\pipe\scanline is a fixed global namespace — no path discovery needed for the single stable build (already done). For multi-build parity, derive pipe names per variant (\\.\pipe\scanline-nightly, -<tag>) and probe with CreateFile/WaitNamedPipe. Add --socket / SCANLINE_PIPE override. Drop the marker-file machinery (pipes are namespaced, not filesystem paths).
- **Deps:** V2 protocol

### [todo/P2/M] Socket authentication (password + relay HMAC)
- **Behavior:** Local socket can require a password (--password / CMUX_SOCKET_PASSWORD / Settings-stored); TCP relay (remote) does an HMAC-SHA256 challenge/response handshake using relay_id+token from ~/.cmux/relay/<port>.auth. Prevents other local/remote users from driving the app.
- **Shortcut/CLI:** --password <pw> (or CMUX_SOCKET_PASSWORD env)
- **cmux impl:** cmux.swift authenticateClientIfNeeded()/authenticateRelay(); password stored via Keychain (account local-socket-password); daemon cli.go authenticateRelayConn()/computeRelayMAC().
- **Windows approach:** Windows named pipes already enforce per-user/session ACLs by default (PIPE_REJECT_REMOTE_CLIENTS), so local auth is partly free. For an explicit password, add a first-line {auth:pw} handshake before accepting methods; store the password in Windows Credential Manager (wincred crate) instead of Keychain. Relay/remote auth is out of scope until SSH/remote lands.
- **Deps:** V2 protocol; settings storage

### [todo/P1/S] Capabilities discovery (cmux capabilities)
- **Behavior:** Returns the set of methods/features the running app supports, so agents can feature-detect before calling.
- **Shortcut/CLI:** cmux capabilities
- **cmux impl:** cmux.swift case at 3172 → sendV2("system.capabilities"); daemon also exposes it.
- **Windows approach:** Add a system.capabilities method returning a static JSON list of implemented methods/version. Cheap and high-value for agent scripting.
- **Deps:** V2 protocol

### [todo/P1/S] Ping / connectivity check (cmux ping)
- **Behavior:** Returns OK if the app is reachable on the socket; used by scripts/agents to wait for startup.
- **Shortcut/CLI:** cmux ping
- **cmux impl:** cmux.swift sendV1Command("ping"); daemon cli.go protoV1 ping.
- **Windows approach:** Add ping method to the pipe dispatcher returning {ok:true}. Trivial.
- **Deps:** V2 protocol

### [todo/P0/L] Handle resolution: refs / UUIDs / indexes
- **Behavior:** Every targeting flag (--workspace/--surface/--pane/--window) accepts a UUID, a short ref (window:1/workspace:2/pane:3/surface:4), or a 1-based index; tab-action also accepts tab:<n>. Output defaults to refs; --id-format uuids|both switches. Makes the CLI ergonomic for humans and stable for scripts.
- **Shortcut/CLI:** --workspace/--surface/--pane/--window <id|ref|index>; --id-format refs|uuids|both
- **cmux impl:** cmux.swift normalizeWindowHandle/normalizeWorkspaceHandle/normalizeSurfaceHandle resolve via list calls before dispatch; formatIDs() rewrites output ids per mode.
- **Windows approach:** Scanline currently has NO stable IDs at the CLI boundary (commands act on 'the focused pane' only). Introduce a registry: assign each grid leaf a stable surface id + ref, expose pane.list/surface.list, and let the Go CLI resolve index/ref→id before sending. layout.ts already has a binary tree; add ids to leaves and a resolver in Rust or the frontend.
- **Deps:** V2 protocol; pane/surface registry with stable ids; list methods

### [partial/P0/M] Caller-pane / context env vars (CMUX_WORKSPACE_ID, CMUX_SURFACE_ID, CMUX_TAB_ID)
- **Behavior:** Terminals spawned by the app export their workspace/surface ids; commands run inside a pane default their --workspace/--surface to that pane, so `cmux split` / `cmux notify` 'just work' targeting the caller without flags. Also used as the 'caller' for new-split placement.
- **Shortcut/CLI:** (implicit env defaults on every command)
- **cmux impl:** cmux.swift reads ProcessInfo env CMUX_WORKSPACE_ID/CMUX_SURFACE_ID/CMUX_TAB_ID as fallbacks across ~all command handlers; identify --caller passes caller={workspace_id,surface_id}.
- **Windows approach:** When Scanline spawns a pty (pty_spawn in lib.rs), inject SCANLINE_SURFACE_ID/SCANLINE_WORKSPACE_ID into that pty's environment keyed to the leaf id. CLI reads them as defaults. Today Scanline sets TMUX_PANE=%0 (a fake constant) but no per-pane real id — this is the missing 'caller-pane tracking' the brief calls out. Requires the stable-id registry first.
- **Deps:** Stable id registry; pty_spawn env injection

### [todo/P1/S] identify (resolve current/caller context)
- **Behavior:** Returns the active window/workspace/surface and (unless --no-caller) the caller's workspace/surface — lets a script discover where it is.
- **Shortcut/CLI:** cmux identify [--workspace] [--surface] [--window] [--no-caller]
- **cmux impl:** cmux.swift case "identify" (3497) → system.identify with optional caller{}.
- **Windows approach:** Add system.identify returning focused leaf id/ref + caller from env. Depends on registry + env injection.
- **Deps:** Stable id registry; caller env vars

### [partial/P0/M] Split a pane via CLI (new-split / new-pane / new-surface)
- **Behavior:** new-split <left|right|up|down> splits a target surface directionally; new-pane creates a split pane of --type terminal|browser with optional --url; new-surface adds a surface (tab) to a pane. All accept --focus.
- **Shortcut/CLI:** cmux new-split <dir>; cmux new-pane [--type] [--direction] [--url]; cmux new-surface [--type] [--url]
- **cmux impl:** cmux.swift cases 3692/3795/3812 → surface.split / pane.create / surface.create; daemon cli.go maps the same with defaultParams direction:right.
- **Windows approach:** Scanline already does pane.split over the pipe (dir row|col, optional command) wired to layout.ts. Add directional dirs (left/right/up/down), --type browser (route to existing browser.open path), and return the new surface id. Mostly mapping work on top of existing split.
- **Deps:** V2 result payloads; stable id registry; existing tiling grid (done); browser pane (done)

### [done/P1/S] Run a command in a new pane
- **Behavior:** Splitting can carry an initial command line (first positional / --command / initial_command) that the new terminal runs on spawn.
- **Shortcut/CLI:** cmux new-pane --command <cmd> (and tmux split-window <cmd>)
- **cmux impl:** daemon cli.go maps --command→initial_command, also first positional; surface.create/pane.create honor it.
- **Windows approach:** Already implemented: `scanline run -- <cmd>` and `scanline split -- <cmd>` send pane.split with a command that ConPTY runs. Parity good; just align param name initial_command and accept a positional.
- **Deps:** pane.split (done)

### [partial/P0/S] Close a pane/surface via CLI (close-surface)
- **Behavior:** Closes a target surface (or the caller's). Grid rebalances.
- **Shortcut/CLI:** cmux close-surface [--surface]
- **cmux impl:** cmux.swift case 3849 → surface.close.
- **Windows approach:** Scanline has `scanline close` → pane.close (closes the FOCUSED pane only). Add --surface targeting via the id registry so scripts can close a specific pane, not just the focused one.
- **Deps:** Stable id registry; close (focused) done

### [partial/P1/S] Focus a pane via CLI (focus-pane / directional focus)
- **Behavior:** focus-pane --pane targets a specific pane; tmux select-pane -L/-R/-U/-D moves focus directionally.
- **Shortcut/CLI:** cmux focus-pane --pane <id>; (directional via tmux select-pane)
- **cmux impl:** cmux.swift case 3780 → pane.focus.
- **Windows approach:** Scanline has `scanline focus <left|right|up|down>` → pane.focus dir (directional only, done). Add pane.focus by explicit id for scripted targeting.
- **Deps:** Stable id registry; directional focus done

### [todo/P0/M] send-text to a pane (cmux send)
- **Behavior:** Writes literal text (with escape unescaping like \n) to a target terminal's input, as if typed. The primitive for driving an agent/REPL from a script.
- **Shortcut/CLI:** cmux send [--surface] <text>
- **cmux impl:** cmux.swift case 4106 → surface.send_text; daemon maps send→surface.send_text; tmux send-keys also routes here. unescapeSendText handles \n etc.
- **Windows approach:** Add surface.send_text method: look up the leaf's pty by id and call the existing pty_write (byte-accurate input already works). Need the id registry to pick the right pty; without it, target the focused pane. This is the brief's 'send-keys to a pane (NOT done)'.
- **Deps:** Stable id registry; pty_write (done)

### [todo/P0/M] send-key to a pane (cmux send-key)
- **Behavior:** Sends a named key/chord (Enter, C-c, Tab, Escape, etc.) to a terminal — distinct from literal text. Lets scripts press control keys.
- **Shortcut/CLI:** cmux send-key [--surface] <key>
- **cmux impl:** cmux.swift case 4126 → surface.send_key; tmux_compat.go maps c-c/c-d/enter/tab/escape/space/bspace to control bytes (lines 1291+).
- **Windows approach:** Add surface.send_key: translate key names → control byte sequences in Rust (reuse the same table cmux's tmux_compat uses, e.g. c-c→0x03, enter→0x0d, tab→0x09, escape→0x1b) and write to the pty. Port the key-name map.
- **Deps:** surface.send_text plumbing; key-name→bytes table

### [todo/P3/S] send/send-key to a panel by id (send-panel / send-key-panel)
- **Behavior:** Same as send/send-key but explicitly targets a --panel handle (panels are right-sidebar surfaces). Niche.
- **Shortcut/CLI:** cmux send-panel --panel <id> <text>; cmux send-key-panel --panel <id> <key>
- **cmux impl:** cmux.swift cases 4145/4167 → surface.send_text/send_key with panel resolved as a surface.
- **Windows approach:** Scanline has no panel/sidebar concept yet. Fold into send/send-key once a panel surface type exists; defer.
- **Deps:** Right sidebar/panels (not in Scanline); send-text

### [todo/P1/M] read-screen / capture-pane (scrape terminal contents)
- **Behavior:** Returns the visible screen text (or full --scrollback / last --lines N) of a terminal so a script can read what an agent printed. capture-pane is the tmux-compat alias.
- **Shortcut/CLI:** cmux read-screen [--scrollback] [--lines <n>]; cmux capture-pane [...]
- **cmux impl:** cmux.swift cases 4065/4487 → surface.read_text; tmux capture-pane routes here.
- **Windows approach:** xterm.js holds the buffer client-side. Add surface.read_text that asks the frontend (over the new id-keyed command bus) to serialize the addon buffer (term.buffer.active lines, with @xterm/addon-serialize for scrollback) and return it as the V2 result. No native API needed — DOM/JS side.
- **Deps:** V2 result payloads; stable id registry; xterm serialize addon

### [partial/P0/M] notify (post a notification)
- **Behavior:** Posts a notification (title/subtitle/body) attributed to a workspace/surface; drives the ring + sidebar badge + panel. Wired into agent hooks so agents signal 'I need you'.
- **Shortcut/CLI:** cmux notify --title <t> [--subtitle] [--body] [--workspace] [--surface]
- **cmux impl:** cmux.swift case 4189 → notification.create; daemon maps notify→notification.create.
- **Windows approach:** Scanline has `scanline notify <text>` but it only console.logs in the frontend (NO UI). Build notification.create to: store the notification, render a ring/badge in the grid leaf, and (P1) raise a WinAppSDK/Tauri toast. This is the bridge into the separate notifications area; the CLI verb itself is the easy part.
- **Deps:** Notification model + ring/badge UI (separate area); V2 protocol

### [todo/P2/M] Notification management commands
- **Behavior:** list-notifications, dismiss-notification (--id|--all-read), mark-notification-read, open-notification --id, jump-to-unread, clear-notifications — full CRUD over the notification list from scripts.
- **Shortcut/CLI:** cmux list-notifications | dismiss-notification | mark-notification-read | open-notification | jump-to-unread | clear-notifications
- **cmux impl:** cmux.swift cases 4259-4360 → notification.dismiss/mark_read/open/jump_to_unread.
- **Windows approach:** CLI wrappers over notification.* methods once a notification store exists in Rust/frontend. Mechanical after the store lands.
- **Deps:** Notification store/panel (separate area)

### [todo/P2/L] Sidebar status / progress / log API
- **Behavior:** set-status/clear-status/list-status attach key→value badges (with icon/color/priority) to a workspace's sidebar row; set-progress/clear-progress show a progress bar; log/clear-log/list-log append a per-workspace log line. Lets agents surface live metadata.
- **Shortcut/CLI:** cmux set-status <k> <v> [--icon --color --priority]; set-progress <0-1>; log <msg>
- **cmux impl:** cmux.swift cases 4360-4432; these are app-state mutations rendered in the sidebar (no single V2 method shown — handled app-side).
- **Windows approach:** Requires the sidebar/metadata feature (a separate area, not in Scanline). CLI verbs are thin; build them after the sidebar exists. Store status/progress/log per workspace id and render in the DOM sidebar.
- **Deps:** Sidebar with workspace metadata (separate area); stable workspace ids

### [todo/P2/XL] Workspace lifecycle CLI (new/list/close/select/rename/current)
- **Behavior:** new-workspace (--name --description --cwd --command --layout), list-workspaces, close-workspace, select-workspace, rename-workspace, current-workspace — script-create and navigate workspaces (the cmux 'tab' concept above panes).
- **Shortcut/CLI:** cmux new-workspace | list-workspaces | close-workspace | select-workspace | rename-workspace | current-workspace
- **cmux impl:** cmux.swift cases 3636-4065 → workspace.create/list/close/select/rename/current; daemon cli.go mirrors create/list/close/select/current.
- **Windows approach:** Scanline has a single grid, no workspace/tab layer. Building workspaces is a large structural feature (the vertical/horizontal tabs area). The CLI surface is mechanical once that model exists; expose workspace.* methods then.
- **Deps:** Workspace/tab model (separate area); V2 protocol

### [todo/P3/XL] Surface (tab-within-pane) lifecycle CLI
- **Behavior:** surface.list/create/close/focus/move/split-off/reorder, rename-tab, tab-action, drag-surface-to-split, move-surface, move-tab-to-new-workspace — full manipulation of stacked surfaces within a pane.
- **Shortcut/CLI:** cmux new-surface | close-surface | move-surface | split-off | reorder-surface | rename-tab | tab-action
- **cmux impl:** cmux.swift cases 3600-3875, 7186 → surface.* and tab.action methods.
- **Windows approach:** Scanline panes are single-surface (one pty or one webview per leaf). Surfaces-within-a-pane (tab stacks) is a model addition. Defer; expose surface.* CLI after the model exists.
- **Deps:** Surface stacking model (separate area)

### [todo/P3/L] Window management CLI (multi-window)
- **Behavior:** list-windows, current-window, new-window, focus-window, close-window, move-workspace-to-window — script across multiple top-level windows.
- **Shortcut/CLI:** cmux list-windows | new-window | focus-window | close-window | move-workspace-to-window
- **cmux impl:** cmux.swift cases 3540-3585 → window.list/current + V1 new_window/focus_window/close_window.
- **Windows approach:** Scanline is single-window. Tauri supports multiple WebviewWindows; add window.* methods that create/focus/close Tauri windows. Each window needs its own grid state. Defer until multi-window is a goal.
- **Deps:** Multi-window support (non-goal today)

### [todo/P3/L] Workspace ordering & grouping CLI
- **Behavior:** reorder-workspace/reorder-workspaces, workspace-group (list/create/delete/rename/add/remove/pin/collapse/set-color/set-icon/move/focus) — organize sidebar workspaces into collapsible colored groups, scriptably.
- **Shortcut/CLI:** cmux reorder-workspace; cmux workspace-group <sub>
- **cmux impl:** cmux.swift cases 6335-7188 → workspace.reorder(_many) + workspace.group.* methods.
- **Windows approach:** Depends entirely on the workspace+sidebar model. Defer with workspaces.
- **Deps:** Workspace model; sidebar groups (separate area)

### [todo/P2/L] Process/resource introspection (top / tree / memory)
- **Behavior:** top shows live CPU/mem/process counts per pane (tree or tsv, sortable); tree prints the window/workspace/pane/surface hierarchy; memory shows memory grouped. Read-only observability for scripts/dashboards.
- **Shortcut/CLI:** cmux top [--processes --sort cpu|mem|proc --format tree|tsv]; cmux tree [--all]; cmux memory
- **cmux impl:** cmux.swift cases 3774/3771/3777 → system.top/system.tree + CMUXCLI+TopRendering.swift.
- **Windows approach:** Add system.tree (serialize the layout binary tree + leaf ids/types — easy). system.top: for each pty, walk its child process tree and sample CPU/RAM via Windows toolhelp (CreateToolhelp32Snapshot) or sysinfo crate keyed by the ConPTY process group. Render tsv/tree in the Go CLI.
- **Deps:** Stable id registry; pty→pid tracking in PtyManager

### [todo/P0/M] Pane introspection lists (list-panes / list-pane-surfaces / list-panels)
- **Behavior:** Enumerate panes in a workspace, surfaces in a pane, and sidebar panels — the read side scripts use to find ids before acting.
- **Shortcut/CLI:** cmux list-panes | list-pane-surfaces | list-panels
- **cmux impl:** cmux.swift cases 3716/3742/3971 → pane.list / pane.surfaces / surface.list.
- **Windows approach:** Add pane.list returning the grid leaves (id, ref, type terminal|browser, focused, geometry) by serializing layout.ts state. Foundational for the id registry and most other commands. Build this early.
- **Deps:** V2 result payloads; stable id registry

### [partial/P1/XL] Browser scripting CLI (~70 methods)
- **Behavior:** Full agent-browser-style surface: open/navigate/back/forward/reload, snapshot (a11y tree, --interactive/--compact/--selector), eval JS, wait (selector/text/url/function), click/dblclick/hover/focus/check/uncheck/type/fill/press/select/scroll, screenshot, get url|title|text|html|value|attr|count|box|styles, is visible|enabled|checked, find by role/text/label/etc, frame, dialog accept/dismiss, download, cookies/storage get/set/clear, tabs new/list/switch/close, console/errors list, highlight, state save/load, addinitscript/addscript/addstyle, viewport/geolocation/offline/network route+unroute+requests, profiles, import.
- **Shortcut/CLI:** cmux browser <subcommand> ... (open|navigate|snapshot|eval|click|fill|type|press|screenshot|get|find|cookies|tab|...)
- **cmux impl:** cmux.swift cases 11158-12296 + daemon cli.go browserCommands map → browser.* V2 methods; semantics ported from vercel-labs/agent-browser.
- **Windows approach:** Scanline has a PROVEN CDP spike (CallDevToolsProtocolMethod via with_webview: Runtime.evaluate, Accessibility.getFullAXTree, Page.captureScreenshot all work) plus URL bar/back/forward/reload UI — but it is NOT yet a method API. Build browser.* methods on the pipe, each mapping to one or more CDP calls on the target WebView2 (navigate=Page.navigate; click/fill/snapshot=eval+AX tree+Input.dispatch*; screenshot=Page.captureScreenshot; cookies=Network.getCookies/setCookie; eval=Runtime.evaluate). This is the single largest CLI sub-area. Scope P0 to navigate/eval/snapshot/click/fill/screenshot/get-url; defer profiles/import/network-route/tabs.
- **Deps:** V2 result payloads; browser pane (done); CDP bridge (spiked); per-browser surface id targeting

### [todo/P2/M] open <path-or-url> (smart open)
- **Behavior:** cmux <path> opens a directory as a new workspace; `open` resolves files/dirs/URLs into the right surface (markdown viewer, browser, terminal cwd). The top-level convenience entry point.
- **Shortcut/CLI:** cmux <path>; cmux open <path-or-url>... [--workspace --surface --pane --window --focus]
- **cmux impl:** cmux.swift cmux_open.swift + case dispatch; routes to workspace.create / markdown.open / browser.navigate.
- **Windows approach:** Add a Go-side `scanline open <arg>`: if URL → browser.open (done path); if .md → defer (no markdown viewer); else → pane.split with cwd set to the dir. Partial value now (url + dir); full smart-open waits on workspaces/markdown.
- **Deps:** Workspace model for the 'new workspace from dir' case; browser.open (done)

### [partial/P2/M] Agent launch wrappers (claude-teams / codex-teams / omo / omx / omc)
- **Behavior:** One command launches a coding agent in 'teammate' mode with cmux integration so teammates spawn as native splits with sidebar metadata + notifications, no tmux needed.
- **Shortcut/CLI:** cmux claude-teams [args]; cmux codex-teams; cmux omo|omx|omc [args]
- **cmux impl:** cmux.swift cases 12813-12921 + daemon cli.go runClaudeTeamsRelay/runOMO/OMX/OMCRelay; set env, install hooks, exec the agent.
- **Windows approach:** Scanline has the generic agent-launch path (`scanline <agent>` writes a tmux.cmd shim, prepends PATH, sets TMUX/TMUX_PANE/SCANLINE_BIN, execs the agent). Named teammate wrappers can be thin aliases that set the right env and call the same launcher. Sidebar-metadata/teammate features depend on other areas; the launch glue is largely done.
- **Deps:** Agent launch (done); sidebar metadata + notifications for the 'teammate' UX (separate areas)

### [todo/P1/L] Agent hooks install/manage (cmux hooks)
- **Behavior:** hooks setup auto-installs supported agents' notification/resume hooks; `hooks <agent> install|uninstall|event`; per-event subcommands (session-start, prompt-submit, stop/idle, notification, pre-tool-use, session-end) that the agent invokes to drive cmux. Supports Claude Code, Codex, Grok, OpenCode, Pi, Amp, Cursor, Gemini, Copilot, etc.
- **Shortcut/CLI:** cmux hooks setup [--agent <n>]; cmux hooks <agent> install|uninstall; cmux <agent>-hook <event>
- **cmux impl:** cmux.swift cases 4448-4466 + CMUXCLI+AgentHookDefinitions.swift / +HermesAgentHooks.swift; writes agent config files and routes hook events to notification.create / surface.resume.set.
- **Windows approach:** Scanline only has the tmux-shim path. Build a `scanline hooks setup` that writes each agent's hook config (e.g. Claude Code settings.json hooks) pointing at `scanline <event>` commands, which then call notify/surface.resume.set over the pipe. Port the per-agent config templates from AgentHookDefinitions. Sizeable but mechanical; depends on notifications + resume existing.
- **Deps:** notify (P0); surface.resume API; per-agent config templates

### [todo/P2/L] Surface resume bindings (cmux surface resume set/show/clear)
- **Behavior:** Attach a durable resume command (--kind tmux/agent, --checkpoint, --shell '...') to a surface so session-restore can relaunch it. Trust model: public CLI/socket bindings are stored for inspection only unless a signed prefix is approved; secrets stripped.
- **Shortcut/CLI:** cmux surface resume set --kind <k> --checkpoint <c> --shell '<cmd>'; surface resume show|clear
- **cmux impl:** cmux.swift cases 3840/5881-5989 → surface.resume.set/get/clear; trust/approval logic app-side.
- **Windows approach:** Add surface.resume.set/get/clear storing a binding per leaf id (serde to disk). On session restore, re-run trusted bindings. The trust/approval+secret-stripping policy is the hard part; MVP can store-only (no auto-run) for safety. Depends on session-restore existing.
- **Deps:** Session restore (not in Scanline); stable id registry

### [todo/P2/L] session restore CLI (restore-session)
- **Behavior:** Re-opens the previous session (window/workspace/pane layout, cwds, scrollback best-effort, browser URLs, and resumable agent sessions).
- **Shortcut/CLI:** cmux restore-session; (Cmd+Shift+O in-app)
- **cmux impl:** cmux.swift case 12707 → session.restore_previous.
- **Windows approach:** Add session.restore_previous that reads a saved layout/state file and rebuilds the grid (split tree + pane types + cwds). Persist on exit. The CLI verb is trivial once persistence exists; persistence itself is a separate feature.
- **Deps:** Session persistence (separate area); layout serialize/deserialize

### [partial/P0/L] tmux compatibility layer (__tmux-compat)
- **Behavior:** A tmux shim on PATH lets unmodified agents that shell out to tmux drive cmux: split-window→split, select-pane→focus, kill-pane→close, send-keys→send_text, capture-pane→read_text, list-windows/list-panes, rename-window, resize-pane, display-message (with #{format} rendering), has-session, select-layout, wait-for, plus ~20 verbs total; recognizes key names (c-c, enter, tab...).
- **Shortcut/CLI:** (transparent: agent calls `tmux <cmd>`, shim forwards to __tmux-compat)
- **cmux impl:** daemon tmux_compat.go dispatchTmuxCommand() maps ~20 tmux verbs → V2 methods; renders tmux #{format} vars; maps key names to control bytes.
- **Windows approach:** Scanline's cli/tmux.go shim covers only 3 verbs (split-window, select-pane, kill-pane) + agent launch. Extend dispatch to send-keys (→send_text/send_key, the biggest gap), capture-pane (→read_text), list-windows/list-panes, display-message with #{} rendering, rename-window, resize-pane, has-session, select-layout, wait-for. Port the key-name→byte table. Pure Go, MIT clean-room, no app changes beyond the underlying methods.
- **Deps:** surface.send_text/send_key; read_text; pane.list; stable id registry

### [todo/P1/M] display-message / format-string rendering
- **Behavior:** tmux display-message -p '#{pane_current_path}' (and friends) returns rendered values; agents use it to query state. Full #{...} variable substitution (session_name, window_index, pane_current_path, etc).
- **Shortcut/CLI:** (via tmux display-message); cmux display-message [-p] <text>
- **cmux impl:** cmux.swift case 13962 + tmux_compat.go tmuxRenderFormat()/tmuxFormatContext() build a var map from workspace/pane state and substitute #{var}.
- **Windows approach:** Implement in the Go shim: build a context map from pane.list/identify results and substitute #{} vars (regex like cmux's tmuxFormatVarRe). Needs the underlying list/identify methods to populate real values; can ship with a minimal var set.
- **Deps:** pane.list; identify; tmux-compat layer

### [todo/P3/L] tmux buffer/paste/misc compat (set-buffer, paste-buffer, list-buffers, swap/break/join-pane, clear-history, wait-for, set-hook, popup)
- **Behavior:** Lower-traffic tmux verbs: clipboard buffers, pane swap/break/join, clear scrollback, signal wait-for (script sync), set-hook, popup. Provided for broad tmux-script compatibility.
- **Shortcut/CLI:** cmux set-buffer | paste-buffer | swap-pane | break-pane | join-pane | clear-history | wait-for | set-hook | popup
- **cmux impl:** cmux.swift cases 13786-13962 → pane.swap/break/join, surface.clear_history, plus buffer/hook handlers; tmux_compat.go dispatches the aliases.
- **Windows approach:** Implement opportunistically: clear-history→clear xterm buffer (easy); wait-for→a simple signal map in Rust; swap/break/join→layout tree ops; buffers→an in-memory clipboard. Most are low priority vs send-keys/capture. Defer the rare ones.
- **Deps:** Layout tree ops; stable id registry; tmux-compat layer

### [todo/P3/S] trigger-flash / flash focused panel
- **Behavior:** Flashes a pane's border to visually locate it (Cmd+Shift+H in-app; trigger-flash via CLI).
- **Shortcut/CLI:** cmux trigger-flash [--surface]
- **cmux impl:** cmux.swift case 3927 → surface.trigger_flash.
- **Windows approach:** Add surface.trigger_flash → frontend pulses the leaf's border CSS animation. Trivial DOM effect once id targeting exists.
- **Deps:** Stable id registry

### [todo/P3/M] reload-config / refresh-surfaces / debug commands
- **Behavior:** reload-config reloads app+ghostty config and refreshes terminals in place; refresh-surfaces re-renders; debug-terminals/surface-health dump diagnostic state for support.
- **Shortcut/CLI:** cmux reload-config | refresh-surfaces | surface-health | debug-terminals
- **cmux impl:** cmux.swift cases 3878-3927 → surface.refresh / surface.health / debug.terminals.
- **Windows approach:** reload-config: re-read Scanline's config (theme/settings) and re-style xterm instances — depends on a settings system existing. refresh-surfaces/debug-terminals: serialize pty/leaf state for diagnostics. Low priority until config/settings land.
- **Deps:** Settings/config system (not in Scanline); pane registry

### [todo/P3/L] feed commands (interactive agent feed replies)
- **Behavior:** feed list shows pending agent prompts; feed.permission.reply / exit_plan.reply / question.reply answer Claude-style permission/plan/question prompts from the CLI or feed UI.
- **Shortcut/CLI:** cmux feed tui|clear; (replies via feed.* RPC)
- **cmux impl:** cmux.swift cases 12734/29268-29606 → feed.list, feed.permission.reply, feed.exit_plan.reply, feed.question.reply.
- **Windows approach:** Requires the feed/notification UI and agent hook integration. Defer; build after notifications + hooks exist.
- **Deps:** Notifications/feed UI; agent hooks

### [todo/P3/XL] VM / cloud sandbox CLI (cmux vm)
- **Behavior:** vm new/ls/rm/shell/ssh/ssh-info/exec — manage cloud dev sandboxes and attach to them as workspaces.
- **Shortcut/CLI:** cmux vm <new|ls|rm|shell|ssh|exec> (alias: cloud)
- **cmux impl:** cmux.swift cases 3246-3487 → vm.list/create/destroy/exec/attach_info/ssh_info; requires auth/account.
- **Windows approach:** Out of scope — depends on cmux's hosted backend/account. Non-goal for Scanline.
- **Deps:** Hosted cloud backend + auth (non-goal)

### [todo/P3/XL] SSH remote workspace CLI (cmux ssh + ssh-session-*)
- **Behavior:** cmux ssh user@host creates a workspace on a remote machine (browser panes route through the remote network); ssh-session-list/attach/cleanup manage remote PTY sessions.
- **Shortcut/CLI:** cmux ssh <dest> [--port --identity --ssh-option]; cmux ssh-session-list|attach|cleanup
- **cmux impl:** cmux.swift cases 3302-3669 + CMUXCLI+SSHCommandSupport.swift → workspace.remote.configure / pty_sessions / pty_attach; relays over TCP to cmuxd-remote on the host.
- **Windows approach:** Out of scope short-term (the brief lists SSH/remote as NOT done). Would need a Windows port of cmuxd-remote + relay auth + remote pty bridging. Defer.
- **Deps:** Remote daemon; relay auth; remote pty bridge (none in Scanline)

### [todo/P3/M] auth/login/logout CLI
- **Behavior:** auth status/login/logout manage the user's cmux account session (for cloud/feedback features).
- **Shortcut/CLI:** cmux auth <status|login|logout>; cmux login|logout
- **cmux impl:** cmux.swift cases 3179-3246 → auth.status/begin_sign_in/sign_out.
- **Windows approach:** Out of scope — tied to cmux's hosted account. Non-goal.
- **Deps:** Hosted account backend (non-goal)

### [todo/P3/M] markdown open / diff viewer CLI
- **Behavior:** markdown open <path> shows a formatted markdown viewer panel with live reload; diff opens a git/patch source in a browser split (split or unified layout).
- **Shortcut/CLI:** cmux markdown open <path>; cmux diff [patch|-] [--source unstaged|staged|branch|last-turn]
- **cmux impl:** cmux.swift cases 4563/14422 → markdown.open / a diff-rendering browser surface.
- **Windows approach:** Both render in a WebView2 surface (which exists). Add markdown.open (render md→html in a webview, watch file for reload) and diff (run git.exe diff, render to html). Useful but depends on a generic 'html content surface' beyond the URL-loading browser pane.
- **Deps:** Browser/HTML surface (partial); git.exe integration

### [todo/P3/S] feedback CLI (cmux feedback)
- **Behavior:** Opens or submits in-app feedback (email/body/images) to the cmux team.
- **Shortcut/CLI:** cmux feedback [--email --body --image]
- **cmux impl:** cmux.swift case 12716 → feedback.open / feedback.submit.
- **Windows approach:** Out of scope — posts to cmux's backend. Non-goal.
- **Deps:** Hosted backend (non-goal)

### [todo/P3/S] docs/settings/shortcuts/welcome help CLI
- **Behavior:** docs [topic], settings [open|path], shortcuts, welcome, config doctor/validate/path — discover config locations, print the shortcut table, run config diagnostics. Agent-facing self-documentation.
- **Shortcut/CLI:** cmux docs|settings|shortcuts|welcome|config <doctor|validate|path|reload>
- **cmux impl:** cmux.swift cases 12655-12784 + CMUXCLI+DocsSettings.swift; mostly local (prints docs, opens files), some via config.reload.
- **Windows approach:** Implement locally in the Go CLI where possible (print shortcut table, print settings path). config reload depends on a settings system. Low priority; partly local-only so cheap to start.
- **Deps:** Settings/config system for the reload/doctor parts

## palette-commands

### [todo/P1/L] Command palette overlay (command mode)
- **Behavior:** A centered modal overlay opens with a text field on top and a scrollable result list below. Typing fuzzy-filters all app commands (split, new tab, toggle sidebar, settings toggles, custom commands, etc.). Arrow keys / Enter / mouse select and run a command; Esc dismisses and returns focus to the prior surface. Matched characters are highlighted in each row; each row shows a trailing label (the command's shortcut or its kind/section).
- **Shortcut/CLI:** Cmd+Shift+P (default; opens prefilled with '>' command prefix)
- **cmux impl:** ContentView state machine (ContentView.swift, CommandPaletteMode.commands, prefix '>' at commandPaletteCommandsPrefix). Window-attached overlay via WindowCommandPaletteOverlayController (ContentView.swift ~L619, identifier commandPaletteOverlayContainerIdentifier). Rows rendered by CommandPaletteCommandListRowsView (CommandPalette/CommandPaletteOverlay.swift) with debounced render via CommandPaletteOverlayRenderModel.scheduleCommandListUpdate. Opened via .commandPaletteToggleRequested/.commandPaletteRequested NotificationCenter events.
- **Windows approach:** Build as a DOM overlay in the WebView2 root document (absolute-positioned div with input + virtualized list), not a separate window — avoids a second WebView2/HWND. Capture Ctrl+Shift+P globally via a document keydown listener registered in main.ts (mirroring the existing xterm attachCustomKeyEventHandler approach used for other shortcuts). When open, blur the focused xterm/browser leaf and trap keys in the palette; on Esc/run, refocus the previously-focused leaf id tracked in layout.ts. Run selected commands by invoking the same Tauri commands the named-pipe control server exposes (pane.split/new/close/focus, browser.open) plus new ones.
- **Deps:** Fuzzy match engine; command registry; focus-restore tracking

### [todo/P2/M] Command palette switcher mode (go to workspace/surface)
- **Behavior:** Opens the same overlay but WITHOUT the '>' prefix, in 'switcher' scope: instead of commands it lists open workspaces/surfaces, fuzzy-searchable by title AND metadata (cwd/path tokens, git branch, listening ports, description). Selecting one jumps focus to that workspace/pane. An optional setting makes it search across all surfaces, not just the current workspace.
- **Shortcut/CLI:** Cmd+P (goToWorkspace default)
- **cmux impl:** CommandPaletteListScope.switcher (CommandPaletteSearchOrchestrator.swift). Switcher candidates indexed via CommandPaletteSwitcherSearchIndexer.keywords building metadata tokens from directories/branches/ports/description (CommandPalette/CommandPaletteSearch.swift). 'Searches all surfaces' toggle = CommandPaletteSwitcherSearchSettings (CommandPaletteSettingsToggle.swift). Presented via .commandPaletteSwitcherRequested.
- **Windows approach:** Reuse the same DOM overlay component with a scope flag. Build the candidate list from layout.ts leaf metadata (each leaf already has an id, kind, and title/url). Scanline currently has no workspaces/tabs/sidebar metadata, so v1 switcher = jump-to-pane within the current grid; cwd/branch/port tokens depend on sidebar metadata work landing first. Focus jump reuses the directional-focus / focus-by-id path already in layout.ts.
- **Deps:** Command palette overlay; pane metadata (cwd/branch/ports) which is a separate sidebar feature

### [todo/P1/M] Fuzzy match + ranking engine (Nucleo FFI + Swift fallback)
- **Behavior:** As the user types, results are scored and ordered: exact > prefix > word-prefix > substring (with boundary boost) > initialism (camel/word initials) > stitched word-prefix > single-edit typo tolerance > subsequence. Diacritic- and case-insensitive. Multi-token queries (space-separated) must all match. Matched character indices drive the highlight in each row.
- **Shortcut/CLI:** -
- **cmux impl:** Primary path is a Rust crate Native/CommandPaletteNucleoFFI exposing cmux_nucleo_index_create/_search/_destroy + cmux_nucleo_ffi_version (see cmuxTests/CommandPaletteNucleoFFILibrarySupport.swift — index built from a UTF-8 blob + span table). Pure-Swift fallback engine CommandPaletteSearchEngine + CommandPaletteFuzzyMatcher (CommandPalette/CommandPaletteSearch.swift) reproduces the same scoring; orchestrator merges a Swift single-edit fallback into Nucleo results (CommandPaletteSearchOrchestrator.swift).
- **Windows approach:** Two viable Windows paths: (a) implement matching in TypeScript using fzf-for-js or a small custom scorer in the renderer (zero native dep, fine for a few hundred commands); or (b) compile the Nucleo crate (helix-editor/nucleo, cross-platform Rust) into the Tauri Rust backend and expose a #[tauri::command] search(corpus, query) — no FFI dylib needed since it links straight into src-tauri. Recommend (b) reusing cmux's exact crate for parity. Highlight indices returned to the renderer to bold matched chars.
- **Deps:** Command palette overlay

### [todo/P1/M] Command registry + handlers (built-in commands)
- **Behavior:** The palette is populated by a registry of built-in commands (Flash Focused Panel, Task Manager, New Workspace/Window/Tab, Close, Split Right/Down, Browser open/back/forward/reload/devtools, Find, Find in Directory, Rename, etc.). Each command has an id, localized title, subtitle (its section), keywords, an optional 'when' availability predicate, and an associated keyboard shortcut shown as the trailing label.
- **Shortcut/CLI:** -
- **cmux impl:** CommandPaletteCommandContribution + CommandPaletteHandlerRegistry. View commands registered in ContentView+ViewCommandPalette.swift (registerViewCommandHandlers); command->shortcut mapping in ContentView+RightSidebarCommandPalette.swift (commandPaletteShortcutAction(forCommandID:)). Each contribution carries title/subtitle/keywords/when closures.
- **Windows approach:** Define a Command interface in TS { id, title, subtitle, keywords, shortcut?, when?(ctx), run() }. Register Scanline's existing actions (split H/V, focus dir, close, browser.open, notify) as the first commands, calling the same functions the keybindings already invoke in main.ts. Trailing-label shortcut text derived from a shortcut registry. 'when' predicates gate context-specific commands (e.g. browser-only commands only when focused leaf is a browser).
- **Deps:** Command palette overlay; fuzzy engine

### [todo/P2/L] Custom project commands from cmux.json (launched from palette)
- **Behavior:** Users define project-specific commands in a cmux.json config ('commands' array: name, description, keywords, command string, optional workspace/restart/confirm). These appear in the command palette and, when chosen, run the shell command (optionally in a new workspace/tab, optionally with a confirm prompt). Also 'actions' (type command/agent/builtin/workspaceCommand) with palette:true surface in the palette with custom title/subtitle/keywords/shortcut/icon.
- **Shortcut/CLI:** Custom (CLI command string per definition; optional per-action 'shortcut')
- **cmux impl:** CmuxConfigFile.commands: [CmuxCommandDefinition] (CmuxConfig.swift L1610: name/description/keywords/restart/workspace/command/confirm; id = 'cmux.config.command.'+name). Palette actions = CmuxConfigActionDefinition with palette flag, resolved to CmuxResolvedConfigAction. Execution via CmuxConfigExecutor.swift; trust gating via CmuxActionTrust.swift. Docs at web/public/docs (custom-actions-command-palette.png; cmux.com/docs/custom-commands).
- **Windows approach:** Parse a scanline.json (global + per-project) in the Tauri Rust backend with serde; on change, push the resolved command list to the renderer to merge into the palette registry. Running a command = spawn it as a ConPTY one-off (Scanline already supports 'run a one-off command line' via portable-pty) in the focused leaf or a new split. Confirm => a small DOM confirm modal before run. Trust model: prompt-on-first-run per command fingerprint, persisted, since project-local configs are untrusted input.
- **Deps:** Command palette overlay; config file loader; ConPTY one-off run (exists); split/new commands

### [todo/P3/S] Settings toggles as palette commands
- **Behavior:** Every boolean setting (e.g. 'Show Terminal Scroll Bar', 'Agent Hibernation', 'Dock Badge', 'Command Palette Searches All Surfaces') is exposed as a palette command whose title flips between 'Enable X' / 'Disable X' based on current state, with a subtitle showing section + On/Off. Some are conditionally available (when-predicate hides toggles that don't apply).
- **Shortcut/CLI:** -
- **cmux impl:** CommandPaletteSettingsToggleCommands.descriptors (~60 CommandPaletteSettingToggleDescriptor entries in CommandPalette/CommandPaletteSettingsToggle.swift), each binding a UserDefaults key with isOn/setOn/isAvailable closures; surfaced via commandPaletteSettingsToggleCommandContributions() and run via registerSettingsToggleCommandHandlers (ContentView+ViewCommandPalette.swift).
- **Windows approach:** Depends on a settings store existing first (Scanline has no settings UI/store yet). Once a settings store lands (TS state persisted via Tauri store plugin or a settings.json), generate toggle commands from a descriptor table identical in shape to cmux's. Low effort to add per-toggle once the underlying settings exist; the count grows with the settings surface.
- **Deps:** Settings store/UI (not built); command registry

### [todo/P2/S] Usage-history ranking boost (recency + frequency)
- **Behavior:** Recently and frequently used commands float to the top — strongly when the query is empty, partially when filtering. Persists across launches so the palette adapts to the user.
- **Shortcut/CLI:** -
- **cmux impl:** CommandPaletteUsageEntry {useCount,lastUsedAt} stored under defaults key 'commandPalette.commandUsage.v1'; CommandPaletteSearchOrchestrator.historyBoost computes recencyBoost(max 320, -20/day) + countBoost(min 180) and applies full boost on empty query, /3 when filtering.
- **Windows approach:** Persist a {commandId: {useCount,lastUsedAt}} map via the Tauri store plugin (or a small JSON file in appdata). Apply the identical boost formula in the TS/Rust search ranking. Trivial once the registry + engine exist.
- **Deps:** Command registry; fuzzy engine; persistence

### [todo/P1/S] Palette keyboard navigation (next/prev, customizable, clearable)
- **Behavior:** Up/Down arrows move the selection. Ctrl+N / Ctrl+P also move next/previous by default, and these nav shortcuts are user-customizable (Settings > Keyboard Shortcuts) — and can be cleared entirely so the keypress passes through to the active terminal. Works both via raw key events and via the field-editor command path (moveUp:/moveDown:).
- **Shortcut/CLI:** Up/Down; Ctrl+N (next), Ctrl+P (previous) — customizable
- **cmux impl:** commandPaletteSelectionDeltaForKeyboardNavigation + ...ForFieldEditorCommand (App/CommandPaletteShortcutRouting.swift), reading KeyboardShortcutSettings.shortcutIfBound(for: .commandPaletteNext/.commandPalettePrevious). Defaults Ctrl+N / Ctrl+P (KeyboardShortcutSettings.swift L295-298). Move events dispatched via .commandPaletteMoveSelection.
- **Windows approach:** Handle in the palette's DOM keydown handler: ArrowUp/Down always; Ctrl+N/Ctrl+P configurable via a keybindings map. 'Clearable' = if the binding is unset, do not preventDefault so the key reaches the focused xterm. Straightforward DOM event handling.
- **Deps:** Command palette overlay; keybinding registry

### [todo/P3/S] Rename / edit-description sub-modes of the palette
- **Behavior:** Choosing 'Rename Tab' / 'Rename Workspace' switches the palette into a single-line input mode (pre-filled with the current name, optionally pre-selected); 'Edit workspace description' switches to a multi-line editor. Confirming commits the new name/description; Esc cancels. A setting controls whether the existing name is selected on focus.
- **Shortcut/CLI:** Cmd+R (rename tab), Cmd+Shift+R (rename workspace), Opt+Cmd+E (edit description)
- **cmux impl:** CommandPaletteMode.renameInput/renameConfirm/workspaceDescriptionInput (ContentView.swift L1155). Drafts in commandPaletteRenameDraft / commandPaletteWorkspaceDescriptionDraft; multiline via CommandPaletteMultilineTextEditorRepresentable. Triggered by .commandPaletteRenameTabRequested/...RenameWorkspaceRequested/...EditWorkspaceDescriptionRequested. Select-on-focus = CommandPaletteRenameSelectionSettings.
- **Windows approach:** Reuse the palette overlay shell but swap the result list for a single/multi-line input. Scanline has no tabs/workspaces yet, so v1 could be 'rename pane' (set a leaf title in layout.ts). Pure DOM input + commit handler; no native dep.
- **Deps:** Command palette overlay; pane/tab title model (partial)

### [todo/P1/M] Find bar (per-surface terminal/browser search)
- **Behavior:** A small floating find bar appears over the focused pane with a search field, a live 'current/total' match counter, up/down next/prev buttons, and a close button. Typing highlights matches in the terminal scrollback (or in the browser page); Return = next match, Shift+Return = previous, Esc closes. The bar is draggable and snaps to the nearest corner. Selection in the field is remembered across focus changes/window switches.
- **Shortcut/CLI:** Cmd+F (find); Return / Shift+Return for next/prev within bar; Esc to close
- **cmux impl:** SurfaceSearchOverlay (Find/SurfaceSearchOverlay.swift) with native AppKit SearchNativeTextField; per-surface TerminalSurface.SearchState {needle,total,selected} (GhosttyTerminalView.swift L5188/L5367). Highlight/navigation driven into libghostty via performBindingAction('navigate_search:next'/'previous') (GhosttyTerminalView.swift ~L8402); counter updated from surface callbacks (L4589/4597). Selection memory in FindTextFieldSupport.swift. Browser find routes via WKWebView.
- **Windows approach:** Use xterm.js addon-search (@xterm/addon-search) for terminal find — it provides findNext/findPrevious, match highlighting, and an onDidChangeResults event giving resultIndex/resultCount for the counter. Render the find bar as a DOM overlay positioned over the focused leaf (draggable + corner-snap in CSS/JS). For browser leaves, drive find via the CDP bridge already proven (CallDevToolsProtocolMethod) using DOM-based find or window.find injected through Runtime.evaluate, since WebView2 has no native FindString API.
- **Deps:** xterm.js search addon; CDP bridge (exists, spike); focused-leaf tracking

### [todo/P1/S] Find next / find previous (outside the bar)
- **Behavior:** Jump to the next/previous match without the find bar focused, using the last-entered needle. Repeatable to cycle through all matches.
- **Shortcut/CLI:** Cmd+G (next), Opt+Cmd+G (previous)
- **cmux impl:** KeyboardShortcutSettings actions .findNext/.findPrevious (defaults Cmd+G / Opt+Cmd+G, KeyboardShortcutSettings.swift L416-419) dispatch the same navigate_search:next/previous binding actions against the active surface's SearchState.
- **Windows approach:** Bind Ctrl+G / Ctrl+Shift+G (Windows-idiomatic) in the keydown handler to call the xterm search addon's findNext/findPrevious on the focused terminal leaf, or the CDP find-next on a browser leaf, reusing the persisted needle from the find state.
- **Deps:** Find bar / search state

### [todo/P2/S] Hide find bar
- **Behavior:** Explicitly dismiss the find bar (separate from Esc), clearing highlights and returning focus to the surface.
- **Shortcut/CLI:** Opt+Cmd+Shift+F
- **cmux impl:** KeyboardShortcutSettings.Action.hideFind (default Cmd+Shift+Opt+F, KeyboardShortcutSettings.swift L420); clears TerminalSurface.searchState which removes the overlay (GhosttyTerminalView.swift L8985).
- **Windows approach:** A keybinding + close button that tears down the find-bar DOM node, calls xterm search addon clearDecorations()/clearActiveDecoration(), and refocuses the leaf. Trivial alongside the find bar.
- **Deps:** Find bar

### [todo/P2/S] Use selection for find
- **Behavior:** Take the currently selected text in the terminal/browser and load it into the find needle, immediately searching for it (without manually typing into the find bar).
- **Shortcut/CLI:** Cmd+E
- **cmux impl:** KeyboardShortcutSettings.Action.useSelectionForFind (default Cmd+E, L422). Handler restores panel focus then calls tabManager.searchSelection() (AppDelegate.swift L13256-13258), which seeds SearchState.needle from the active surface selection.
- **Windows approach:** Bind a shortcut that reads the focused xterm's getSelection() (or browser selection via CDP Runtime.evaluate window.getSelection().toString()), sets it as the find needle, opens the bar, and runs the search via the xterm search addon. Small DOM/JS glue.
- **Deps:** Find bar / search state

### [todo/P2/L] Find in directory (ripgrep-backed project search)
- **Behavior:** Search the contents of files under the workspace directory. Focuses a dedicated search field (in the right sidebar 'Find' tab) where a query runs ripgrep across the project; results list file/line/column with a preview snippet, status states (searching, no matches, matches, limited count, failed), and a configurable custom rg binary path. Clicking a result navigates/opens it.
- **Shortcut/CLI:** Cmd+Shift+F (focuses the directory-find field)
- **cmux impl:** KeyboardShortcutSettings.Action.findInDirectory (default Cmd+Shift+F, L414); routes via focusFileSearchInActiveMainWindow (AppDelegate.swift L13225/L14099) to the right-sidebar Find tab (switchRightSidebarToFind, Ctrl+2). Backend FileExplorerSearchController.swift drives ripgrep --json; results parsed by FileSearchRipgrepParser into FileSearchResult; snapshot states in FileSearchSnapshot.Status; custom binary via RipgrepIntegrationSettings.
- **Windows approach:** Bundle rg.exe (ripgrep ships a Windows build) or detect it on PATH, and run it from the Tauri Rust backend via std::process::Command / portable-pty with --json, streaming parsed match lines (path/line/col/preview) to the renderer over a Tauri event channel. Render results in a panel (Scanline has no sidebar yet, so v1 = a results pane or a dedicated overlay). Need a 'workspace root' concept — Scanline currently tracks per-leaf cwd at most, so define the search root from the focused terminal's cwd.
- **Deps:** rg.exe bundling/detection; a results panel or sidebar; workspace/cwd root concept

### [todo/P3/S] Find-in-directory result open / path insertion
- **Behavior:** Selecting a find-in-directory result opens that file at the matched line (in the configured editor / cmux viewer), or inserts its path into the focused terminal.
- **Shortcut/CLI:** -
- **cmux impl:** FileExplorerTerminalPathInsertion.relativePath(...) used to compute relativePath in FileExplorerSearchController.swift; open routing shared with CommandClickFileOpenRouter.swift / cmd-click file open settings.
- **Windows approach:** On result click, either inject the relative path into the focused ConPTY (write bytes to the pty, already supported) or open the file via an external editor (Command::new with the user's editor) / shell 'start'. Depends on find-in-directory landing first.
- **Deps:** Find in directory

### [todo/P2/M] Find/palette routing arbitration (terminal vs browser vs web-inspector)
- **Behavior:** Find and palette shortcuts behave correctly regardless of what's focused: when a browser pane is focused, Cmd+F drives the browser's own find (and certain find ops keep the cmux find bar ownership while others release it); when the Safari web inspector is focused the app stops intercepting so the inspector's native find works; CJK IME composition is not interrupted by Esc/Return.
- **Shortcut/CLI:** (applies to all find/palette shortcuts)
- **cmux impl:** BrowserFindCommandEquivalent + keepsCmuxBrowserFindBarOwnershipWhenVisible and web-inspector detection (App/ShortcutRoutingSupport.swift L486-635, cmuxIsLikelyWebInspectorResponder); IME guards via hasMarkedText() checks in SurfaceSearchOverlay.swift / FindTextFieldSupport.swift.
- **Windows approach:** Centralize a focus-context resolver in main.ts that, before handling a find/palette key, checks the focused leaf kind (terminal vs WebView2 browser) from layout.ts and dispatches to the right find implementation. WebView2 devtools run in a separate window/process so inspector-find conflicts are less of an issue than in WKWebView. IME: gate on xterm's composition state / DOM compositionstart/compositionend so Esc/Enter aren't stolen mid-composition.
- **Deps:** Find bar; browser pane (exists); focused-leaf kind tracking

## ssh-remote

### [todo/P1/M] cmux ssh <destination> workspace creation
- **Behavior:** Running `cmux ssh user@host` creates a new workspace tagged as remote, opens a terminal that SSHes into the host, and runs an interactive remote shell. No --name required (auto-named from destination). Becomes the focused workspace.
- **Shortcut/CLI:** cmux ssh <user@host> [--port N] [--identity PATH] [--name TITLE] [--ssh-option K=V] [--no-focus] [-- <remote command>]
- **cmux impl:** CLI/cmux.swift ssh subcommand (parses flags ~L7732, builds workspace.remote.configure payload, sets preserve_after_terminal_exit/persistent_daemon_slot). Workspace gets a WorkspaceRemoteConfiguration (Sources/WorkspaceRemoteConfiguration.swift). Terminal startup command is an ssh -tt reconnect script.
- **Windows approach:** Add `scanline ssh` to Go CLI. Build the ssh command line (Windows 10/11 ships OpenSSH client at C:\Windows\System32\OpenSSH\ssh.exe). Spawn a ConPTY pane (pane.new path already exists) whose command line is `ssh -tt -p PORT -i KEY -o ... user@host`. Parse --port/--identity/--name/--ssh-option/-- like cmux. Tag the pane/leaf as remote in layout.ts metadata. No daemon needed for the basic terminal case — plain ssh client over ConPTY.
- **Deps:** Terminal panes (ConPTY), control server pane.new, OpenSSH client on PATH

### [todo/P1/S] SSH destination/option parsing and validation
- **Behavior:** User-supplied user@host, port, identity file, and -o options are validated: destination length <=256, no leading dash, no control/format chars, port 1-65535, host/user charset-restricted. Bad input produces a clear error instead of being passed to ssh.
- **Shortcut/CLI:** (implicit in cmux ssh / ssh:// link parsing)
- **cmux impl:** Sources/CmuxSSHURLRequest.swift (isAllowedSSHHost/isAllowedSSHUser/boundedInteger/containsUnsafeHiddenCharacter) and CLI flag parsing in cmux.swift L7732+; SSH option key precedence in WorkspaceRemoteConfiguration.swift (case-insensitive, control-socket defaults only injected when absent).
- **Windows approach:** Port the validation charset/length checks verbatim into the Go CLI argument parser before constructing the ssh.exe argv. Keep the same allow-lists. Reject leading-dash to avoid ssh option injection. Inject StrictHostKeyChecking=accept-new and ControlMaster defaults only when the user did not override (Windows OpenSSH supports ControlMaster on recent builds; gate it on availability).
- **Deps:** cmux ssh workspace creation

### [todo/P2/M] ssh:// and scanline://ssh deeplink handler (open SSH workspace from a link)
- **Behavior:** Clicking an ssh:// link (or a cmux://ssh?host=...&user=...&port=... link) anywhere in the OS opens a security-warning dialog ('Open SSH Workspace?') showing the exact target and a command preview, with a 'I trust this target' checkbox that must be ticked before Connect is enabled. On confirm, it launches cmux ssh.
- **Shortcut/CLI:** (OS URL activation; app registers as ssh handler)
- **cmux impl:** Sources/AppDelegate+CmuxSSHURL.swift (handleCmuxSSHURLs -> confirmCmuxSSHURLRequest NSAlert with accessory view + gate checkbox -> CmuxSSHURLProcessLauncher runs bundled cmux CLI). Parsing in CmuxSSHURLRequest.parse (handles both ssh:// and cmux:// schemes). DefaultTerminalRegistration registers ssh scheme + shell-script UTIs via LaunchServices.
- **Windows approach:** Register a custom URI scheme (scanline://) and optionally the ssh: protocol in HKCU\Software\Classes via Tauri's deep-link plugin / registry write; Windows lets apps claim ssh: as a URL protocol handler. On activation Tauri delivers the URL to the running instance (single-instance plugin). Show a confirmation modal (HTML dialog in the WebView2 UI, not native NSAlert) with target + command preview + trust checkbox, then invoke the scanline ssh path. Reuse the same CmuxSSHURLRequest validation logic ported to Rust/Go.
- **Deps:** cmux ssh workspace creation, single-instance + deep-link handling, confirmation dialog UI

### [todo/P3/M] Register Scanline as default terminal / ssh handler
- **Behavior:** A setting/action makes the app the default handler for the ssh URL scheme and for shell-script/unix-executable file types, so ssh links and double-clicked .command files open in the app.
- **Shortcut/CLI:** (menu/settings action)
- **cmux impl:** Sources/AppDelegate+CmuxSSHURL.swift DefaultTerminalRegistration.setAsDefault (LSRegisterURL + NSWorkspace.setDefaultApplication for scheme 'ssh' and content types). DefaultTerminalUserAction presents an error alert on failure.
- **Windows approach:** Write registry associations under HKCU\Software\Classes (URLProtocol for ssh, and ShellNew/file-type assoc for .cmd/.ps1 if desired). Windows does not have a 'default terminal' LaunchServices equivalent; the Win11 'Default terminal application' setting (Terminal/Console host) is a separate concept and is NOT settable per-third-party-app via API. Limit scope to URI-scheme registration; drop the shell-script-file-type behavior or wire it through file association registry keys.
- **Deps:** Deeplink handler

### [todo/P2/XL] Remote daemon bootstrap (cmuxd-remote upload + start + hello handshake)
- **Behavior:** On first connect to a host, the app silently probes the remote OS/arch, verifies a pinned cmuxd-remote binary by embedded SHA-256, uploads it if missing, runs it as `serve --stdio`, and negotiates a hello handshake before enabling remote features. Bootstrap/probe failures surface actionable error text.
- **Shortcut/CLI:** (automatic on cmux ssh)
- **cmux impl:** Local app probes remote platform and uploads release-pinned cmuxd-remote (Go daemon, daemon/remote/). Info.plist embeds CMUXRemoteDaemonManifestJSON with asset URLs + SHA-256. Runs `cmuxd-remote serve --stdio --persistent --slot <slot>` over an SSH exec channel; daemon hello enforced. See docs/remote-daemon-spec.md sec 3.2, daemon/remote/README.md.
- **Windows approach:** Major new subsystem. Need a Rust/Go remote daemon binary cross-compiled for linux/darwin amd64+arm64 (the remote host is usually Linux, so the daemon target stays POSIX — only the LOCAL orchestration changes for Windows). From Windows: spawn ssh.exe with an exec channel (ssh user@host 'cmuxd-remote serve --stdio'), pipe newline-delimited JSON over its stdin/stdout. Probe via `ssh host uname -sm`. Upload via scp.exe or `ssh host 'cat > path'`. Embed manifest + verify SHA-256 in Rust. This is the single largest port item; the basic ssh terminal works WITHOUT it.
- **Deps:** cmux ssh workspace creation, a cross-compiled remote daemon, scp/ssh on PATH

### [todo/P2/L] Browser panes auto-routed through the remote network (egress from remote host)
- **Behavior:** In a remote workspace, browser panes fetch through the remote machine's network, so a site on the remote's localhost or private network 'just works' without manual port forwarding. Local workspaces are not force-proxied. Reconnect re-applies the proxy automatically.
- **Shortcut/CLI:** (automatic for browser panes in a remote workspace)
- **cmux impl:** One local proxy broker per SSH transport key serves SOCKS5 + HTTP CONNECT and tunnels each stream over daemon stream RPC (proxy.open/write/close + pushed proxy.stream.* events) — no ssh -D, no per-port -L mirroring. Browser WKWebView gets store.proxyConfigurations=[socksv5, httpCONNECT] (Sources/Panels/BrowserPanel.swift ~L4446) scoped to a per-workspace WKWebsiteDataStore. RemoteLoopbackProxyAlias maps localhost.* to an alias host. docs/remote-daemon-spec.md sec 4.
- **Windows approach:** WebView2 supports a proxy via the --proxy-server additional browser argument on the environment, but that is per-environment (per user-data-folder), not per-control, so per-pane proxying requires separate WebView2 environments/user-data-folders per remote workspace. Run a local SOCKS5/CONNECT listener in Rust (tokio) and either (a) tunnel it over the remote daemon stream RPC, or (b) simpler interim: shell out to `ssh -D <localport> user@host` for a dynamic SOCKS proxy and point the WebView2 environment at 127.0.0.1:<localport> via --proxy-server=socks5://. Re-create/re-point on reconnect. Map localhost aliasing as cmux does.
- **Deps:** Browser pane (WebView2), remote daemon bootstrap (for the RPC-tunnel variant) OR ssh -D (for the interim variant), per-workspace WebView2 environments

### [todo/P2/M] Drag an image/file into a remote terminal to upload via scp
- **Behavior:** Dropping a local image (or file) onto a remote SSH terminal pane uploads it to the remote host via scp, drops a unique /tmp/cmux-drop-<uuid>.<ext> path, and inserts that remote path into the terminal input so the agent/command can reference it. On cancel/failure the remote temp file is cleaned up (rm -f over ssh).
- **Shortcut/CLI:** (drag-and-drop onto a remote terminal pane)
- **cmux impl:** Sources/TerminalSSHSessionDetector.swift: DetectedSSHSession.uploadDroppedFiles -> scp -q -o BatchMode=yes ... localPath user@host:/tmp/cmux-drop-UUID.ext; cleanup via ssh rm -f. The session params (port/identity/jumphost/controlpath/-4/-6/-A/-C/options) are auto-detected by scanning the foreground ssh process args of the pane's TTY (ps + sysctl KERN_PROCARGS2). remoteDropPath from WorkspaceRemoteSessionController. Drop routing in GhosttyTerminalView.swift uploadRemote closure.
- **Windows approach:** WebView2 drop: handle HTML5 drag/drop or Tauri's file-drop event on the terminal pane DOM. For a Scanline-managed remote pane, Scanline already KNOWS the ssh params (it built the command) — no need to port the macOS ps/sysctl process-arg sniffing (which has no Windows equivalent anyway; would need GetExtendedTcpTable/NtQueryInformationProcess + ReadProcessMemory PEB walk, fragile). Run scp.exe with the stored params to upload to /tmp/scanline-drop-<uuid>, then write the remote path into the ConPTY stdin. Cleanup via ssh rm -f. For arbitrary externally-launched ssh panes, the auto-detect path is a non-goal.
- **Deps:** cmux ssh workspace creation (to know ssh params), terminal pane drop handling, scp.exe on PATH

### [todo/P2/M] Reconnect / Disconnect remote workspace (context menu + API)
- **Behavior:** Right-clicking a remote workspace tab offers 'Reconnect Workspace(s)' and 'Disconnect Workspace(s)'. Reconnect re-establishes the SSH transport/daemon/proxy; disconnect tears it down. Works on multi-selection.
- **Shortcut/CLI:** (tab context menu; socket API workspace.remote.reconnect)
- **cmux impl:** Context menu labels in Sources/ContentView.swift (~L15309 contextMenu.reconnectWorkspace / disconnectWorkspace). Socket API includes workspace.remote.reconnect (docs/remote-daemon-spec.md sec 3.1). Reconnect escalates from proxy broker retry to full daemon re-bootstrap in the session controller.
- **Windows approach:** Add a tab/pane context menu (DOM context menu in the WebView2 UI) with Reconnect/Disconnect entries for remote-tagged leaves. Reconnect: kill and respawn the ssh ConPTY process (and daemon stdio channel / ssh -D proxy if present). Disconnect: terminate the ssh process and clear remote metadata. Add control-server commands ssh.reconnect / ssh.disconnect over the named pipe. Multi-select can come later.
- **Deps:** cmux ssh workspace creation, context menu UI, control server

### [todo/P2/M] Remote error surfacing (sidebar status + logs + notifications, with retry info)
- **Behavior:** Connection/bootstrap/proxy failures show structured status in the sidebar, logs, and a notification; the surfaced text includes the retry count and next-retry delay (e.g. 'retry 1 in 4s'), and a proxy_unavailable code when proxy setup fails.
- **Shortcut/CLI:** (automatic on failure)
- **cmux impl:** Remote status carries remote.state/remote.daemon/remote.proxy in workspace.remote.status (tests_v2/test_ssh_remote_image_drop_upload.py polls it). Errors surfaced in sidebar status + logs + notifications, retry count embedded in error text. docs/remote-daemon-spec.md sec 3.3.
- **Windows approach:** Track remote connection state per remote leaf in Rust; emit Tauri events to the WebView2 UI to render a status badge/row. Build retry/backoff into the reconnect loop and include attempt/delay in the message string. Use Windows toast (WinAppSDK AppNotification / tauri notification plugin) for the notification (note: toasts are not yet built in Scanline — depends on the notification subsystem). Console-only notify exists today; needs real UI.
- **Deps:** Reconnect/disconnect, notification subsystem (not yet built), sidebar UI (not yet built)

### [todo/P2/L] CLI relay: run scanline/cmux commands from inside the remote SSH session
- **Behavior:** Inside a cmux ssh shell, running `cmux ...` (e.g. `cmux split`, `cmux ping`, `cmux list-workspaces`) controls the LOCAL app — splitting panes, opening browsers, etc. — even though the shell is on a remote box. Each session pins to its own relay so parallel sessions don't race.
- **Shortcut/CLI:** (any cmux/scanline command typed in the remote shell)
- **cmux impl:** cmuxd-remote `cli` subcommand + busybox argv[0] detection (invoked as 'cmux'). Background `ssh -N -R 127.0.0.1:PORT:127.0.0.1:LOCAL_RELAY_PORT` reverse-forwards a TCP port to a local authenticated relay server; relay requires HMAC-SHA256 challenge-response before forwarding to the real local Unix socket. Bootstrap installs ~/.cmux/bin/cmux wrapper, exports CMUX_SOCKET_PATH=127.0.0.1:<relay_port>. daemon/remote/README.md, docs/remote-daemon-spec.md sec 3.5.
- **Windows approach:** From Windows: spawn a background `ssh -N -R 127.0.0.1:PORT:127.0.0.1:<local_relay_port> user@host` (OpenSSH client supports -R; many servers disable StreamLocalForwarding so TCP is required — same as cmux). Run a local loopback TCP relay in Rust that speaks the named-pipe JSON protocol to the existing \\.\pipe\scanline control server, gated by HMAC challenge-response. Bootstrap writes ~/.scanline/bin/scanline (a small relay client) on the remote and sets SCANLINE_SOCKET/CMUX_SOCKET_PATH=127.0.0.1:<port>. Reuse the existing Go CLI as the relay client compiled for the remote OS. Cleanup orphan ssh -R processes on start.
- **Deps:** cmux ssh workspace creation, control server (named pipe), a remote-OS build of the Go CLI/relay client, ssh -R support

### [todo/P3/L] Control local browser from a remote session (browser CLI relay)
- **Behavior:** Inside an SSH session, `cmux browser open/navigate/click/snapshot/screenshot/...` drives the LOCAL app's browser pane (not a browser inside the VM). `open` defaults to CMUX_WORKSPACE_ID so the agent gets a browser pane next to its SSH terminal.
- **Shortcut/CLI:** cmux browser <open|navigate|back|forward|reload|get-url|snapshot|eval|wait|click|...|screenshot> (from remote shell)
- **cmux impl:** Routed over the same authenticated CLI relay; commands target CMUX_SURFACE_ID (default) / CMUX_WORKSPACE_ID. daemon/remote/README.md 'Browser relay behavior'.
- **Windows approach:** Falls out of (a) the CLI relay and (b) a real scriptable browser API. The remote `scanline browser ...` just forwards to the local control server which executes against WebView2 via the CDP bridge (CallDevToolsProtocolMethod). Depends on the full browser automation API existing locally first (the ~70-method scriptable browser API is NOT yet built; only proven CDP spikes exist).
- **Deps:** CLI relay, full scriptable browser API (not yet built), browser CDP bridge

### [todo/P3/XL] Detachable persistent remote PTY sessions (survive surface close + app relaunch)
- **Behavior:** A cmux ssh shell keeps running on the remote even after you close the local pane or quit and relaunch the app. `cmux ssh-session-list` shows detached sessions with scrollback metadata, `cmux ssh-session-attach --session-id <id>` reattaches to the exact same remote shell PID/env, `cmux ssh-session-cleanup` kills it.
- **Shortcut/CLI:** cmux ssh-session-list [--json] / ssh-session-attach --session-id <id> / ssh-session-cleanup [--json]
- **cmux impl:** Persistent daemon slot per SSH workspace (cmuxd-remote serve --stdio --persistent --slot, auth.token under ~/.cmux/daemon/<ver>/<slot>/, per-user socket /tmp/cmuxd-remote-<uid>/). pty.* RPC (attach/write/resize/detach/close/list). Local attach script ssh-pty-attach --require-existing with foreground-auth token (workspace.remote.foreground_auth_ready). Restore in WorkspaceRemoteConfiguration.swift workspaceConfiguration(allowPersistentPTYRestore:). Requires daemon cap pty.session.persistent_daemon. M-011/DP-001..006, IN PROGRESS in cmux.
- **Windows approach:** Depends entirely on the remote daemon subsystem. The remote daemon (POSIX, runs on the Linux host) holds the PTY and bounded scrollback; Windows side only needs to: spawn the persistent stdio proxy over ssh, store the slot/relay/foreground-auth token in session state (already partly modeled by Scanline session-restore being a TODO), and reattach on relaunch. ssh-session-list/attach/cleanup become Go CLI subcommands -> daemon pty.list/attach/close. Mint fresh relay credentials on restore. Build AFTER the daemon and session-restore exist.
- **Deps:** Remote daemon bootstrap, CLI relay, session restore (not yet built)

### [todo/P3/M] tmux-style PTY resize coordination (smallest screen wins)
- **Behavior:** When a remote PTY has multiple attachments (e.g. reattach from two panes/clients), the effective PTY size is min(cols) x min(rows) across attached clients. Detaching the smallest grows the PTY to the next smallest; with no attachments the last-known size is kept (no 80x24 reset); UI relayout never shrinks history.
- **Shortcut/CLI:** (automatic; triggered by resize/attach/detach/reconnect)
- **cmux impl:** Daemon session resize-coordinator RPC: session.open/attach/resize/detach/status; tracks {attachment_id -> cols,rows} and applies min. session.resize.min advertised in remote.daemon caps. docs/remote-daemon-spec.md sec 5, M-009.
- **Windows approach:** Lives in the remote daemon. The Windows client sends ConPTY resize events (xterm.js onResize -> pty.resize over the daemon channel) tagged with an attachment id. The min-cols/min-rows recompute logic is daemon-side and OS-agnostic. For the simple non-daemon ssh case (single ConPTY -> ssh -tt), normal ConPTY/SIGWINCH propagation already gives correct single-client resize; the coordinator only matters once persistent multi-attach exists.
- **Deps:** Remote daemon bootstrap, detachable persistent PTY sessions

### [todo/P3/S] Remote daemon trust inspection (remote-daemon-status)
- **Behavior:** `cmux remote-daemon-status [--os linux --arch amd64]` prints the bundled daemon version, exact release asset URL, expected SHA-256, local cache verification state, and a copy-pasteable `gh attestation verify` command so the user can audit what the build trusts.
- **Shortcut/CLI:** cmux remote-daemon-status [--os <os> --arch <arch>]
- **cmux impl:** Reads CMUXRemoteDaemonManifestJSON from Info.plist; verifies local cached binary SHA-256. docs/remote-daemon-spec.md sec 3.6, daemon/remote/README.md Distribution.
- **Windows approach:** Add a `scanline remote-daemon-status` Go CLI subcommand that reads the embedded manifest (ship the manifest as an embedded JSON resource in the Tauri bundle, read via Rust include_str! and expose over the control server) and verifies the cached daemon hash on disk. Print the gh attestation verify command. Only meaningful once the daemon + manifest pipeline exists.
- **Deps:** Remote daemon bootstrap (manifest + cache), release pipeline that publishes daemon assets

### [todo/P3/XL] Cloud VM / WebSocket remote transport (vm ssh, serve --ws, lease auth)
- **Behavior:** For cloud VM images (Freestyle/E2B), the daemon is pre-baked and started via systemd; `cmux vm ssh` / `cmux vm ssh-info` open a workspace against a managed VM. The WebSocket PTY transport (/terminal) is gated by a short-lived single-use lease file (token_sha256 + expiry), and provider traffic auth (E2B token) stays separate.
- **Shortcut/CLI:** cmux vm ssh / vm ssh-info / vm ssh-attach (and cloud ... aliases)
- **cmux impl:** cmuxd-remote serve --ws --auth-lease-file; skipDaemonBootstrap=true path in WorkspaceRemoteConfiguration (synthesize DaemonHello, SSH local-forward to /run/cmuxd-remote.sock). Lease shape + security invariants in daemon/remote/README.md 'Cloud WebSocket PTY transport'. CLI: cmuxTests/VMSSHCommandTests.swift, cli-contract.md vm ssh family.
- **Windows approach:** Out of scope for the initial Windows port — it is tied to cmux's managed cloud backend (Freestyle/E2B) and an auth/lease server Scanline does not have. If pursued: Rust WebSocket client (tokio-tungstenite) to /terminal, send the JSON auth frame, then binary frames as ConPTY I/O; SSH local-forward via ssh.exe -L to the VM's unix socket. Treat as a P3/non-goal until there is a Scanline cloud backend.
- **Deps:** Remote daemon bootstrap, a managed-VM backend (does not exist in Scanline)

## session-config-theming

### [todo/P1/L] Auto session restore on relaunch
- **Behavior:** Quitting cmux saves the current session; relaunching with no launch args automatically rebuilds windows, workspaces, and the pane/split layout exactly as they were.
- **Shortcut/CLI:** -
- **cmux impl:** AppDelegate.buildSessionSnapshot/persistSessionSnapshot -> SessionPersistenceStore.save(AppSessionSnapshot) (versioned JSON under ~/Library/Application Support/cmux/). On launch SessionRestorePolicy.shouldAttemptRestore() gates restore (skipped if any non -psn arg, CMUX_DISABLE_SESSION_RESTORE=1, or under tests); layout rebuilt first then tabManager.restoreSessionSnapshot. SessionPersistence.swift, AppDelegate.swift:3070-3169,4103-4172.
- **Windows approach:** Serialize layout.ts binary split tree + per-leaf {kind: terminal|browser, cwd, url} to %APPDATA%\Scanline\session.json via Tauri fs/app_data_dir. On startup, if argv has no extra args, rebuild grid from JSON before spawning ptys/webviews. Tauri window state plugin covers window frame; pane tree is custom.
- **Deps:** layout.ts split tree; pty/browser pane creation

### [todo/P2/S] Window/display geometry restore
- **Behavior:** Restored windows reopen at their previous position and size on the correct display, with sidebar visibility/width and selection preserved.
- **Shortcut/CLI:** -
- **cmux impl:** SessionRectSnapshot/SessionDisplaySnapshot capture window frame, displayID and visibleFrame; SessionSidebarSnapshot stores visibility, selection(tabs/notifications), width. Sidebar width sanitized via SessionPersistencePolicy (216..600). persistedWindowGeometryDefaultsKey in UserDefaults. SessionPersistence.swift:171-229, AppDelegate.swift:4113-4118.
- **Windows approach:** tauri-plugin-window-state persists position/size/maximized/monitor automatically. For multi-monitor correctness validate saved rect against Window::available_monitors and clamp. Scanline has no sidebar yet, so sidebar fields are deferred.
- **Deps:** Session restore

### [partial/P1/S] Working directory restore per terminal pane
- **Behavior:** Each restored terminal pane reopens a shell in the directory it was in (best effort), not the default home dir.
- **Shortcut/CLI:** -
- **cmux impl:** SessionTerminalPanelSnapshot.workingDirectory; on restore SessionRestoredTerminalCommandStore.writeLauncherScript writes a temp zsh that 'cd -- <dir>' then exec's login shell. SessionRestoredTerminalCommandStore.swift, SessionPersistence.swift:1368-1404.
- **Windows approach:** ConPTY already takes a cwd at spawn (portable-pty CommandBuilder.cwd). Persist cwd per leaf and pass it when respawning the pty on restore. No launcher script needed on Windows; cwd is native to pty spawn.
- **Deps:** Session restore; pty cwd plumbing

### [todo/P2/M] Terminal scrollback restore (best effort)
- **Behavior:** Restored terminals show their previous scrollback buffer replayed into the pane so context isn't lost.
- **Shortcut/CLI:** -
- **cmux impl:** SessionTerminalPanelSnapshot.scrollback (truncated to 4000 lines / 400k chars via SessionPersistencePolicy.truncatedScrollback, with ANSI-safe truncation that skips into partial CSI sequences). SessionPersistence.swift:28-117.
- **Windows approach:** xterm.js SerializeAddon (@xterm/addon-serialize) emits the buffer with ANSI; capture on quit, store per leaf, write back via term.write() on restore. Cap lines/bytes mirroring cmux. SerializeAddon handles sequence boundaries so no custom ANSI truncation needed.
- **Deps:** Session restore; xterm serialize addon

### [todo/P2/M] Browser pane URL + navigation history restore
- **Behavior:** Restored browser panes reopen at the last URL with back/forward history intact.
- **Shortcut/CLI:** -
- **cmux impl:** BrowserPanel.restoreSessionSnapshot / restoreSessionNavigationHistory rebuild WKWebView back-forward list from SessionBrowserPanelSnapshot. BrowserPanel.swift:4718-4736.
- **Windows approach:** WebView2 cannot inject a full back/forward list. Persist current URL + visited-URL array; restore by navigating to the last URL. Store the history list for display only; full BF-list replay is not achievable via WebView2 API.
- **Deps:** Session restore; browser pane

### [todo/P2/S] Reopen previous session manually
- **Behavior:** User can re-apply the last saved snapshot on demand via File > Reopen Previous Session, a shortcut, or the CLI even when restore was skipped.
- **Shortcut/CLI:** Cmd+Shift+O (CLI: cmux restore-session)
- **cmux impl:** AppDelegate.reopenPreviousSession(shouldActivate:) reads snapshot, prefixes maxWindowsPerSnapshot, rebuilds layout; bound to .reopenPreviousSession action (label 'Restore Previous App Launch'). AppDelegate.swift:3111-3169, KeyboardShortcutSettings.swift:170.
- **Windows approach:** Add control-server verb session.restore + Go CLI 'scanline restore-session' + a menu/shortcut (Ctrl+Shift+O) that reads session.json and rebuilds the grid. Reuses the auto-restore code path.
- **Deps:** Session restore

### [todo/P2/M] Periodic session autosave
- **Behavior:** Session state is continuously checkpointed (every ~8s) so a crash loses minimal state, not just on clean quit.
- **Shortcut/CLI:** -
- **cmux impl:** SessionPersistencePolicy.autosaveInterval = 8.0; writes serialized on a dedicated sessionPersistenceQueue (com.cmuxterm.app.sessionPersistence). AppDelegate.swift:1033, persistSessionSnapshot synchronously|async. SessionPersistence.swift:24.
- **Windows approach:** Rust tokio interval task (every 8s) snapshots the JS layout state (webview pushes state on change, or round-trip via Tauri event) and writes session.json atomically (tempfile + rename). Debounce on layout changes.
- **Deps:** Session restore

### [todo/P3/S] Persist session for app update relaunch
- **Behavior:** When the app updates and relaunches itself, the session is saved synchronously first so nothing is lost across the update.
- **Shortcut/CLI:** -
- **cmux impl:** AppDelegate.persistSessionForUpdateRelaunch() forces a synchronous snapshot before Sparkle relaunch. AppDelegate.swift:1853.
- **Windows approach:** Hook the updater's before-restart event (once an updater exists in Scanline) to call the synchronous session save. Deferred until an updater exists.
- **Deps:** Session restore; updater (not built)

### [todo/P2/XL] Agent session resume (hooks-saved native session IDs)
- **Behavior:** Supported agents (Claude Code, Codex, Gemini, OpenCode, Amp, Cursor CLI, etc.) reopen and resume their prior conversation, not a fresh shell, when hooks recorded a native session ID.
- **Shortcut/CLI:** CLI: cmux hooks setup [--agent <name>]
- **cmux impl:** Agent hooks write mappings to ~/.cmuxterm/<agent>-hook-sessions.json; SessionRestorableAgentSnapshot + RestorableAgentSessionIndex.load() consulted in buildSessionSnapshot; on restore the agent's native resume command runs. RestorableAgentTypes.swift:160, FeedCoordinator.swift:280-349, AppDelegate.swift:4154.
- **Windows approach:** Port the hook-session JSON store under %USERPROFILE%\.cmuxterm. Provide 'scanline hooks setup' in the Go CLI that writes per-agent hook scripts (.cmd) invoking 'scanline notify'/session-record. On restore run the agent's resume argv (claude --resume <id>, codex resume, etc.) via the pty instead of a plain shell. Large per-agent surface area.
- **Deps:** tmux-shim/agent launch path; notification hooks; session restore

### [todo/P3/L] Surface resume bindings (custom resume commands)
- **Behavior:** Advanced users attach a custom resume command (e.g. tmux attach -t work) to a terminal surface so it re-runs that command on restore; managed via CLI and Settings.
- **Shortcut/CLI:** CLI: cmux surface resume set/show/clear
- **cmux impl:** SurfaceResumeBindingSnapshot (command/cwd/env/checkpointId/source/approvalPolicy); SurfaceResumeApprovalStore signs approvals with HMAC-SHA256 (keychain/env/file secret); only trusted bindings (process-detected/agent-hook/user-approved prefix) auto-run; sensitive env keys (TOKEN/SECRET/PASSWORD...) dropped. SessionPersistence.swift:256-1268.
- **Windows approach:** Port binding model + signed approval store to Rust (hmac crate; store secret in Windows Credential Manager via windows-rs CredWrite or DPAPI). Add 'scanline surface resume' CLI verbs. Sensitive-env-key dropping and approval policy (manual/prompt/auto) port 1:1.
- **Deps:** Session restore; secret storage

### [todo/P3/S] Auto-resume-agents toggle
- **Behavior:** User can turn off automatic agent resume so restored agent panes stay idle (layout/cwd/scrollback still restored) via a Settings toggle or cmux.json terminal.autoResumeAgentSessions=false.
- **Shortcut/CLI:** -
- **cmux impl:** Settings > Terminal > Resume Agent Sessions on Reopen, backed by terminal.autoResumeAgentSessions in cmux.json. AgentSessionAutoResumeSettingsTests.swift; README session-restore.
- **Windows approach:** Boolean in scanline.json (terminal.autoResumeAgentSessions). When false, restore spawns a plain shell in the cwd instead of the agent resume argv. Trivial once agent-resume exists.
- **Deps:** Agent session resume; config file

### [todo/P3/L] Agent hibernation (idle process suspension)
- **Behavior:** Idle agent processes can be hibernated and re-awoken, with the hibernation timestamp persisted across restart.
- **Shortcut/CLI:** -
- **cmux impl:** AgentHibernationController + AgentHibernationLifecycleState; SessionAgentHibernationSnapshot{hibernatedAt,lastActivityAt} stored per terminal panel. SessionPersistence.swift:1407-1410, App/AgentHibernationController.swift.
- **Windows approach:** Windows lacks SIGSTOP/SIGCONT; suspend a console process tree via NtSuspendProcess/NtResumeProcess (ntdll) or a Job Object freeze. Track last-activity by pty output timestamps. Niche; defer.
- **Deps:** pty process management

### [todo/P3/S] TextBox input draft restore
- **Behavior:** Unsent text (and file attachments) typed into a pane's rich input box survives a restart and is restored.
- **Shortcut/CLI:** -
- **cmux impl:** SessionTextBoxInputDraftSnapshot{isActive, parts:[text|attachment]} per terminal panel snapshot. SessionPersistence.swift:1412-1481.
- **Windows approach:** Only relevant if Scanline builds a TextBox feature (not built). Persist draft text in session.json per leaf. Defer with TextBox.
- **Deps:** TextBox feature (not built); session restore

### [todo/P1/L] Settings window (multi-section preferences UI)
- **Behavior:** A dedicated Settings window with a sidebar of sections (App, Terminal, Sidebar, Browser, Automation, Keyboard Shortcuts, Workspace Colors, cmux.json, Reset, etc.) and per-section panes.
- **Shortcut/CLI:** Cmd+, (action .openSettings)
- **cmux impl:** Packages/CmuxSettingsUI SwiftUI app: SettingsWindowScene + SettingsSectionID (14 cases with title/symbol/searchKeywords) + Sections/*; SettingsWindowPresenter opens it. SettingsSectionID.swift:12-91.
- **Windows approach:** Build settings as an HTML/JS view (app is already web). Either a separate Tauri WebviewWindow ('settings') or an in-app overlay route. Sidebar+sections in DOM; bind values to scanline.json via Tauri commands. Reuse the web stack rather than WinUI. Bind to Ctrl+,.
- **Deps:** config file store

### [todo/P2/M] Settings search index
- **Behavior:** A search box at the top of Settings filters/jumps across all sections by title and capability keywords (e.g. typing 'hooks' surfaces Automation).
- **Shortcut/CLI:** -
- **cmux impl:** SettingsSearchIndex + SettingsSearchAliases + SettingsSearchHighlight; each SettingsSectionID exposes searchKeywords; row-level anchors resolved. Navigation/SettingsSearchIndex.swift, SettingsSectionID.swift:73-90.
- **Windows approach:** In-memory index of {sectionId, title, keywords, rowAnchors} in JS; substring/fuzzy filter (Fuse.js or hand-rolled) over the settings DOM, scroll-to-anchor on select. Pure frontend.
- **Deps:** Settings window

### [todo/P1/M] Reload configuration (live re-read)
- **Behavior:** Re-reads config from disk and applies theme/font/colors/shortcuts live without restarting the app.
- **Shortcut/CLI:** Cmd+Shift+, (action .reloadConfiguration)
- **cmux impl:** AppDelegate.reloadConfiguration(soft:source:) -> GhosttyApp.reloadConfiguration + reloadCmuxConfigStores(store.loadAll); posts .ghosttyConfigDidReload / themes.reload-config. AppDelegate.swift:11947-11975, GhosttyTerminalView.swift:3468.
- **Windows approach:** Control-server verb config.reload + Ctrl+Shift+, shortcut. Re-read scanline.json + theme file in Rust, push new theme/font to all xterm instances via Tauri events (term.options.theme/fontFamily/fontSize live-applied), rebind shortcuts. xterm applies theme changes without recreating the terminal.
- **Deps:** config file store; theming

### [todo/P2/S] Live config file watcher (auto-reload on edit)
- **Behavior:** Editing the config file in any external editor automatically reloads settings without a manual reload command.
- **Shortcut/CLI:** -
- **cmux impl:** JSONConfigFileWatcher (kqueue DispatchSource on file + parent dir, AsyncStream<Void>) drives JSONConfigStore.reloadFromDisk; CmuxSettingsFileStore also watches primary/fallback paths. JSONConfigFileWatcher.swift, KeyboardShortcutSettingsFileStore.swift:63.
- **Windows approach:** notify crate (ReadDirectoryChangesW) in Rust watches %USERPROFILE%\.config\scanline\scanline.json and its parent dir; on change debounce then run the config.reload path. Equivalent to kqueue + parent-dir watch for create/replace recovery.
- **Deps:** Reload configuration; config file store

### [todo/P0/M] cmux.json config file (JSONC settings store)
- **Behavior:** A user-editable JSONC config at ~/.config/cmux/cmux.json (with legacy settings.json + Application Support fallbacks) defines actions, UI, notifications, commands, workspace groups, theme overrides, shortcuts, etc.; comments allowed.
- **Shortcut/CLI:** -
- **cmux impl:** CmuxConfigLocation (userConfigFile=.config/cmux/cmux.json, legacyFallbackFile=settings.json); JSONConfigStore + JSONCParser (strips comments) + JSONCObjectEditor (surgical edits preserving formatting); schemaVersion + $schema URL. CmuxConfigLocation.swift, CmuxConfig.swift, KeyboardShortcutSettingsFileStore.swift:33-54.
- **Windows approach:** Adopt %USERPROFILE%\.config\scanline\scanline.json. Parse with json5/jsonc-parser crate (Rust) to allow comments; for surgical edits preserving comments use a JSONC-aware editor crate. Define schemaVersion + $schema. Foundation other config features sit on.

### [todo/P2/M] In-app config editor with Save/Reload/Open-in-editor
- **Behavior:** A 'cmux.json' settings pane (and standalone editor window) shows the config text, a 'synced' read-only effective-config preview, with Save (writes + reloads), Reload, Reveal in Finder, and Open in external editor.
- **Shortcut/CLI:** -
- **cmux impl:** ConfigSettingsView (NSTextView editor, segmented cmux|synced source picker, Save->writeCmuxConfigContents+reloadConfiguration, Reveal/Open via PreferredEditorSettings); SettingsJSONSection. ConfigSettingsView.swift, Sections/SettingsJSONSection.swift, ConfigSource.swift.
- **Windows approach:** DOM textarea or embed Monaco/CodeMirror in the settings webview for JSONC editing with validation; Save via Tauri fs write + config.reload; 'Reveal in Explorer' via 'explorer /select,'; 'Open in editor' via opener plugin or %EDITOR%. 'Synced effective config' = compute resolved settings in Rust, show read-only.
- **Deps:** config file store; Settings window; reload configuration

### [todo/P2/M] Ghostty config reading (themes/fonts/colors)
- **Behavior:** Reads the user's existing Ghostty config (~/.config/ghostty/config, Application Support) for font-family, font-size, theme, background/foreground/cursor/selection colors, 16-color palette, scrollback-limit, unfocused-split opacity, etc., so the terminal matches their Ghostty setup.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyConfig.load/loadFromDisk parses key=value lines across a path precedence list, supports recursive config-file includes, theme: light:/dark: split, color caching per color-scheme. GhosttyConfig.swift:82-970.
- **Windows approach:** Optionally read %APPDATA%\com.mitchellh.ghostty\config and ~/.config/ghostty/config (Ghostty has Windows builds). Implement the same line parser in Rust (font-family, font-size, theme, background, foreground, cursor-color, selection-*, palette N=#hex, scrollback-limit, config-file includes). Map to xterm ITheme. Treat as compatibility import, secondary to native scanline.json theming.
- **Deps:** config file store; theming

### [todo/P2/M] Ghostty theme files + theme search paths
- **Behavior:** theme = <name> resolves a named Ghostty theme file from bundled themes, GHOSTTY_RESOURCES_DIR, XDG_DATA_DIRS, /Applications/Ghostty.app, ~/.config/ghostty/themes; supports light:/dark: dual themes and 'builtin' aliases.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyConfig.themeSearchPaths/themeNameCandidates/resolveThemeName/loadTheme; bundled cmux default themes 'Apple System Colors' light/dark. GhosttyConfig.swift:269-935.
- **Windows approach:** Bundle a themes/ folder of Ghostty-format theme files with the Scanline MSI; resolve theme name -> file across bundled dir + ghostty install dir; parse palette/colors -> xterm ITheme. Port resolveThemeName for light:/dark: split. Ship a couple of built-in defaults.
- **Deps:** Ghostty config reading; theming

### [partial/P1/S] Terminal theming applied to panes (colors + palette)
- **Behavior:** The resolved background/foreground/cursor/selection colors and 16-entry ANSI palette are applied to every terminal pane.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyTerminalAppearance + GhosttyTerminalView apply parsed GhosttyConfig colors/palette to libghostty surfaces; per-color-scheme cached config. GhosttyTerminalAppearance.swift, GhosttyConfig.swift:29-62.
- **Windows approach:** xterm.js ITheme supports background, foreground, cursor, cursorAccent, selectionBackground, and black/red/.../brightWhite (the 16 palette entries). Build an ITheme from resolved config, pass at Terminal construction; update live on reload via term.options.theme. Scanline uses default xterm colors today.
- **Deps:** theming source (config or ghostty)

### [partial/P1/S] Font family / size configuration
- **Behavior:** Terminal font family and size come from config (font-family, font-size) and apply to all panes.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyConfig.fontFamily(default Menlo)/fontSize(default 12)/surfaceTabBarFontSize parsed from config; applied to surfaces. GhosttyConfig.swift:17-19, parse() font-family/font-size cases.
- **Windows approach:** xterm.js term.options.fontFamily/fontSize. Read from scanline.json (font.family/font.size); default to a Windows mono font (Cascadia Mono/Consolas). Apply at construction and live on reload. Scanline uses xterm defaults today.
- **Deps:** config file store

### [todo/P2/M] Light/Dark/System appearance mode
- **Behavior:** App appearance follows System, or is forced Light/Dark; switching live re-themes the UI and synchronizes the terminal theme (light: vs dark: theme variant).
- **Shortcut/CLI:** -
- **cmux impl:** AppearanceSettings (appearanceMode UserDefault: system/light/dark/auto) drives NSApplication.appearance and GhosttyApp.synchronizeThemeWithAppearance; AppearanceSettingsUserDefaultsObserver applies live; terminalColorSchemePreference picks light/dark theme. AppearanceSettings.swift:30-313.
- **Windows approach:** Read system theme via windows-rs (registry HKCU Personalize AppsUseLightTheme) or Tauri Window::theme()/on-theme-changed event. Store appearance mode in scanline.json; apply a light/dark CSS class to the web UI and select the light:/dark: terminal ITheme. Re-apply on WM_SETTINGCHANGE.
- **Deps:** theming; config file store

### [todo/P2/M] CLI theme picker / set / clear
- **Behavior:** cmux themes lists available themes (with current light/dark badges), 'themes set [--light X --dark Y]' writes a managed theme override and live-reloads, 'themes clear' removes it; interactive picker when run in a TTY.
- **Shortcut/CLI:** CLI: cmux themes [list|set|clear]
- **cmux impl:** CMUXCLI+Themes.swift writes a managed '# cmux themes start/end' block into the override config then sends a reload over the socket (com.cmuxterm.themes.reload-config); availableThemeNames + currentThemeSelection. CMUXCLI+Themes.swift:233-538, CMUXCLI+ThemeSupport.swift.
- **Windows approach:** Add 'scanline themes list|set|clear' to the Go CLI; write theme override into a managed block in scanline.json (or a themes section), then send config.reload over the named pipe. Interactive picker optional (simple numbered TTY prompt; skip the Ghostty +list-themes helper).
- **Deps:** config file store; reload configuration; theme files; control server

### [todo/P2/L] Keyboard shortcut customization
- **Behavior:** Users rebind any of ~90 app actions (open settings, splits, focus, find, browser, notifications, etc.) in Settings > Keyboard Shortcuts with a live recorder, support for two-stroke chords, conflict/reserved-key rejection, and unbinding.
- **Shortcut/CLI:** (configured in Settings > Keyboard Shortcuts)
- **cmux impl:** KeyboardShortcutSettings.Action (large enum) + StoredShortcut/ShortcutStroke; KeyboardShortcutRecorder/ShortcutRecorderView record strokes; rejection rules (bareKeyNotAllowed, conflictsWithAction, reservedBySystem, requiresDigit, requiresModifier); persisted in cmux.json. KeyboardShortcutSettings.swift:60-208, KeyboardShortcutsSection.swift.
- **Windows approach:** Define an action enum in TS mirroring Scanline's commands; map to default chords; persist overrides in scanline.json (keyboardShortcuts section). Capture rebinds in a DOM recorder (keydown) with conflict checks; apply via the existing xterm attachCustomKeyEventHandler dispatch table. Two-stroke chords = a small state machine.
- **Deps:** Settings window; config file store; shortcut dispatch

### [todo/P2/M] Keyboard shortcut config + defaults model
- **Behavior:** Each action has a documented default chord; config can override or clear (empty string) a binding; chords expressed as 'cmd+shift+t' strings or arrays for two-stroke.
- **Shortcut/CLI:** -
- **cmux impl:** ShortcutAction + ShortcutAction+Defaults + StoredShortcut.parseConfig(strokes:) in Packages/CmuxSettings; KeyboardShortcutsCatalogSection; FileStore template seeds defaults. ShortcutAction+Defaults.swift, StoredShortcut.swift, KeyboardShortcutSettingsFileStore+Template.swift.
- **Windows approach:** TS defaults table keyed by action; parser for 'ctrl+shift+t' / ['g','t'] forms; '' means unbound. Persist only diffs from defaults in scanline.json. Pure logic, port directly.
- **Deps:** Keyboard shortcut customization

### [todo/P2/S] Global system-wide hotkey
- **Behavior:** A configurable system-wide hotkey shows/hides all app windows even when the app is not focused.
- **Shortcut/CLI:** (configured in Settings > Global Hotkey)
- **cmux impl:** Action .showHideAllWindows + globalHotkey settings section; registered as a system hotkey (Carbon/global event). KeyboardShortcutSettings.swift:62,161, SettingsSectionID.globalHotkey.
- **Windows approach:** tauri-plugin-global-shortcut (RegisterHotKey). Bind to a configured chord; handler toggles all WebviewWindow visibility. Persist in scanline.json.
- **Deps:** config file store; multi-window (for show/hide all)

### [todo/P3/M] Workspace colors / theming customization
- **Behavior:** Users assign colors (and icons) to workspaces/groups; reflected in tabs and indicators; configurable in Settings > Workspace Colors and per-cwd in cmux.json workspaceGroups.byCwd.
- **Shortcut/CLI:** -
- **cmux impl:** CmuxConfigWorkspaceGroupsDefinition/Entry{color,icon,contextMenu,newWorkspacePlacement} keyed by cwd (glob/prefix, longest-match); WorkspaceAppearanceResolution; SettingsWorkspaceColorsBehavior. CmuxConfig.swift:156-191, WorkspaceAppearanceResolution.swift.
- **Windows approach:** Relevant once Scanline has workspaces/tabs (not built). Persist color/icon per workspace-group in scanline.json (workspaceGroups.byCwd) with glob/prefix matching in Rust; apply CSS to tab DOM. Defer with the sidebar/tabs feature.
- **Deps:** workspaces/sidebar tabs (not built); config file store

### [todo/P3/S] Sidebar appearance config
- **Behavior:** Sidebar background color (light/dark/dual), tint opacity, and material are configurable via config (sidebar-background, sidebar-tint-opacity) and Settings > Sidebar.
- **Shortcut/CLI:** -
- **cmux impl:** GhosttyConfig.rawSidebarBackground/sidebarBackgroundLight/Dark/sidebarTintOpacity parsed and pushed to UserDefaults (sidebarTintHex*); SidebarAppearanceSupport + SidebarAppearanceCatalogSection. GhosttyConfig.swift:54-181, Sidebar/SidebarAppearanceSupport.swift.
- **Windows approach:** Deferred until a sidebar exists in Scanline. Persist sidebar.background (light/dark) + tintOpacity in scanline.json; apply via CSS variables. Trivial once the sidebar is built.
- **Deps:** sidebar (not built); config file store

### [todo/P2/L] Custom actions / commands (cmux.json actions + commands)
- **Behavior:** Users define named actions (builtin/command/agent/workspaceCommand) with title, icon, tooltip, shortcut, palette visibility, and project-specific commands that launch from the command palette and tab-bar buttons.
- **Shortcut/CLI:** -
- **cmux impl:** CmuxConfigFile.actions + commands + surfaceTabBarButtons + ui; CmuxConfigActionDefinition/CmuxSurfaceTabBarButton decode with shortcut/icon (symbol/emoji/image with SVG security inspector); resolved via CmuxResolvedConfigAction. CmuxConfig.swift:10-1490, CmuxConfigExecutor.swift, CmuxConfigUI.swift.
- **Windows approach:** Define an actions/commands schema in scanline.json; resolve to a dispatch table in Rust/TS. Icons: SF Symbols don't exist on Windows -> use emoji or bundled SVG/PNG (reuse the SVG safety check). Surface in a command palette (not yet built) and tab-bar buttons. Project-local discovery walks up dirs for .cmux/cmux.json.
- **Deps:** config file store; command palette / tab-bar (not built)

### [todo/P3/M] Project-local config discovery (.cmux/cmux.json)
- **Behavior:** Per-project config is discovered by walking up from the working directory for .cmux/cmux.json or cmux.json, merged with the global config (project-local image icons sandboxed to the project root).
- **Shortcut/CLI:** -
- **cmux impl:** CmuxConfig project-local resolution (walks parent dirs for .cmux/cmux.json then cmux.json); CmuxButtonIcon.projectRoot + safeResolvedImagePath sandbox project-local images. CmuxConfig.swift:2099-2130, 628-634.
- **Windows approach:** Walk up from each pane's cwd for .cmux\cmux.json then cmux.json in Rust; merge over global config; sandbox project-local icon paths to the project root (path-prefix check after canonicalize). Depends on custom actions/commands.
- **Deps:** Custom actions/commands; config file store

### [todo/P3/S] Reset settings to defaults
- **Behavior:** A Settings > Reset pane lets users restore default settings; backups of the settings file are kept.
- **Shortcut/CLI:** -
- **cmux impl:** SettingsSectionID.reset; CmuxSettingsFileStore keeps backups (cmux.settingsFile.backups.v1 UserDefault) and an importedManagedDefaults record. SettingsSectionID.swift:26,46, KeyboardShortcutSettingsFileStore.swift:29-30.
- **Windows approach:** A Reset pane that backs up the current scanline.json (timestamped copy under app data), writes defaults, and reloads. Keep last N backups. Straightforward fs ops in Rust.
- **Deps:** Settings window; config file store

### [todo/P3/S] Preferred external editor setting
- **Behavior:** Config-editor 'Open in Editor' opens the config in the user's preferred editor (resolved from settings/$EDITOR).
- **Shortcut/CLI:** -
- **cmux impl:** PreferredEditorSettings.open(url) used by ConfigSettingsView.openCurrentSourceInEditor. ConfigSettingsView.swift:106-107,244-247.
- **Windows approach:** Resolve %EDITOR%/%VISUAL% or a configured editor path; launch via std::process::Command, falling back to the OS default handler (ShellExecute / Tauri opener). Minor.
- **Deps:** In-app config editor

## packaging-update-infra

### [partial/P0/S] DMG installer (drag-to-Applications)
- **Behavior:** User downloads cmux-macos.dmg from the GitHub releases 'latest' redirect, opens it, sees a styled window, and drags the app to Applications. One download; updates handle the rest.
- **Shortcut/CLI:** -
- **cmux impl:** create-dmg generates a styled, codesigned, notarized DMG in scripts/build-sign-upload.sh (line 119) and release.yml (line 345). README badge links to /releases/latest/download/cmux-macos.dmg.
- **Windows approach:** Replace DMG with Windows installers. Scanline tauri.conf.json already sets bundle.targets='all' (MSI via WiX + NSIS .exe). For Windows the primary deliverable is the NSIS one-click .exe (familiar to users) plus an MSI for enterprise/MDM. Tauri's bundler produces both from `tauri build`. No 'drag to Applications' metaphor — installer runs a wizard. A portable .zip can also be emitted.
- **Deps:** app icon (.ico)

### [todo/P2/M] Homebrew Cask install + upgrade
- **Behavior:** User runs `brew install --cask cmux` and later `brew upgrade --cask cmux`. Cask auto-updated on every release with new version+sha256.
- **Shortcut/CLI:** brew install --cask cmux
- **cmux impl:** homebrew-cmux tap with Casks/cmux.rb; rewritten by build-sign-upload.sh (line 171) and update-homebrew.yml on release, pinning version, sha256, livecheck github_latest, zap trash paths.
- **Windows approach:** Windows equivalents: winget (submit a manifest to microsoft/winget-pkgs via a PR-bot, auto-updated per release with installer URL + SHA256) and/or Scoop bucket (a scoop manifest JSON with version/url/hash). winget is the closest analog; a CI job computes the NSIS/MSI SHA256 and opens a winget-pkgs PR using wingetcreate. Chocolatey is a third option but lower priority.
- **Deps:** Release CI publishing installers

### [todo/P0/L] Sparkle auto-update (stable feed)
- **Behavior:** App silently checks for updates hourly + on launch, downloads in background, and the user gets an in-app prompt/badge to install the new version without re-downloading. Update is cryptographically verified before install.
- **Shortcut/CLI:** -
- **cmux impl:** Sparkle SPUUpdater in Sources/Update/UpdateController.swift; SUFeedURL points at /releases/latest/download/appcast.xml; appcast generated+EdDSA-signed by sparkle_generate_appcast.sh; SUEnableAutomaticChecks default true, scheduledCheckInterval 1h, autoDownloads false (UpdateController lines 8-19); launch probe + hourly background probe (lines 140-159).
- **Windows approach:** tauri-plugin-updater (Rust + JS). Host a static updater JSON manifest (latest.json) on GitHub releases or R2 with {version, notes, pub_date, platforms.windows-x86_64.{url, signature}}. Tauri verifies a minisign signature (its built-in equivalent of Sparkle EdDSA) using a public key embedded in tauri.conf.json. On launch the JS side calls check(); if update found, downloadAndInstall() swaps the NSIS/MSI in place. Configure 'plugins.updater.endpoints' + 'pubkey'. Background hourly poll = a setInterval in the frontend or a Rust tokio task.
- **Deps:** Release CI; updater signing keypair; hosted manifest endpoint

### [todo/P1/M] Sparkle in-app update indicator/pill UI
- **Behavior:** A passive pill/badge appears (titlebar/sidebar) showing 'Update Available: vX.Y', 'Downloading…', 'Ready to install'; user clicks to install. No modal interruption unless they engage.
- **Shortcut/CLI:** -
- **cmux impl:** UpdateViewModel.swift drives state machine (idle/checking/updateAvailable/installing/notFound/error); UpdatePill.swift + UpdateBadge.swift + UpdateTitlebarAccessory.swift render it; UpdateDriver implements Sparkle's SPUUserDriver to feed states.
- **Windows approach:** Build a small DOM component in the frontend that subscribes to tauri-plugin-updater events (check result, download-progress, ready). Render an unobtrusive pill in the Scanline titlebar/toolbar; clicking calls downloadAndInstall() then relaunch(). All state lives in TS — no native UI needed. Map updater states to the same idle/available/downloading/ready labels.
- **Deps:** Sparkle auto-update (updater plugin)

### [todo/P1/S] Check for Updates menu command
- **Behavior:** User picks 'Check for Updates…' (from menu bar extra and app menu); a user-initiated check runs immediately and surfaces result.
- **Shortcut/CLI:** -
- **cmux impl:** UpdateController.checkForUpdates() / checkForUpdatesWhenReady() with retry-until-ready (lines 209-270); wired into MenuBarExtraController checkForUpdatesItem (line 33) and the app menu.
- **Windows approach:** Add a menu item / command-palette entry that calls the updater plugin's check() explicitly and shows result (toast or the pill 'You're up to date'). Trivial once the updater plugin exists. Expose via Scanline's tray menu and/or a window menu.
- **Deps:** Sparkle auto-update; tray menu

### [todo/P2/L] Nightly channel (separate app + own feed)
- **Behavior:** User can download cmux NIGHTLY: a separate app with its own bundle ID that installs alongside stable, built from latest main, auto-updating via its own Sparkle feed.
- **Shortcut/CLI:** -
- **cmux impl:** nightly.yml builds universal app, rewrites bundle ID to com.cmuxterm.app.nightly, CFBundleName 'cmux NIGHTLY', custom AppIcon-Nightly, version 'X-nightly.<runid>', injects SUFeedURL https://files.cmux.com/nightly/appcast.xml; publishes prerelease + uploads appcast to R2; moves 'nightly' git tag.
- **Windows approach:** A nightly.yml that runs on push to main: `tauri build` with a separate identifier (e.g. dev.luizrs.scanline.nightly), distinct productName 'Scanline Nightly', distinct icon, version suffixed with run id, and a nightly updater endpoint (separate latest.json on R2/releases). Publish as a GitHub prerelease. Two updater configs = two tauri.conf flavors (use a config override file passed to `tauri build -c`). Side-by-side install works naturally since identifier differs.
- **Deps:** Sparkle auto-update; Release CI; app icon variants

### [todo/P1/L] Code signing
- **Behavior:** User does not get an 'unknown publisher / untrusted app' warning when installing or launching; SmartScreen is satisfied.
- **Shortcut/CLI:** -
- **cmux impl:** macOS codesign --options runtime --timestamp with Developer ID hash, --deep, plus per-binary signing of bundled cmux CLI + ghostty helper (build-sign-upload.sh lines 93-104; sign-cmux-bundle.sh). Entitlements files (cmux.release.entitlements etc).
- **Windows approach:** Authenticode sign the .exe/.msi and the Scanline.exe + scanline CLI binary with signtool.exe using an EV or OV code-signing cert (ideally cloud HSM e.g. Azure Trusted Signing / DigiCert KeyLocker, since EV certs now require hardware). Tauri supports a signing hook (windows.signCommand in tauri.conf or post-bundle step). EV cert gives instant SmartScreen reputation; OV builds reputation over time. No entitlements concept on Windows.
- **Deps:** Purchase code-signing certificate (resource only Luiz can provide)

### [todo/P2/S] Notarization / OS gatekeeper acceptance
- **Behavior:** App passes Gatekeeper with no quarantine prompt; stapled ticket means it launches offline cleanly.
- **Shortcut/CLI:** -
- **cmux impl:** xcrun notarytool submit --wait + xcrun stapler staple/validate + spctl verify for both app and DMG (release.yml lines 314-359).
- **Windows approach:** No notarization on Windows. The equivalent is Authenticode + SmartScreen reputation. Optionally submit the installer to Microsoft for malware scanning is not required. Mark as covered-by-signing: once signtool signing + timestamping is in place, the 'gatekeeper' concern is satisfied. No separate work item beyond signing + a trusted timestamp server (e.g. http://timestamp.digicert.com).
- **Deps:** Code signing

### [partial/P1/S] App icon
- **Behavior:** App shows a branded icon in installer, Start menu, taskbar, Alt+Tab, and title bar.
- **Shortcut/CLI:** -
- **cmux impl:** Assets.xcassets app icon sets; AppIcon-Debug (orange DEV banner) and AppIcon-Nightly (purple, generate_nightly_icon.py recolors). ensureApplicationIcon() at launch (AppDelegate line 1344).
- **Windows approach:** Provide a multi-resolution icon.ico (16/32/48/64/128/256) plus PNGs; `tauri icon <source.png>` generates the full set including icon.ico/icns and Square*Logo PNGs. tauri.conf.json bundle.icon already lists placeholder paths (icons/icon.ico etc) — currently default Tauri art. Need to design the real Scanline mark and run tauri icon. Debug/Nightly variants = recolored source PNG + separate icon set per build flavor.

### [todo/P2/L] Menu bar extra (status item)
- **Behavior:** A persistent menu-bar icon with an unread-count badge; left-click opens global search, right-click opens a menu (search, show window, task manager, notifications list, mark all read, check for updates, preferences, quit). Icon badge shows up to '9+'.
- **Shortcut/CLI:** -
- **cmux impl:** MenuBarExtraController.swift: NSStatusItem with template image + drawn blue count badge (MenuBarIconRenderer), full NSMenu, subscribes to TerminalNotificationStore snapshot. MenuBarExtraSettings.showInMenuBar default true; MenuBarOnlySettings can make app menu-bar-only (accessory activation policy).
- **Windows approach:** Windows system tray icon via tauri-plugin-tray-icon (TrayIconBuilder). Set a tray icon, a tray menu (Menu/MenuItem) mirroring the cmux items, and tooltip text. Unread badge: there's no native tray badge on Windows, so either (a) swap the tray icon image with a count overlay rendered at runtime, or (b) use a taskbar overlay icon (ITaskbarList3::SetOverlayIcon via the windows crate) which is the idiomatic Windows count indicator. Left-click->global search, right-click->context menu via on_tray_icon_event. 'Menu-bar-only' mode maps to hide main window + keep tray (skipTaskbar).
- **Deps:** global search; notification store (other area)

### [todo/P2/M] Global hotkey: Show/Hide all windows
- **Behavior:** A system-wide hotkey (configurable, default unbound/enabled toggle) toggles cmux visibility from anywhere, restoring previously hidden windows.
- **Shortcut/CLI:** -
- **cmux impl:** see behavior
- **Windows approach:** tauri-plugin-global-shortcut (registers OS-level hotkeys via RegisterHotKey on Windows under the hood). Register the configured combo; handler shows/hides+focuses the main window(s). Track which windows were visible before hide to restore them. Gate behind an enable toggle in settings. Re-register when the user rebinds.
- **Deps:** settings UI for shortcut config; multi-window restore tracking

### [todo/P3/M] Global hotkey: Global search palette
- **Behavior:** A system-wide hotkey opens the cross-window search palette (anchored to the menu-bar item) even when cmux is not focused, lets user fuzzy-find across panels/terminals/browser content and jump to a hit.
- **Shortcut/CLI:** configurable global hotkey
- **cmux impl:** Same SystemWideHotkeyController registers .globalSearch (hotKeyID 2, always enabled when bound); fires AppDelegate.toggleGlobalSearchPaletteFromGlobalHotkey(); GlobalSearchCoordinator + MenubarSearchPopover + SearchIndex provide the palette and full-text index of panel content.
- **Windows approach:** Same tauri-plugin-global-shortcut registration as show/hide. The palette itself is out-of-area (search feature), but the global-hotkey plumbing here just needs to trigger it. On Windows, the palette would be a borderless always-on-top Tauri WebviewWindow rather than a menu-bar popover; the hotkey handler shows + focuses it. Registering two separate global shortcuts via the plugin is straightforward.
- **Deps:** global search feature (other area); global-shortcut plugin

### [todo/P2/M] Sentry crash + hang reporting
- **Behavior:** When the app crashes, hangs (>8s main-thread stall), or hits an error, an anonymized report (with breadcrumb trail of recent UI actions) is sent so devs can fix it. User can opt out.
- **Shortcut/CLI:** -
- **cmux impl:** Sentry SDK started in AppDelegate.didFinishLaunching (line 1289) with embedded DSN, tracesSampleRate 0.1, appHangTimeoutInterval 8s, sendDefaultPii false; SentryHelper.swift breadcrumbs/captureWarning/captureError gated on TelemetrySettings.enabledForCurrentLaunch. dSYMs uploaded to Sentry in release/nightly CI (sentry-cli debug-files upload).
- **Windows approach:** Use sentry-rust (sentry crate) in the Rust core for native crashes/panics (set_hook + sentry::init with DSN + release/environment) and @sentry/browser in the WebView2 frontend for JS errors. Gate both on a 'send anonymous telemetry' setting frozen at launch. Hang detection: a watchdog tokio task or the JS side detecting unresponsive main thread. Upload Rust debug symbols (PDB) via sentry-cli in CI. No dSYM concept; ship .pdb.
- **Deps:** telemetry opt-out setting; Sentry project/DSN (resource)

### [todo/P3/S] PostHog active-usage analytics
- **Behavior:** Anonymous daily/hourly 'active user' pings (deduped per UTC day/hour) tagged with app version/build so the team can track adoption. No PII, no screen tracking; user can opt out.
- **Shortcut/CLI:** -
- **cmux impl:** PostHogAnalytics.swift singleton with embedded public API key, host us.i.posthog.com; emits cmux_daily_active/cmux_hourly_active deduped via UserDefaults UTC keys; 30-min active-check timer; super-properties platform+app_version+app_build; lifecycle/screen capture disabled; gated on TelemetrySettings.
- **Windows approach:** posthog-rs (Rust) or just POST to the PostHog capture endpoint via reqwest with the embedded public key. Generate+persist an anonymous distinct_id in app data dir. Replicate the daily/hourly dedup using a stored last-active UTC day/hour. Tag events with Scanline version/build from tauri's package info. Gate on the same telemetry opt-out. Lightweight; could even be a single fire-and-forget HTTP call on launch + a timer.
- **Deps:** telemetry opt-out setting; PostHog project key (resource)

### [todo/P2/S] Telemetry opt-out setting
- **Behavior:** A single 'Send anonymous telemetry' setting (default ON) controls both Sentry and PostHog; the choice is frozen for the launch session and applies on next restart.
- **Shortcut/CLI:** -
- **cmux impl:** TelemetrySettings enum in AppDelegate (sendAnonymousTelemetryKey, defaultSendAnonymousTelemetry=true, enabledForCurrentLaunch frozen once per launch); checked by both SentryHelper and PostHogAnalytics. Surfaced as a Settings toggle + reset-to-defaults.
- **Windows approach:** A persisted bool in Scanline settings (config file or tauri store), read once at startup into a process-wide flag passed to both the Sentry init and the PostHog pinger. Expose in the eventual settings UI. Until a settings UI exists, default ON with the value readable/writable in the config file. Frozen-per-launch semantics match cmux exactly.
- **Deps:** settings UI (or config-file read)

### [todo/P0/L] Release CI pipeline (build -> sign -> publish)
- **Behavior:** Pushing a version tag (v*) triggers an automated build that produces signed, verified installers, generates the update manifest, and publishes a GitHub release with all assets + release notes.
- **Shortcut/CLI:** git tag vX.Y.Z && git push --tags
- **cmux impl:** release.yml: universal xcodebuild, arch verification, Sparkle key inject, import cert, codesign+notarize, generate appcast, attest provenance, gh-release upload, R2 appcast upload, immutable-asset guard (release_asset_guard.js prevents clobbering signed assets).
- **Windows approach:** A GitHub Actions workflow on windows-latest: `npm ci`, `tauri build` (produces NSIS+MSI), signtool sign, compute SHA256, generate updater latest.json with minisign signature, upload assets to the GitHub release (softprops/action-gh-release) and updater manifest to R2/Pages. Add an immutable-asset guard mirroring release_asset_guard. Attest provenance with actions/attest-build-provenance. No notarytool; replace with signtool + timestamp.
- **Deps:** code signing cert; updater signing key; bundle config

### [todo/P1/S] Version bump tooling + monotonic build guard
- **Behavior:** Maintainer bumps the marketing version with one command; CI guarantees the new build number is strictly greater than the last shipped one so the auto-updater never offers a 'downgrade'.
- **Shortcut/CLI:** ./scripts/bump-version.sh
- **cmux impl:** scripts/bump-version.sh; release.yml step 'Validate Sparkle build number is monotonic' (tests/test_ci_sparkle_build_monotonic.sh); nightly uses GITHUB_RUN_ID+attempt as a monotonic build number.
- **Windows approach:** A bump script that edits version in tauri.conf.json + Cargo.toml (single source of truth). A CI guard that parses the latest released version (gh release list, sort -V) and fails if the tag isn't strictly greater, mirroring test_ci_sparkle_build_monotonic. Tauri's updater compares semver, so enforce monotonic semver rather than an integer build number.
- **Deps:** Release CI

### [todo/P0/S] Updater signing keypair management
- **Behavior:** Invisible to users, but the basis of trust: update payloads are signed with a private key the user's app verifies with an embedded public key, preventing malicious update injection.
- **Shortcut/CLI:** -
- **cmux impl:** Sparkle EdDSA keys: sparkle_generate_keys.sh creates them, derive_sparkle_public_key.swift derives the public key from SPARKLE_PRIVATE_KEY (kept as a CI secret) and injects SUPublicEDKey into Info.plist at build time.
- **Windows approach:** `tauri signer generate` produces a minisign keypair. Store the private key + password as GitHub secrets (TAURI_SIGNING_PRIVATE_KEY / _PASSWORD); embed the public key in tauri.conf.json plugins.updater.pubkey. `tauri build` then auto-signs the bundle and emits the .sig used in latest.json. Direct conceptual 1:1 with Sparkle's EdDSA flow.
- **Deps:** Sparkle auto-update (updater plugin)

### [todo/P1/S] R2/CDN appcast hosting with atomic 'latest' pointer
- **Behavior:** The 'is there an update' feed is served from a fast, always-available CDN URL so update checks are quick and never point at a half-uploaded binary.
- **Shortcut/CLI:** -
- **cmux impl:** appcast.xml uploaded to Cloudflare R2 (s3://cmux-binaries/{stable,nightly}/appcast.xml) with no-cache headers, after the GitHub release publishes; a guard ensures only the highest semver tag overwrites the stable feed (release.yml lines 425-454).
- **Windows approach:** Host latest.json on Cloudflare R2 (or GitHub Pages, or the release 'latest' redirect). CI uploads the manifest after assets land, with no-cache headers, and a 'is this the highest semver' guard before overwriting stable. tauri-plugin-updater endpoints can list multiple fallbacks (R2 + GitHub) for resilience. Same atomicity reasoning applies.
- **Deps:** Release CI; updater plugin

### [todo/P1/S] Single-instance enforcement
- **Behavior:** Launching the app a second time focuses the existing window / routes the new invocation into the running app instead of opening a duplicate process.
- **Shortcut/CLI:** -
- **cmux impl:** AppDelegate.enforceSingleInstance() + observeDuplicateLaunches() + scheduleLaunchServicesBundleRegistration() (lines 1324-1340).
- **Windows approach:** tauri-plugin-single-instance: on a second launch it forwards argv to the running instance (which focuses its window) and exits the new process. Essential on Windows where double-clicking the exe or `scanline` CLI could otherwise spawn duplicates, and needed for protocol/CLI-into-running-app routing. Register a callback to focus the main window.

### [todo/P2/S] Build-channel metadata + verification
- **Behavior:** Each build embeds which channel it is (stable/nightly) and its commit; a DEV build shows a 'Build: DEV / Build Tag' hint in the menu so testers know exactly what they're running.
- **Shortcut/CLI:** -
- **cmux impl:** verify-app-bundle-channel-metadata.sh checks bundle id/feed/icon match the channel in CI; CMUXCommit + nightly version injected into Info.plist; MenuBarBuildHintFormatter shows 'Build: DEV' / 'Build Tag: X' for debug builds (MenuBarExtraController lines 491-519).
- **Windows approach:** Embed channel + git short SHA into the bundle via tauri.conf or a build-time env baked into the Rust binary (env!/option_env! at compile time). Surface a 'Build: DEV (sha)' line in the tray/window menu for dev builds. A CI verification step asserts the built identifier/updater-endpoint/icon match the intended channel before publishing (mirrors verify-app-bundle-channel-metadata.sh).
- **Deps:** Release CI; nightly channel; tray menu
