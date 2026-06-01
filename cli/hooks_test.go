package main

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

func mustUnmarshal(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return v
}

func TestIsScanlineHook(t *testing.T) {
	cases := []struct {
		desc string
		json string
		want bool
	}{
		{
			desc: "Stop event -> true",
			json: `{"hooks":[{"type":"command","command":"/usr/bin/scanline hooks claude Stop"}]}`,
			want: true,
		},
		{
			desc: "UserPromptSubmit -> true",
			json: `{"hooks":[{"type":"command","command":"scanline hooks claude UserPromptSubmit"}]}`,
			want: true,
		},
		{
			desc: "PreToolUse (legacy) -> true",
			json: `{"hooks":[{"type":"command","command":"scanline hooks claude PreToolUse"}]}`,
			want: true,
		},
		{
			desc: "foreign hook -> false",
			json: `{"hooks":[{"type":"command","command":"mytool notify"}]}`,
			want: false,
		},
		{
			desc: "missing hooks key -> false",
			json: `{"matcher":"*"}`,
			want: false,
		},
		{
			desc: "hooks not an array -> false",
			json: `{"hooks":"string-not-array"}`,
			want: false,
		},
		{
			desc: "trailing spaces around suffix -> true",
			json: `{"hooks":[{"type":"command","command":"  scanline hooks claude Stop  "}]}`,
			want: true,
		},
		{
			desc: "partial suffix match -> false",
			json: `{"hooks":[{"type":"command","command":"other hooks claude StopExtra"}]}`,
			want: false,
		},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			v := mustUnmarshal(t, c.json)
			got := isScanlineHook(v)
			if got != c.want {
				t.Errorf("isScanlineHook = %v, want %v", got, c.want)
			}
		})
	}
}

func hookKeys(hooks map[string]any) []string {
	keys := make([]string, 0, len(hooks))
	for k := range hooks {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func entryCount(hooks map[string]any, event string) int {
	arr, ok := hooks[event].([]any)
	if !ok {
		return 0
	}
	return len(arr)
}

func hasForeignHook(hooks map[string]any, event string) bool {
	arr, _ := hooks[event].([]any)
	for _, e := range arr {
		if !isScanlineHook(e) {
			return true
		}
	}
	return false
}

func TestRebuildHooks(t *testing.T) {
	selfCmd := func(event string) string {
		return `"scanline" hooks claude ` + event
	}

	t.Run("empty hooks: 3 events added", func(t *testing.T) {
		result := rebuildHooks(nil, selfCmd)
		got := hookKeys(result)
		want := []string{"Notification", "Stop", "UserPromptSubmit"}
		sort.Strings(want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("keys = %v, want %v", got, want)
		}
		for _, ev := range want {
			if n := entryCount(result, ev); n != 1 {
				t.Errorf("event %s: %d entries, want 1", ev, n)
			}
		}
	})

	t.Run("foreign hook preserved", func(t *testing.T) {
		foreign := map[string]any{
			"hooks": []any{
				map[string]any{"type": "command", "command": "mytool notify"},
			},
		}
		existing := map[string]any{
			"Notification": []any{foreign},
		}
		result := rebuildHooks(existing, selfCmd)
		if !hasForeignHook(result, "Notification") {
			t.Error("foreign hook was removed from Notification")
		}
		// Scanline entry also reinstalled
		if n := entryCount(result, "Notification"); n != 2 {
			t.Errorf("Notification: %d entries, want 2 (1 foreign + 1 scanline)", n)
		}
	})

	t.Run("orphan PreToolUse stripped", func(t *testing.T) {
		orphan := map[string]any{
			"hooks": []any{
				map[string]any{"type": "command", "command": "scanline hooks claude PreToolUse"},
			},
		}
		existing := map[string]any{
			"PreToolUse": []any{orphan},
		}
		result := rebuildHooks(existing, selfCmd)
		if _, ok := result["PreToolUse"]; ok {
			t.Error("PreToolUse should be absent (orphan stripped, not reinstalled)")
		}
	})

	t.Run("existing scanline Stop deduped", func(t *testing.T) {
		old := map[string]any{
			"hooks": []any{
				map[string]any{"type": "command", "command": "scanline hooks claude Stop"},
			},
		}
		existing := map[string]any{
			"Stop": []any{old},
		}
		result := rebuildHooks(existing, selfCmd)
		if n := entryCount(result, "Stop"); n != 1 {
			t.Errorf("Stop: %d entries, want exactly 1 after dedup", n)
		}
	})

	t.Run("event empty after strip is deleted", func(t *testing.T) {
		old := map[string]any{
			"hooks": []any{
				map[string]any{"type": "command", "command": "scanline hooks claude PostToolUse"},
			},
		}
		existing := map[string]any{
			"PostToolUse": []any{old},
		}
		result := rebuildHooks(existing, selfCmd)
		if _, ok := result["PostToolUse"]; ok {
			t.Error("PostToolUse key should be deleted when left empty")
		}
	})
}
