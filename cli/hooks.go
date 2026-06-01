package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// isScanlineHook reports whether a Claude Code hook-array entry was installed by
// scanline (so setup can replace it instead of duplicating it).
func isScanlineHook(e any) bool {
	em, ok := e.(map[string]any)
	if !ok {
		return false
	}
	inner, ok := em["hooks"].([]any)
	if !ok {
		return false
	}
	for _, h := range inner {
		hm, ok := h.(map[string]any)
		if !ok {
			continue
		}
		c, _ := hm["command"].(string)
		if strings.Contains(c, "hooks claude ") && strings.Contains(strings.ToLower(c), "scanline") {
			return true
		}
	}
	return false
}

// runHooks handles `scanline hooks ...`:
//
//	scanline hooks <agent> <event>   (called BY the agent's hook; reads stdin JSON)
//	scanline hooks setup [--project] [agent]   (writes the agent's hook config)
//
// A dispatch maps the agent lifecycle event to a pane status / notification on
// the caller's pane (SCANLINE_SURFACE_ID). Hooks must be fast and never block
// the agent, so failures are swallowed and we always exit 0.
func runHooks(args []string) {
	if len(args) >= 1 && args[0] == "setup" {
		setupHooks(args[1:])
		return
	}
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "scanline hooks: expected <agent> <event> or 'setup'")
		os.Exit(1)
	}
	agent, event := args[0], args[1]

	var payload map[string]any
	if data, _ := io.ReadAll(os.Stdin); len(data) > 0 {
		_ = json.Unmarshal(data, &payload)
	}
	surf := envSurface()
	// The hooks are installed globally in ~/.claude/settings.json, so they also
	// fire for Claude sessions running OUTSIDE Scanline (a plain terminal, CI,
	// another tool). Those have no SCANLINE_SURFACE_ID. Do nothing then —
	// targeting the focused pane would light up / notify the wrong pane (and
	// strand its status dot, since the matching Stop lands elsewhere).
	if surf == nil {
		os.Exit(0)
	}
	withSurface := func(m map[string]any) map[string]any {
		m["surface"] = surf
		return m
	}

	status := ""
	switch event {
	case "Notification":
		msg, _ := payload["message"].(string)
		if msg == "" {
			msg = "needs your attention"
		}
		_, _ = rpc("notify", withSurface(map[string]any{"title": agent, "body": msg}))
		status = "waiting"
	case "Stop", "SubagentStop":
		status = "idle"
	case "UserPromptSubmit", "PreToolUse", "PostToolUse":
		status = "running"
	}
	if status != "" {
		_, _ = rpc("surface.status", withSurface(map[string]any{"status": status}))
	}
	os.Exit(0)
}

// setupHooks writes hook config so an agent calls back into scanline.
// Currently: Claude Code (~/.claude/settings.json or ./.claude/settings.json).
func setupHooks(args []string) {
	project := false
	for _, a := range args {
		if a == "--project" {
			project = true
		}
	}
	self, _ := os.Executable()

	var dir string
	if project {
		dir = filepath.Join(".", ".claude")
	} else {
		dir = filepath.Join(os.Getenv("USERPROFILE"), ".claude")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	path := filepath.Join(dir, "settings.json")

	settings := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			// Never clobber an existing settings.json we can't parse — that would
			// wipe the user's Claude config. Bail and let them fix it (or run with
			// a valid file). Especially important since this runs on every launch.
			fmt.Fprintf(os.Stderr, "scanline: %s is not valid JSON, leaving it untouched (%v)\n", path, err)
			os.Exit(1)
		}
	}

	hooks, _ := settings["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}
	for _, event := range []string{"Notification", "Stop", "UserPromptSubmit", "PreToolUse", "PostToolUse"} {
		cmd := fmt.Sprintf("\"%s\" hooks claude %s", self, event)
		entry := map[string]any{
			"hooks": []any{map[string]any{"type": "command", "command": cmd}},
		}
		// Tool events match against a tool-name pattern; "*" = all tools. The
		// other events (Stop/Notification/UserPromptSubmit) take no matcher.
		if event == "PreToolUse" || event == "PostToolUse" {
			entry["matcher"] = "*"
		}
		// Drop any prior scanline-owned entry (including one pointing at an old
		// exe path after a reinstall/move) and re-add the current one. Comparing
		// the exact command string instead would accumulate stale duplicates.
		arr, _ := hooks[event].([]any)
		kept := make([]any, 0, len(arr))
		for _, e := range arr {
			if !isScanlineHook(e) {
				kept = append(kept, e)
			}
		}
		hooks[event] = append(kept, entry)
	}
	settings["hooks"] = hooks

	out, _ := json.MarshalIndent(settings, "", "  ")
	// Atomic write: temp in the same dir + rename, so an interrupted launch never
	// leaves a half-written (corrupt) global settings.json.
	tmp := path + fmt.Sprintf(".scanline.%d.tmp", os.Getpid())
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	fmt.Printf("installed Claude Code hooks -> %s\n", path)
}
