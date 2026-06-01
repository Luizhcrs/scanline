package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

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
	withSurface := func(m map[string]any) map[string]any {
		if surf != nil {
			m["surface"] = surf
		}
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
		_ = json.Unmarshal(data, &settings)
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
		arr, _ := hooks[event].([]any)
		// Skip if a scanline hook for this event is already present.
		dup := false
		for _, e := range arr {
			if em, ok := e.(map[string]any); ok {
				if inner, ok := em["hooks"].([]any); ok {
					for _, h := range inner {
						if hm, ok := h.(map[string]any); ok {
							if c, _ := hm["command"].(string); c == cmd {
								dup = true
							}
						}
					}
				}
			}
		}
		if !dup {
			hooks[event] = append(arr, entry)
		}
	}
	settings["hooks"] = hooks

	out, _ := json.MarshalIndent(settings, "", "  ")
	if err := os.WriteFile(path, out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	fmt.Printf("installed Claude Code hooks -> %s\n", path)
}
