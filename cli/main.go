// scanline CLI + tmux-compat shim.
//
// Talks to the running Scanline app over the named pipe \\.\pipe\scanline using
// the same one-line-JSON control protocol the app's Rust control server speaks
// (method + optional dir/url/text/command, ack {"ok":true}).
//
// Two roles:
//   1. Direct CLI:   scanline split|run|web|notify|focus|close
//   2. Agent glue:   scanline <agent> [args]  launches an agent with a fake-tmux
//      environment + a `tmux` shim on PATH, so the agent's `tmux split-window`
//      calls land as real panes in the grid (via `scanline __tmux-compat`).
//
// Clean-room reimplementation (MIT); models cmux's tmux-compat behavior, no code
// copied from the GPL cmux source.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const pipePath = `\\.\pipe\scanline`

// sendPipe writes one JSON command line to the control pipe and returns the ack.
func sendPipe(msg map[string]any) (string, error) {
	f, err := os.OpenFile(pipePath, os.O_RDWR, 0)
	if err != nil {
		return "", fmt.Errorf("Scanline not running? cannot open %s: %w", pipePath, err)
	}
	defer f.Close()

	b, err := json.Marshal(msg)
	if err != nil {
		return "", err
	}
	if _, err := f.Write(append(b, '\n')); err != nil {
		return "", err
	}
	line, _ := bufio.NewReader(f).ReadString('\n')
	return strings.TrimSpace(line), nil
}

func send(msg map[string]any) {
	ack, err := sendPipe(msg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	if ack != "" {
		fmt.Println(ack)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `scanline — control the running Scanline window

  scanline split [--dir row|col] [-- <command...>]   split the focused pane
  scanline run -- <command...>                       split + run a command
  scanline web <url>                                 open a browser pane
  scanline focus <left|right|up|down>                move focus
  scanline notify <text...>                          post a notification
  scanline close                                     close the focused pane
  scanline <agent> [args...]                         launch an agent (fake-tmux)`)
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		os.Exit(1)
	}

	switch args[0] {
	case "-h", "--help", "help":
		usage()
	case "split":
		dir, cmd := parseSplit(args[1:])
		m := map[string]any{"method": "pane.split"}
		if dir != "" {
			m["dir"] = dir
		}
		if cmd != "" {
			m["command"] = cmd
		}
		send(m)
	case "run":
		cmd := strings.TrimSpace(joinAfterDashDash(args[1:]))
		if cmd == "" {
			fmt.Fprintln(os.Stderr, "scanline run: expected -- <command...>")
			os.Exit(1)
		}
		send(map[string]any{"method": "pane.split", "command": cmd})
	case "web":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "scanline web: expected <url>")
			os.Exit(1)
		}
		send(map[string]any{"method": "browser.open", "url": args[1]})
	case "focus":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "scanline focus: expected <left|right|up|down>")
			os.Exit(1)
		}
		send(map[string]any{"method": "pane.focus", "dir": args[1]})
	case "notify":
		send(map[string]any{"method": "notify", "text": strings.Join(args[1:], " ")})
	case "close":
		send(map[string]any{"method": "pane.close"})
	case "__tmux-compat":
		runTmuxCompat(args[1:])
	default:
		launchAgent(args[0], args[1:])
	}
}

// parseSplit extracts --dir and an optional trailing command (after --).
func parseSplit(args []string) (dir, command string) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dir":
			if i+1 < len(args) {
				dir = args[i+1]
				i++
			}
		case "--":
			return dir, strings.Join(args[i+1:], " ")
		}
	}
	return dir, ""
}

func joinAfterDashDash(args []string) string {
	for i, a := range args {
		if a == "--" {
			return strings.Join(args[i+1:], " ")
		}
	}
	return strings.Join(args, " ")
}
