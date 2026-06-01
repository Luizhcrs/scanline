package main

import (
	"fmt"
	"os"
	"strings"
)

// runAsk implements `scanline ask`: post a blocking approval card to the
// Feed panel and wait for the user to click an option. The chosen option is
// printed to stdout. The call blocks until the user decides (the app holds the
// pipe reply open up to 600s), so an agent hook can gate on the answer.
//
//	scanline ask [--title T] [--options a,b,c] <prompt...>
//
// Default options are Allow,Deny. Exit code is 0 when the first option is
// chosen (the "allow"-style affirmative), 1 otherwise — so a hook can branch
// on `scanline ask ... && <proceed>`.
func runAsk(args []string) {
	title := ""
	options := []string{}
	body := []string{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--title":
			if i+1 < len(args) {
				title = args[i+1]
				i++
			}
		case "--options":
			if i+1 < len(args) {
				for _, o := range strings.Split(args[i+1], ",") {
					if o = strings.TrimSpace(o); o != "" {
						options = append(options, o)
					}
				}
				i++
			}
		default:
			body = append(body, args[i])
		}
	}
	if len(options) == 0 {
		options = []string{"Allow", "Deny"}
	}

	m := map[string]any{
		"title":   title,
		"body":    strings.Join(body, " "),
		"options": options,
	}
	resp, err := rpc("feed.ask", m)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scanline:", err)
		os.Exit(1)
	}
	if ok, _ := resp["ok"].(bool); !ok {
		fmt.Fprintf(os.Stderr, "scanline: %v\n", resp["error"])
		os.Exit(1)
	}
	decision := ""
	if r, ok := resp["result"].(map[string]any); ok {
		decision, _ = r["decision"].(string)
	}
	fmt.Println(decision)
	if decision != options[0] {
		os.Exit(1)
	}
}
