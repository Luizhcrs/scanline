package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// runBrowser drives the scriptable browser API:
//
//	scanline browser open <url>
//	scanline browser snapshot|url
//	scanline browser eval <js>
//	scanline browser click <ref|css>
//	scanline browser fill|type <ref|css> <text...>
//	scanline browser text [css] | exists <css> | wait <css>
//	scanline browser navigate <url> | back | forward | reload | zoom <factor>
//	scanline browser screenshot [--out file.png]
//	(all accept --surface N to pick a browser pane)
func runBrowser(args []string) {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "scanline browser: expected a verb")
		os.Exit(1)
	}
	if args[0] == "open" {
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "scanline browser open: expected <url>")
			os.Exit(1)
		}
		send("browser.open", map[string]any{"url": args[1]})
		return
	}

	surface, rest := callerSurface(args)
	if len(rest) == 0 {
		fmt.Fprintln(os.Stderr, "scanline browser: expected a verb")
		os.Exit(1)
	}
	verb := rest[0]
	rest = rest[1:]

	// pull out --out (screenshot target) from the positionals
	out := ""
	var pos []string
	for i := 0; i < len(rest); i++ {
		if rest[i] == "--out" && i+1 < len(rest) {
			out = rest[i+1]
			i++
			continue
		}
		pos = append(pos, rest[i])
	}

	m := map[string]any{"verb": verb}
	if surface != nil {
		m["surface"] = surface
	}
	switch verb {
	case "eval", "exists", "wait", "text", "url", "snapshot":
		m["text"] = strings.Join(pos, " ")
	case "click":
		if len(pos) > 0 {
			m["ref"] = pos[0]
		}
	case "fill", "type":
		if len(pos) > 0 {
			m["ref"] = pos[0]
			m["text"] = strings.Join(pos[1:], " ")
		}
	case "navigate":
		if len(pos) > 0 {
			m["url"] = pos[0]
		}
	case "zoom":
		if len(pos) > 0 {
			if f, err := strconv.ParseFloat(pos[0], 64); err == nil {
				m["delta"] = f
			}
		}
	}

	if verb == "screenshot" {
		resp, err := rpc("browser", m)
		if err != nil {
			fmt.Fprintln(os.Stderr, "scanline:", err)
			os.Exit(1)
		}
		if ok, _ := resp["ok"].(bool); !ok {
			fmt.Fprintf(os.Stderr, "scanline: %v\n", resp["error"])
			os.Exit(1)
		}
		if r, ok := resp["result"].(map[string]any); ok {
			if data, ok := r["data"].(string); ok && data != "" {
				b, derr := base64.StdEncoding.DecodeString(data)
				if derr != nil {
					fmt.Fprintln(os.Stderr, "scanline: bad screenshot data:", derr)
					os.Exit(1)
				}
				if out == "" {
					out = "scanline-screenshot.png"
				}
				if werr := os.WriteFile(out, b, 0o644); werr != nil {
					fmt.Fprintln(os.Stderr, "scanline:", werr)
					os.Exit(1)
				}
				fmt.Printf("saved %s (%d bytes)\n", out, len(b))
			}
		}
		return
	}

	send("browser", m)
}
