package main

import (
	"reflect"
	"testing"
)

func TestParseBrowserArgs(t *testing.T) {
	cases := []struct {
		desc    string
		rest    []string
		wantOut string
		wantPos []string
	}{
		{
			desc:    "no args",
			rest:    []string{},
			wantOut: "",
			wantPos: nil,
		},
		{
			desc:    "screenshot with --out",
			rest:    []string{"--out", "x.png"},
			wantOut: "x.png",
			wantPos: nil,
		},
		{
			desc:    "positional args preserved",
			rest:    []string{"#id", "hello world"},
			wantOut: "",
			wantPos: []string{"#id", "hello world"},
		},
		{
			desc:    "fill with ref and text tokens",
			rest:    []string{"#id", "hello", "world"},
			wantOut: "",
			wantPos: []string{"#id", "hello", "world"},
		},
		{
			desc:    "--out as last token with no value: left as positional",
			rest:    []string{"--out"},
			wantOut: "",
			wantPos: []string{"--out"},
		},
		{
			desc:    "mixed positional and --out",
			rest:    []string{"#sel", "--out", "shot.png"},
			wantOut: "shot.png",
			wantPos: []string{"#sel"},
		},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			out, pos := parseBrowserArgs(c.rest)
			if out != c.wantOut {
				t.Errorf("out = %q, want %q", out, c.wantOut)
			}
			if !reflect.DeepEqual(pos, c.wantPos) {
				t.Errorf("pos = %v, want %v", pos, c.wantPos)
			}
		})
	}
}
