package main

import (
	"reflect"
	"testing"
)

func TestParseSplit(t *testing.T) {
	cases := []struct {
		args    []string
		wantDir string
		wantCmd string
	}{
		{[]string{}, "", ""},
		{[]string{"--dir", "row"}, "row", ""},
		{[]string{"--dir", "col"}, "col", ""},
		{[]string{"--dir", "col", "--", "npm", "run", "dev"}, "col", "npm run dev"},
		{[]string{"--", "echo", "--", "x"}, "", "echo -- x"},
		// --dir with no following value: key consumed, value consumed as next tok
		// when a value IS present; here dir is alone so value is empty string.
		{[]string{"--dir"}, "", ""},
		{[]string{"--dir", "row", "--", "cmd"}, "row", "cmd"},
	}
	for _, c := range cases {
		dir, cmd := parseSplit(c.args)
		if dir != c.wantDir || cmd != c.wantCmd {
			t.Errorf("parseSplit(%v) = (%q,%q), want (%q,%q)",
				c.args, dir, cmd, c.wantDir, c.wantCmd)
		}
	}
}

func TestJoinAfterDashDash(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"a", "b", "c"}, "a b c"},
		{[]string{"--", "a", "b"}, "a b"},
		{[]string{"x", "--", "a", "b"}, "a b"},
		{[]string{"--"}, ""},
		{[]string{}, ""},
	}
	for _, c := range cases {
		got := joinAfterDashDash(c.args)
		if got != c.want {
			t.Errorf("joinAfterDashDash(%v) = %q, want %q", c.args, got, c.want)
		}
	}
}

func TestCallerSurface(t *testing.T) {
	cases := []struct {
		desc    string
		args    []string
		envVal  string // "" means unset
		wantSurf any
		wantRest []string
	}{
		{
			desc:     "flag wins over unset env",
			args:     []string{"--surface", "5", "read"},
			envVal:   "",
			wantSurf: 5,
			wantRest: []string{"read"},
		},
		{
			desc: "bad value: --surface flag dropped, remaining args kept",
			// When the value after --surface fails Atoi, --surface is consumed
			// (the continue skips adding it to rest), but "bad" and "foo" are
			// added as regular positionals on subsequent iterations.
			args:     []string{"--surface", "bad", "foo"},
			envVal:   "",
			wantSurf: nil,
			wantRest: []string{"bad", "foo"},
		},
		{
			desc:     "flag wins over env",
			args:     []string{"--surface", "7"},
			envVal:   "3",
			wantSurf: 7,
			wantRest: []string{},
		},
		{
			desc:     "env used when no flag",
			args:     []string{"extra"},
			envVal:   "3",
			wantSurf: 3,
			wantRest: []string{"extra"},
		},
		{
			desc:     "no flag, no env",
			args:     []string{"x", "y"},
			envVal:   "",
			wantSurf: nil,
			wantRest: []string{"x", "y"},
		},
		{
			desc:     "empty args",
			args:     []string{},
			envVal:   "",
			wantSurf: nil,
			wantRest: []string{},
		},
	}

	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			if c.envVal != "" {
				t.Setenv("SCANLINE_SURFACE_ID", c.envVal)
			} else {
				t.Setenv("SCANLINE_SURFACE_ID", "")
			}
			surf, rest := callerSurface(c.args)
			if surf != c.wantSurf {
				t.Errorf("surface = %v, want %v", surf, c.wantSurf)
			}
			if !reflect.DeepEqual(rest, c.wantRest) {
				t.Errorf("rest = %v, want %v", rest, c.wantRest)
			}
		})
	}
}
