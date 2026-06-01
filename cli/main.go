// scanline CLI + tmux-compat shim.
//
// Talks to the running Scanline app over the named pipe \\.\pipe\scanline using
// its V2 control protocol: a request is one JSON line {id, method, ...fields};
// the reply is one JSON line {id, ok, result?, error?}.
//
// Two roles:
//   1. Direct CLI:   scanline split|run|web|notify|focus|close|list|send|key
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
	"strconv"
	"strings"
	"sync/atomic"
)

const pipePath = `\\.\pipe\scanline`

var reqCounter uint64

func nextID() string {
	return fmt.Sprintf("%d-%d", os.Getpid(), atomic.AddUint64(&reqCounter, 1))
}

// rpc sends one V2 request and returns the parsed reply.
func rpc(method string, fields map[string]any) (map[string]any, error) {
	f, err := os.OpenFile(pipePath, os.O_RDWR, 0)
	if err != nil {
		return nil, fmt.Errorf("Scanline not running? cannot open %s: %w", pipePath, err)
	}
	defer f.Close()

	req := map[string]any{"id": nextID(), "method": method}
	for k, v := range fields {
		req[k] = v
	}
	b, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if _, err := f.Write(append(b, '\n')); err != nil {
		return nil, err
	}
	line, _ := bufio.NewReader(f).ReadString('\n')
	var resp map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &resp); err != nil {
		return nil, fmt.Errorf("bad reply %q: %w", strings.TrimSpace(line), err)
	}
	return resp, nil
}

// send runs an rpc, prints any result, and exits non-zero on error.
func send(method string, fields map[string]any) {
	resp, err := rpc(method, fields)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	if ok, _ := resp["ok"].(bool); !ok {
		fmt.Fprintf(os.Stderr, "scanline: %v\n", resp["error"])
		os.Exit(1)
	}
	if r, ok := resp["result"]; ok {
		out, _ := json.MarshalIndent(r, "", "  ")
		fmt.Println(string(out))
	}
}

// callerSurface resolves the default target: --surface flag wins, else the
// SCANLINE_SURFACE_ID env injected into the caller's pane, else nil (focused).
func callerSurface(args []string) (surface any, rest []string) {
	rest = []string{}
	for i := 0; i < len(args); i++ {
		if args[i] == "--surface" && i+1 < len(args) {
			// Only consume the value if it parses; a bad value is left as a
			// positional rather than silently swallowing the next real arg.
			if n, err := strconv.Atoi(args[i+1]); err == nil {
				surface = n
				i++
			}
			continue
		}
		rest = append(rest, args[i])
	}
	if surface == nil {
		if env := os.Getenv("SCANLINE_SURFACE_ID"); env != "" {
			if n, err := strconv.Atoi(env); err == nil {
				surface = n
			}
		}
	}
	return surface, rest
}

func usage() {
	fmt.Fprintln(os.Stderr, `scanline — control the running Scanline window

  scanline split [--dir row|col] [-- <command...>]   split the focused pane
  scanline run -- <command...>                       split + run a command
  scanline web <url>                                 open a browser pane
  scanline browser <verb> [args] [--surface N]       drive a browser pane
       open <url> | snapshot | url | eval <js> | click <ref> | fill <ref> <text>
       type <ref> <text> | text [css] | exists <css> | wait <css> | zoom <f>
       navigate <url> | back | forward | reload | screenshot [--out f.png]
  scanline focus <left|right|up|down>                move focus
  scanline list                                      list panes (id, kind, focused, rect)
  scanline read [--surface N]                        read a pane's buffer (scrollback)
  scanline send [--surface N] <text...>              send literal text to a pane
  scanline key  [--surface N] <key>                  send a key/chord (enter, c-c, up, …)
  scanline notify [--title T] <body...>              post a notification
  scanline close                                     close the focused pane
  scanline surface [new|next|prev|close|select <n>]  per-pane terminal tabs
  scanline ws [list|new|select <id>|close <id>|rename <id> <name>|current]  workspaces
  scanline equalize | zoom | resize [delta]          layout: equalize / zoom / resize focused
  scanline notif [clear]                             list (or clear) notifications
  scanline status [--surface N] <running|waiting|idle|error>  set pane status dot
  scanline hooks <agent> <event>                     agent hook dispatch (stdin JSON)
  scanline hooks setup [--project]                   install Claude Code hooks
  scanline ask [--title T] [--options a,b,c] <q...>  blocking approval card; prints choice
  scanline claude-teams [args...]                    launch Claude in teammate mode
  scanline ping                                      health check
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
		m := map[string]any{}
		if dir != "" {
			m["dir"] = dir
		}
		if cmd != "" {
			m["command"] = cmd
		}
		send("pane.split", m)
	case "run":
		cmd := strings.TrimSpace(joinAfterDashDash(args[1:]))
		if cmd == "" {
			fmt.Fprintln(os.Stderr, "scanline run: expected -- <command...>")
			os.Exit(1)
		}
		send("pane.split", map[string]any{"command": cmd})
	case "web":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "scanline web: expected <url>")
			os.Exit(1)
		}
		send("browser.open", map[string]any{"url": args[1]})
	case "browser":
		runBrowser(args[1:])
	case "focus":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "scanline focus: expected <left|right|up|down>")
			os.Exit(1)
		}
		send("pane.focus", map[string]any{"dir": args[1]})
	case "list":
		send("pane.list", nil)
	case "read":
		surface, _ := callerSurface(args[1:])
		m := map[string]any{}
		if surface != nil {
			m["surface"] = surface
		}
		resp, err := rpc("surface.read_text", m)
		if err != nil {
			fmt.Fprintln(os.Stderr, "scanline:", err)
			os.Exit(1)
		}
		if ok, _ := resp["ok"].(bool); !ok {
			fmt.Fprintf(os.Stderr, "scanline: %v\n", resp["error"])
			os.Exit(1)
		}
		if r, ok := resp["result"].(map[string]any); ok {
			if t, ok := r["text"].(string); ok {
				fmt.Print(t)
			}
		}
	case "send":
		surface, rest := callerSurface(args[1:])
		m := map[string]any{"text": strings.Join(rest, " ")}
		if surface != nil {
			m["surface"] = surface
		}
		send("surface.send_text", m)
	case "key":
		surface, rest := callerSurface(args[1:])
		if len(rest) == 0 {
			fmt.Fprintln(os.Stderr, "scanline key: expected <key>")
			os.Exit(1)
		}
		m := map[string]any{"key": rest[0]}
		if surface != nil {
			m["surface"] = surface
		}
		send("surface.send_key", m)
	case "notify":
		rest := args[1:]
		title := ""
		if len(rest) >= 2 && rest[0] == "--title" {
			title = rest[1]
			rest = rest[2:]
		}
		surface, body := callerSurface(rest)
		m := map[string]any{"title": title, "body": strings.Join(body, " ")}
		if surface != nil {
			m["surface"] = surface
		}
		send("notify", m)
	case "close":
		send("pane.close", nil)
	case "workspace", "ws":
		sub := "list"
		if len(args) >= 2 {
			sub = args[1]
		}
		m := map[string]any{}
		switch sub {
		case "select", "close":
			if len(args) >= 3 {
				if n, err := strconv.Atoi(args[2]); err == nil {
					m["workspace"] = n
				}
			}
		case "rename":
			if len(args) >= 3 {
				if n, err := strconv.Atoi(args[2]); err == nil {
					m["workspace"] = n
				}
				m["name"] = strings.Join(args[3:], " ")
			}
		}
		send("workspace."+sub, m)
	case "surface":
		sub := "new"
		if len(args) >= 2 {
			sub = args[1]
		}
		m := map[string]any{}
		if sub == "select" && len(args) >= 3 {
			// 1-based for the user (matches Ctrl+1..8); protocol delta is 0-based.
			if n, err := strconv.Atoi(args[2]); err == nil {
				m["delta"] = n - 1
			}
		}
		send("surface."+sub, m)
	case "equalize":
		send("pane.equalize", nil)
	case "zoom":
		send("pane.zoom", nil)
	case "resize":
		delta := 0.05
		if len(args) >= 2 {
			if d, err := strconv.ParseFloat(args[1], 64); err == nil {
				delta = d
			}
		}
		send("pane.resize", map[string]any{"delta": delta})
	case "notif":
		if len(args) >= 2 && args[1] == "clear" {
			send("notif.clear", nil)
		} else {
			send("notif.list", nil)
		}
	case "status":
		surface, rest := callerSurface(args[1:])
		st := "idle"
		if len(rest) > 0 {
			st = rest[0]
		}
		m := map[string]any{"status": st}
		if surface != nil {
			m["surface"] = surface
		}
		send("surface.status", m)
	case "hooks":
		runHooks(args[1:])
	case "ask":
		runAsk(args[1:])
	case "claude-teams":
		// Claude Code in teammate mode: same fake-tmux launch, plus a marker
		// env the agent (and its hooks) can key off of.
		launchAgent("claude", args[1:], "SCANLINE_CLAUDE_TEAMS=1")
	case "ping":
		send("system.ping", nil)
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
