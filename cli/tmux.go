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

// runTmuxCompat translates the subset of `tmux` commands that coding agents use
// into Scanline pipe commands. Unknown/unsupported subcommands exit 0 so the
// agent keeps working (tmux returns success for these no-ops).
func runTmuxCompat(args []string) {
	if len(args) == 0 {
		os.Exit(0)
	}
	switch args[0] {
	case "split-window", "splitw":
		dir := "col" // tmux's default split is vertical (stacked)
		var cmdParts []string
		rest := args[1:]
		for i := 0; i < len(rest); i++ {
			a := rest[i]
			switch {
			case a == "-h":
				dir = "row" // horizontal = side by side
			case a == "-v":
				dir = "col"
			case a == "--":
				cmdParts = append(cmdParts, rest[i+1:]...)
				i = len(rest)
			case a == "-t" || a == "-c" || a == "-l" || a == "-F":
				i++ // value flag — skip its argument
			case strings.HasPrefix(a, "-"):
				// other boolean flags (-d, -P, -b, ...) ignored
			default:
				cmdParts = append(cmdParts, rest[i:]...)
				i = len(rest)
			}
		}
		m := map[string]any{"dir": dir}
		if len(cmdParts) > 0 {
			m["command"] = strings.Join(cmdParts, " ")
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
	case "send-keys", "send":
		// Each non-flag arg is a key: a key-name (Enter, C-c, Up, …) -> send_key,
		// anything else -> literal send_text. Target the caller's pane (env).
		surf := envSurface()
		var keys []string
		rest := args[1:]
		for i := 0; i < len(rest); i++ {
			a := rest[i]
			switch {
			case a == "-t":
				i++ // skip target value; we use the caller surface
			case strings.HasPrefix(a, "-"):
				// -l (literal), -R, etc — ignored
			default:
				keys = append(keys, rest[i:]...)
				i = len(rest)
			}
		}
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
		// new-window, capture-pane, display-message, set-option, … — no-op.
	}
	os.Exit(0)
}

func sendQuiet(method string, fields map[string]any) {
	if _, err := rpc(method, fields); err != nil {
		fmt.Fprintln(os.Stderr, "scanline tmux-compat:", err)
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
func isKeyName(k string) bool {
	switch strings.ToLower(k) {
	case "enter", "tab", "escape", "esc", "space", "bspace", "backspace",
		"up", "down", "left", "right", "home", "end", "pageup", "pagedown", "delete":
		return true
	}
	// C-x / M-x chords
	return len(k) >= 3 && (k[1] == '-') && (k[0] == 'C' || k[0] == 'M' || k[0] == 'c' || k[0] == 'm')
}

// launchAgent runs an agent (claude, codex, …) with a fake-tmux environment so
// its `tmux split-window` calls land as panes. A `tmux` shim is placed first on
// PATH; it forwards to `scanline __tmux-compat`.
func launchAgent(agent string, args []string) {
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
