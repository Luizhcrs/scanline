package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// parseTmuxSplit extracts the direction and optional command from split-window
// args. dir defaults to "col" (tmux vertical = stacked = scanline col).
func parseTmuxSplit(args []string) (dir, command string) {
	dir = "col"
	var cmdParts []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-h":
			dir = "row"
		case a == "-v":
			dir = "col"
		case a == "--":
			cmdParts = append(cmdParts, args[i+1:]...)
			i = len(args)
		case a == "-t" || a == "-c" || a == "-l" || a == "-F":
			i++ // value flag — skip its argument
		case strings.HasPrefix(a, "-"):
			// other boolean flags (-d, -P, -b, ...) ignored
		default:
			cmdParts = append(cmdParts, args[i:]...)
			i = len(args)
		}
	}
	return dir, strings.Join(cmdParts, " ")
}

// tmuxSendKeys extracts the key tokens from send-keys args, skipping -t <val>
// and other flag tokens.
func tmuxSendKeys(args []string) []string {
	var keys []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			keys = append(keys, args[i+1:]...)
			i = len(args)
		case a == "-t":
			i++ // skip target value
		case strings.HasPrefix(a, "-"):
			// -l (literal), -R, etc — boolean flags, no value
		default:
			keys = append(keys, a)
		}
	}
	return keys
}

// runTmuxCompat translates the subset of `tmux` commands that coding agents use
// into Scanline pipe commands. Unknown/unsupported subcommands exit 0 so the
// agent keeps working (tmux returns success for these no-ops).
func runTmuxCompat(args []string) {
	if len(args) == 0 {
		os.Exit(0)
	}
	switch args[0] {
	case "split-window", "splitw":
		dir, cmd := parseTmuxSplit(args[1:])
		m := map[string]any{"dir": dir}
		if cmd != "" {
			m["command"] = cmd
		}
		sendQuiet("pane.split", m)
	case "select-pane", "selectp":
		dir := ""
		for _, a := range args[1:] {
			switch a {
			case "-L":
				dir = "left"
			case "-R":
				dir = "right"
			case "-U":
				dir = "up"
			case "-D":
				dir = "down"
			}
		}
		if dir != "" {
			sendQuiet("pane.focus", map[string]any{"dir": dir})
		}
	case "kill-pane", "killp":
		sendQuiet("pane.close", nil)
	case "resize-pane", "resizep":
		sendQuiet("pane.resize", map[string]any{"delta": 0.05})
	case "send-keys", "send":
		// Each non-flag arg is a key: a key-name (Enter, C-c, Up, …) -> send_key,
		// anything else -> literal send_text. Target the caller's pane (env).
		surf := envSurface()
		keys := tmuxSendKeys(args[1:])
		for _, k := range keys {
			m := map[string]any{}
			if surf != nil {
				m["surface"] = surf
			}
			if isKeyName(k) {
				m["key"] = k
				sendQuiet("surface.send_key", m)
			} else {
				m["text"] = k
				sendQuiet("surface.send_text", m)
			}
		}
	case "list-panes", "lsp":
		if resp, err := rpc("pane.list", nil); err == nil {
			if r, ok := resp["result"]; ok {
				out, _ := json.MarshalIndent(r, "", "  ")
				fmt.Println(string(out))
			}
		}
	case "capture-pane", "capturep":
		m := map[string]any{}
		if s := envSurface(); s != nil {
			m["surface"] = s
		}
		if resp, err := rpc("surface.read_text", m); err == nil {
			if r, ok := resp["result"].(map[string]any); ok {
				if t, ok := r["text"].(string); ok {
					fmt.Print(t)
				}
			}
		}
	case "has-session", "has":
		// the session always "exists" (the running window) — exit 0.
	case "-V", "-v":
		fmt.Println("tmux 3.4")
	default:
		// new-window, display-message, set-option, … — no-op.
	}
	if rpcFailed {
		os.Exit(1)
	}
	os.Exit(0)
}

// set when an RPC fails so runTmuxCompat can exit non-zero (so an agent's tmux
// call doesn't see success when nothing actually happened).
var rpcFailed bool

func sendQuiet(method string, fields map[string]any) {
	resp, err := rpc(method, fields)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline tmux-compat:", err)
		rpcFailed = true
		return
	}
	if ok, _ := resp["ok"].(bool); !ok {
		fmt.Fprintf(os.Stderr, "scanline tmux-compat: %v\n", resp["error"])
		rpcFailed = true
	}
}

func envSurface() any {
	if env := os.Getenv("SCANLINE_SURFACE_ID"); env != "" {
		if n, err := strconv.Atoi(env); err == nil {
			return n
		}
	}
	return nil
}

// isKeyName reports whether a tmux send-keys token is a key name (vs literal text).
//
// Recognized forms (case-insensitive base names):
//
//	Named keys : enter, tab, escape/esc, space, bspace/backspace, up, down,
//	             left, right, home, end, pageup/ppage, pagedown/npage, delete,
//	             btab (S-Tab), ic (Insert), dc (Delete alias), F1-F12.
//	Chords     : <Modifier>-<base> where Modifier is exactly one of C, M, S
//	             (case-insensitive) and base is a single printable ASCII char
//	             or a known named key. Split on the LAST '-' so "C-F1" works.
//	             Conservative: "c-section" has base "section" which is not a
//	             single char or known key, so it stays literal text.
func isKeyName(k string) bool {
	lower := strings.ToLower(k)
	if isBaseKey(lower) {
		return true
	}
	// Chord: split on the last '-' to handle bases like F1-F12.
	idx := strings.LastIndex(k, "-")
	if idx <= 0 {
		return false
	}
	mod := strings.ToLower(k[:idx])
	base := strings.ToLower(k[idx+1:])
	// Modifier must be exactly one of c, m, s (Ctrl, Meta/Alt, Shift).
	if mod != "c" && mod != "m" && mod != "s" {
		return false
	}
	// Base must be a single printable ASCII character or a known named key.
	if len(base) == 1 && base[0] >= 0x20 && base[0] <= 0x7e {
		return true
	}
	return isBaseKey(base)
}

// isBaseKey reports whether lower-cased k is a standalone tmux key name.
func isBaseKey(k string) bool {
	switch k {
	case "enter", "tab", "btab",
		"escape", "esc",
		"space",
		"bspace", "backspace",
		"up", "down", "left", "right",
		"home", "end",
		"pageup", "ppage", "pagedown", "npage",
		"delete", "dc",
		"ic",
		"f1", "f2", "f3", "f4", "f5", "f6",
		"f7", "f8", "f9", "f10", "f11", "f12":
		return true
	}
	return false
}

// launchAgent runs an agent (claude, codex, …) with a fake-tmux environment so
// its `tmux split-window` calls land as panes. A `tmux` shim is placed first on
// PATH; it forwards to `scanline __tmux-compat`.
func launchAgent(agent string, args []string, extraEnv ...string) {
	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	// Resolve the real agent binary BEFORE shadowing PATH with the shim dir.
	agentPath, err := exec.LookPath(agent)
	if err != nil {
		fmt.Fprintf(os.Stderr, "scanline: agent %q not found on PATH\n", agent)
		os.Exit(1)
	}
	shimDir, err := writeTmuxShim(self)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}

	env := append(os.Environ(),
		"PATH="+shimDir+string(os.PathListSeparator)+os.Getenv("PATH"),
		"TMUX="+pipePath+",0,0",
		"TMUX_PANE=%0",
		"SCANLINE_BIN="+self,
	)
	env = append(env, extraEnv...)

	cmd := exec.Command(agentPath, args...)
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode())
		}
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
}

// writeTmuxShim creates a dir with a tmux.cmd that forwards to
// `scanline __tmux-compat`. Returns the dir to prepend to PATH.
func writeTmuxShim(self string) (string, error) {
	dir := filepath.Join(os.Getenv("USERPROFILE"), ".scanline", "shim")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	shim := "@echo off\r\n\"" + self + "\" __tmux-compat %*\r\n"
	if err := os.WriteFile(filepath.Join(dir, "tmux.cmd"), []byte(shim), 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
