package main

import (
	"reflect"
	"testing"
)

func TestIsKeyName(t *testing.T) {
	trueFor := []string{
		"Enter", "enter", "ESC", "esc",
		"C-c", "c-c", "M-x", "S-a",
		"Tab", "Up", "Down", "Left", "Right",
		"Home", "End", "PageUp", "PageDown",
		"F1", "F12", "C-F1",
		"Delete", "Backspace",
		"Space",
	}
	for _, k := range trueFor {
		if !isKeyName(k) {
			t.Errorf("isKeyName(%q) = false, want true", k)
		}
	}

	falseFor := []string{
		"",
		"hello",
		"C-",          // no base
		"C-section",   // base "section" is not single char or known key
		"X-c",         // modifier X not in set
		"CC-c",        // modifier "CC" not single letter
		"C--",         // base "-" is 0x2d, printable ASCII, so actually true; skip
		"not-a-key",   // two hyphens, last segment "key" is not a base key
	}
	// "C--" would be true (base is '-', a printable ASCII char), so we skip it.
	// Rebuild without it:
	falseFor = []string{
		"",
		"hello",
		"C-",
		"C-section",
		"X-c",
		"CC-c",
		"not-a-key",
	}
	for _, k := range falseFor {
		if isKeyName(k) {
			t.Errorf("isKeyName(%q) = true, want false", k)
		}
	}
}

func TestParseTmuxSplit(t *testing.T) {
	cases := []struct {
		desc    string
		args    []string
		wantDir string
		wantCmd string
	}{
		{"no args defaults col", []string{}, "col", ""},
		{"-h gives row", []string{"-h"}, "row", ""},
		{"-v gives col", []string{"-v"}, "col", ""},
		{"-h with command", []string{"-h", "--", "echo", "hi"}, "row", "echo hi"},
		{"-t value skipped", []string{"-t", "0", "--", "cmd"}, "col", "cmd"},
		{"-d -P boolean flags ignored", []string{"-d", "-P"}, "col", ""},
		{"bare positional", []string{"echo", "hi"}, "col", "echo hi"},
		{"-v then positional", []string{"-v", "mycmd"}, "col", "mycmd"},
		{"-h then --", []string{"-h", "--", "npm", "run", "dev"}, "row", "npm run dev"},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			dir, cmd := parseTmuxSplit(c.args)
			if dir != c.wantDir {
				t.Errorf("dir = %q, want %q", dir, c.wantDir)
			}
			if cmd != c.wantCmd {
				t.Errorf("cmd = %q, want %q", cmd, c.wantCmd)
			}
		})
	}
}

func TestTmuxSendKeys(t *testing.T) {
	cases := []struct {
		desc string
		args []string
		want []string
	}{
		{"target skipped", []string{"-t", "%3", "Enter"}, []string{"Enter"}},
		{"-l flag skipped, literals kept", []string{"-l", "hello", "world"}, []string{"hello", "world"}},
		{"single key", []string{"C-c"}, []string{"C-c"}},
		{"double dash slurps rest", []string{"--", "a", "b"}, []string{"a", "b"}},
		{"empty", []string{}, nil},
		{"mixed flags and keys", []string{"-t", "0", "-l", "Enter"}, []string{"Enter"}},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			got := tmuxSendKeys(c.args)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("tmuxSendKeys(%v) = %v, want %v", c.args, got, c.want)
			}
		})
	}
}
