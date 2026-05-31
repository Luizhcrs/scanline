package main

import (
	"encoding/base64"
	"fmt"
	"os"
)

// runBrowser drives the scriptable browser API. The verb's positional args are
// passed through as an array; the frontend interprets them per verb.
//
//	scanline browser open <url>
//	scanline browser snapshot | url | text [css] | html [css]
//	scanline browser eval <js> | exists <css> | wait <css> | count <css>
//	scanline browser click <ref|css> | fill|type <ref|css> <text...>
//	scanline browser find <text...> | attr <ref> <name> | value <ref>
//	scanline browser visible <ref> | checked <ref> | check|uncheck <ref>
//	scanline browser select <ref> <value> | scroll [ref] | press <key>
//	scanline browser zoom <f> | viewport <w> <h> | cookies [clear]
//	scanline browser storage [get [k] | set <k> <v> | clear] | devtools
//	scanline browser navigate <url> | back | forward | reload
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

	out := ""
	pos := []string{}
	for i := 0; i < len(rest); i++ {
		if rest[i] == "--out" && i+1 < len(rest) {
			out = rest[i+1]
			i++
			continue
		}
		pos = append(pos, rest[i])
	}

	m := map[string]any{"verb": verb, "args": pos}
	if surface != nil {
		m["surface"] = surface
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
