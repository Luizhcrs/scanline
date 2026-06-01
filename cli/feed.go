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
// Default options are Allow,Deny. Exit code is the 0-based index of the chosen
// option (Allow=0, Deny=1, …) so `scanline ask ... && <proceed>` gates on the
// first option while richer callers branch on $?. A dismissed/timed-out card
// prints an empty line and exits 64, distinguishable from a real choice.
// parseAskArgs parses the args for `scanline ask`. Returns the title, option
// list (defaulting to Allow/Deny), and the remaining body tokens.
func parseAskArgs(args []string) (title string, options, body []string) {
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
	return title, options, body
}

// decisionIndex returns the 0-based index of decision in options, or -1 if not
// found (card dismissed or timed out).
func decisionIndex(options []string, decision string) int {
	for i, o := range options {
		if o == decision {
			return i
		}
	}
	return -1
}

func runAsk(args []string) {
	title, options, body := parseAskArgs(args)

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
	idx := decisionIndex(options, decision)
	if idx < 0 {
		// Empty/unknown decision: card dismissed or the call timed out. Make
		// it distinguishable from a real option choice (esp. a real "Deny").
		fmt.Fprintln(os.Stderr, "scanline: no decision (card dismissed or timed out)")
		os.Exit(64)
	}
	os.Exit(idx)
}
