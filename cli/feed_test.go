package main

import (
	"reflect"
	"testing"
)

func TestParseAskArgs(t *testing.T) {
	cases := []struct {
		desc        string
		args        []string
		wantTitle   string
		wantOptions []string
		wantBody    []string
	}{
		{
			desc:        "options with blanks and spaces",
			args:        []string{"--options", "a, b ,,c", "foo", "bar"},
			wantTitle:   "",
			wantOptions: []string{"a", "b", "c"},
			wantBody:    []string{"foo", "bar"},
		},
		{
			desc:        "no options -> default Allow/Deny",
			args:        []string{"is", "this", "ok"},
			wantTitle:   "",
			wantOptions: []string{"Allow", "Deny"},
			wantBody:    []string{"is", "this", "ok"},
		},
		{
			desc:        "title and options and body",
			args:        []string{"--title", "My Q", "--options", "Yes,No", "body text"},
			wantTitle:   "My Q",
			wantOptions: []string{"Yes", "No"},
			wantBody:    []string{"body text"},
		},
		{
			desc:        "empty args -> defaults",
			args:        []string{},
			wantTitle:   "",
			wantOptions: []string{"Allow", "Deny"},
			wantBody:    nil,
		},
		{
			desc:        "options with leading/trailing spaces",
			args:        []string{"--options", " Allow , Deny "},
			wantTitle:   "",
			wantOptions: []string{"Allow", "Deny"},
			wantBody:    nil,
		},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			title, options, body := parseAskArgs(c.args)
			if title != c.wantTitle {
				t.Errorf("title = %q, want %q", title, c.wantTitle)
			}
			if !reflect.DeepEqual(options, c.wantOptions) {
				t.Errorf("options = %v, want %v", options, c.wantOptions)
			}
			if !reflect.DeepEqual(body, c.wantBody) {
				t.Errorf("body = %v, want %v", body, c.wantBody)
			}
		})
	}
}

func TestDecisionIndex(t *testing.T) {
	opts := []string{"Allow", "Deny", "Skip"}
	cases := []struct {
		decision string
		want     int
	}{
		{"Allow", 0},
		{"Deny", 1},
		{"Skip", 2},
		{"", -1},
		{"Unknown", -1},
	}
	for _, c := range cases {
		got := decisionIndex(opts, c.decision)
		if got != c.want {
			t.Errorf("decisionIndex(%v, %q) = %d, want %d", opts, c.decision, got, c.want)
		}
	}
}
