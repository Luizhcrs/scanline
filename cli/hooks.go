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
	c, _ := em["command"].(string)
	if isScanlineCommand(c) {
		return true
	}
	inner, ok := em["hooks"].([]any)
	if ok {
		for _, h := range inner {
			hm, ok := h.(map[string]any)
			if !ok {
				continue
			}
			ic, _ := hm["command"].(string)
			if isScanlineCommand(ic) {
				return true
			}
		}
	}
	return false
}

func isScanlineCommand(c string) bool {
	if c == "" {
		return false
	}
	c = strings.TrimSpace(c)
	for _, ev := range hookEvents {
		if strings.HasSuffix(c, "hooks claude "+ev) {
			return true
		}
	}
	for _, ev := range geminiHookEvents {
		if strings.HasSuffix(c, "hooks gemini "+ev) {
			return true
		}
	}
	for _, ev := range droidHookEvents {
		if strings.HasSuffix(c, "hooks droid "+ev) {
			return true
		}
	}
	for _, ev := range agentAgyEvents {
		if strings.HasSuffix(c, "hooks agy "+ev) {
			return true
		}
	}
	return false
}

// hookEvents is every Claude Code lifecycle event scanline has ever installed a
// hook for (current + legacy), used to recognize and sweep our own entries.
var hookEvents = []string{
	"Notification", "Stop", "SubagentStop", "UserPromptSubmit", "PreToolUse", "PostToolUse",
}

var geminiHookEvents = []string{"BeforeAgent", "BeforeTool", "AfterAgent", "Notification"}
var droidHookEvents = []string{"Notification", "Stop", "UserPromptSubmit"}
var kimiHookEvents = []string{"Notification", "Stop", "UserPromptSubmit"}
// Antigravity CLI (agy) — no Notification event; all tool/invocation events → running.
var agentAgyEvents = []string{"PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"}

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

	agentDisplayNames := map[string]string{
		"claude": "Claude Code",
		"gemini": "Gemini CLI",
		"droid":  "Droid",
		"kimi":   "Kimi Code",
		"agy":    "Antigravity",
	}
	displayName := agentDisplayNames[strings.ToLower(agent)]
	if displayName == "" {
		displayName = agent
	}

	status := ""
	switch strings.ToLower(event) {
	case "notification":
		msg, _ := payload["message"].(string)
		if msg == "" {
			msg = "needs your attention"
		}
		_, _ = rpc("notify", withSurface(map[string]any{"title": displayName, "body": msg}))
		status = "waiting"
	case "stop", "subagentstop", "afteragent", "after_agent":
		status = "idle"
	case "userpromptsubmit", "pretooluse", "posttooluse", "beforeagent", "beforetool", "before_agent", "before_tool",
		"preinvocation", "postinvocation":
		status = "running"
	}
	if status != "" {
		_, _ = rpc("surface.status", withSurface(map[string]any{"status": status}))
	}
	os.Exit(0)
}

// rebuildHooks strips every prior scanline-owned entry across all events and
// reinstalls the current set. selfCmd returns the full command string for a
// given event (e.g. `"<exe>" hooks claude Stop`).
func rebuildHooks(hooks map[string]any, selfCmd func(event string) string) map[string]any {
	if hooks == nil {
		hooks = map[string]any{}
	}
	// Strip EVERY prior scanline-owned entry. This deduplicates and removes
	// orphans from events we no longer install (e.g. Pre/PostToolUse from older
	// versions) and stale exe paths after a move/reinstall.
	for ev, raw := range hooks {
		arr, ok := raw.([]any)
		if !ok {
			continue
		}
		kept := make([]any, 0, len(arr))
		for _, e := range arr {
			if !isScanlineHook(e) {
				kept = append(kept, e)
			}
		}
		if len(kept) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = kept
		}
	}
	// Per-turn events only (not Pre/PostToolUse): a prompt submit flips the dot
	// to running for the whole turn, Stop clears it, Notification flags waiting.
	for _, event := range []string{"Notification", "Stop", "UserPromptSubmit"} {
		cmd := selfCmd(event)
		entry := map[string]any{
			"hooks": []any{map[string]any{"type": "command", "command": cmd}},
		}
		arr, _ := hooks[event].([]any)
		hooks[event] = append(arr, entry)
	}
	return hooks
}

// rebuildGeminiHooks strips prior scanline gemini entries and reinstalls the
// Gemini-specific event set (BeforeAgent, BeforeTool, AfterAgent, Notification).
func rebuildGeminiHooks(hooks map[string]any, selfCmd func(event string) string) map[string]any {
	if hooks == nil {
		hooks = map[string]any{}
	}
	for ev, raw := range hooks {
		arr, ok := raw.([]any)
		if !ok {
			continue
		}
		kept := make([]any, 0, len(arr))
		for _, e := range arr {
			if !isScanlineHook(e) {
				kept = append(kept, e)
			}
		}
		if len(kept) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = kept
		}
	}
	for _, event := range geminiHookEvents {
		cmd := selfCmd(event)
		entry := map[string]any{
			"type":    "command",
			"command": cmd,
		}
		arr, _ := hooks[event].([]any)
		hooks[event] = append(arr, entry)
	}
	return hooks
}

// setupHooks writes hook config so an agent calls back into scanline.
// Handles Claude Code (~/.claude/settings.json or ./.claude/settings.json)
// and auto-detects Gemini CLI, Droid (Factory AI), and Kimi Code.
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
	hooks = rebuildHooks(hooks, func(event string) string {
		return fmt.Sprintf("\"%s\" hooks claude %s", self, event)
	})
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

	profile := os.Getenv("USERPROFILE")

	if _, err := os.Stat(filepath.Join(profile, ".gemini")); err == nil {
		if err := setupGeminiHooks(self); err != nil {
			fmt.Fprintf(os.Stderr, "scanline: gemini hooks warning: %v\n", err)
		}
	}

	if _, err := os.Stat(filepath.Join(profile, ".factory")); err == nil {
		if err := setupDroidHooks(self); err != nil {
			fmt.Fprintf(os.Stderr, "scanline: droid hooks warning: %v\n", err)
		}
	}

	if _, err := os.Stat(filepath.Join(profile, ".kimi-code")); err == nil {
		if err := setupKimiHooks(self); err != nil {
			fmt.Fprintf(os.Stderr, "scanline: kimi hooks warning: %v\n", err)
		}
	}

	// Antigravity CLI (agy): config lives in ~/.gemini/config/hooks.json.
	// Detect by checking if `agy` is in PATH or ~/.gemini/config/ exists.
	agyCfgDir := filepath.Join(profile, ".gemini", "config")
	if _, err := os.Stat(agyCfgDir); err == nil {
		if err := setupAntigravityHooks(self); err != nil {
			fmt.Fprintf(os.Stderr, "scanline: antigravity hooks warning: %v\n", err)
		}
	}
}

// setupAntigravityHooks writes ~/.gemini/config/hooks.json for the Antigravity
// CLI (agy). The format wraps events inside a named group object — different
// from Claude Code / Gemini CLI. Events: PreToolUse, PostToolUse,
// PreInvocation, PostInvocation (→ running) and Stop (→ idle).
// There is no Notification event in Antigravity CLI.
func setupAntigravityHooks(self string) error {
	profile := os.Getenv("USERPROFILE")
	dir := filepath.Join(profile, ".gemini", "config")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "hooks.json")

	root := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &root); err != nil {
			return fmt.Errorf("%s is not valid JSON, leaving it untouched (%v)", path, err)
		}
	}

	// Strip any prior scanline-owned group.
	delete(root, "scanline")

	// Build the scanline group with all Antigravity events.
	group := map[string]any{}
	for _, event := range agentAgyEvents {
		cmd := fmt.Sprintf("\"%s\" hooks agy %s", self, event)
		group[event] = []any{map[string]any{"type": "command", "command": cmd}}
	}
	root["scanline"] = group

	out, _ := json.MarshalIndent(root, "", "  ")
	tmp := path + fmt.Sprintf(".scanline.%d.tmp", os.Getpid())
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	fmt.Printf("installed Antigravity CLI hooks -> %s\n", path)
	return nil
}

func setupGeminiHooks(self string) error {
	profile := os.Getenv("USERPROFILE")
	dir := filepath.Join(profile, ".gemini")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "settings.json")

	settings := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			return fmt.Errorf("%s is not valid JSON, leaving it untouched (%v)", path, err)
		}
	}

	hooks, _ := settings["hooks"].(map[string]any)
	hooks = rebuildGeminiHooks(hooks, func(event string) string {
		return fmt.Sprintf("\"%s\" hooks gemini %s", self, event)
	})
	settings["hooks"] = hooks

	out, _ := json.MarshalIndent(settings, "", "  ")
	tmp := path + fmt.Sprintf(".scanline.%d.tmp", os.Getpid())
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	fmt.Printf("installed Gemini CLI hooks -> %s\n", path)
	return nil
}

func setupDroidHooks(self string) error {
	profile := os.Getenv("USERPROFILE")
	dir := filepath.Join(profile, ".factory")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "hooks.json")

	settings := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			return fmt.Errorf("%s is not valid JSON, leaving it untouched (%v)", path, err)
		}
	}

	hooks, _ := settings["hooks"].(map[string]any)
	hooks = rebuildHooks(hooks, func(event string) string {
		return fmt.Sprintf("\"%s\" hooks droid %s", self, event)
	})
	settings["hooks"] = hooks

	out, _ := json.MarshalIndent(settings, "", "  ")
	tmp := path + fmt.Sprintf(".scanline.%d.tmp", os.Getpid())
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	fmt.Printf("installed Droid (Factory AI) hooks -> %s\n", path)
	return nil
}

func setupKimiHooks(self string) error {
	profile := os.Getenv("USERPROFILE")
	dir := filepath.Join(profile, ".kimi-code")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "config.toml")

	existing := ""
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}

	// Strip existing scanline [[hooks]] blocks. Each block starts at [[hooks]]
	// and ends just before the next [[...]] heading or EOF. We identify ours by
	// the presence of "hooks kimi" in the command line.
	existing = stripKimiScanlineHooks(existing)

	// Append new entries.
	var sb strings.Builder
	sb.WriteString(strings.TrimRight(existing, "\n"))
	if sb.Len() > 0 {
		sb.WriteString("\n")
	}
	for _, event := range kimiHookEvents {
		cmd := fmt.Sprintf("\"%s\" hooks kimi %s", self, event)
		sb.WriteString(fmt.Sprintf("\n[[hooks]]\nevent = %q\ncommand = %q\ntimeout = 30\n", event, cmd))
	}

	out := []byte(sb.String())
	tmp := path + fmt.Sprintf(".scanline.%d.tmp", os.Getpid())
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	fmt.Printf("installed Kimi Code hooks -> %s\n", path)
	return nil
}

// stripKimiScanlineHooks removes [[hooks]] blocks whose command line contains
// "hooks kimi". Blocks are delimited by [[...]] headings or EOF.
func stripKimiScanlineHooks(content string) string {
	lines := strings.Split(content, "\n")
	var out []string
	i := 0
	for i < len(lines) {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[[") && strings.HasSuffix(trimmed, "]]") && strings.Contains(trimmed, "hooks") {
			// Collect the block until the next [[...]] heading or EOF.
			block := []string{line}
			j := i + 1
			for j < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[j]), "[[") {
				block = append(block, lines[j])
				j++
			}
			// Check if this block belongs to scanline.
			isMine := false
			for _, bl := range block {
				if strings.Contains(bl, "hooks kimi") {
					isMine = true
					break
				}
			}
			if !isMine {
				out = append(out, block...)
			}
			i = j
		} else {
			out = append(out, line)
			i++
		}
	}
	return strings.Join(out, "\n")
}
