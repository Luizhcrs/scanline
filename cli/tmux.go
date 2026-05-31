package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
				// first positional = the command; take the rest verbatim
				cmdParts = append(cmdParts, rest[i:]...)
				i = len(rest)
			}
		}
		m := map[string]any{"method": "pane.split", "dir": dir}
		if len(cmdParts) > 0 {
			m["command"] = strings.Join(cmdParts, " ")
		}
		sendQuiet(m)
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
			sendQuiet(map[string]any{"method": "pane.focus", "dir": dir})
		}
	case "kill-pane", "killp":
		sendQuiet(map[string]any{"method": "pane.close"})
	case "-V", "-v":
		fmt.Println("tmux 3.4")
	default:
		// new-window, send-keys, set-option, has-session, display-message, … —
		// accepted as no-ops so agents that probe tmux don't error out.
	}
	os.Exit(0)
}

func sendQuiet(m map[string]any) {
	if _, err := sendPipe(m); err != nil {
		fmt.Fprintln(os.Stderr, "scanline tmux-compat:", err)
	}
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
