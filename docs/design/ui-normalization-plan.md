# Scanline UI normalization plan

Status: partially applied. The token system below and the green-to-blue accent
migration shipped in `app/src/styles.css`; the per-component unification steps
are the remaining roadmap. Derived from a UI audit (60 findings, 4 dimensions).
Reference for the dark, minimalist, single-accent identity — not a description
of the final state.

## Tokens

The `:root` block now living at the top of `app/src/styles.css`; hardcoded hex
values were replaced with these tokens.

```css
:root {
  /* ============ SCANLINE DESIGN TOKENS ============
     Minimal, dark, terminal-native. One identity for all chrome.
     Terminal content keeps its own xterm font/colors. */

  /* --- Surfaces (darkest sink -> elevated overlay) --- */
  --bg: #0d1017;          /* app background, active tab, palette/find/browser inputs (was also hardcoded L756,774,802,848) */
  --bg-sink: #0a0d13;     /* darkest: sidebar, surface-tabs strip, settings inputs (L78,170,298,502,516) */
  --bg-elev: #11151f;     /* elevated floating surface: ALL overlays + cards + tabs (L154,204,308,404,477,638,734,794,838) */
  --bg-elev2: #161b26;    /* secondary elevation: row hover / subtle dividers (collapse context-menu bg into --bg-elev) */

  /* --- Borders --- */
  --border: #1c2230;          /* default 1px borders (alias of legacy --gutter) */
  --border-strong: #2d3650;   /* stronger borders, hover bg, separators, scrollbar thumb */
  --border-strongest: #3a455f;/* scrollbar thumb hover only */
  --gutter: var(--border);            /* semantic alias kept for split dividers */
  --gutter-hover: var(--border-strong);

  /* --- Text --- */
  --text: #c5c8c6;        /* primary text */
  --text-soft: #a8acb3;   /* secondary (labels, body, hints) — absorbs #aeb4c0 */
  --text-dim: #8a8f99;    /* dim (inactive rows, close glyphs) */
  --text-faint: #5a6172;  /* faint (meta, grip dots, kbd hints) */

  /* --- Accent (interactive blue) --- */
  --accent: #5aa0ff;          /* selection, focus ring, primary buttons, flags, notif ring */
  --accent-hover: #6fb0ff;    /* primary button hover */
  --accent-bg: #1c2740;       /* selected-row accent surface (palette .sel) */
  --accent-rgb: 90 160 255;   /* for glow alphas: rgb(var(--accent-rgb) / .25) */
  --on-accent: #0a0d13;       /* text/icon on accent fills (unify #061018 -> this) */

  /* --- Signal (green: pane focus / agent) — distinct from interactive accent --- */
  --signal: #5ff967;          /* renamed concept of legacy --focus */
  --focus: var(--signal);     /* back-compat alias */
  --signal-rgb: 95 249 103;   /* for glow alphas */

  /* --- Status --- */
  --danger: #c0392b;      /* destructive hover, error dot */
  --on-danger: #ffffff;   /* text on danger fill */
  --warning: #e3b341;     /* running/pending dot */

  /* --- Radius scale --- */
  --r-xs: 3px;   /* tiny chips: inline rename, close glyphs, grip */
  --r-sm: 5px;   /* controls: buttons, inputs, tabs, menu items */
  --r-md: 8px;   /* containers: menus, panels, bars, badge */
  --r-lg: 10px;  /* large modals: settings/help/palette/feed cards */
  /* status dots stay 50% */

  /* --- Spacing scale (4px rhythm) --- */
  --s1: 2px;
  --s2: 4px;
  --s3: 6px;
  --s4: 8px;
  --s5: 12px;
  --s6: 16px;
  --s7: 20px;

  /* --- Type scale --- */
  --fs-xs: 10px;   /* badges, meta */
  --fs-sm: 11px;   /* hints, tabs */
  --fs-base: 12px; /* body chrome */
  --fs-md: 13px;   /* menus / dialog body */
  --fs-lg: 14px;   /* palette input, icon glyph buttons */
  --fs-xl: 16px;   /* titles */

  /* --- Borders widths --- */
  --bw-hair: 1px;  /* default borders + focus ring */
  --bw-emph: 2px;  /* drag drop-target + accent bars */

  /* --- Elevation --- */
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.5);  /* menu, find, notif */
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.6);   /* palette, settings, help, feed */
  --scrim: rgba(0, 0, 0, 0.5);                      /* one modal backdrop dim */

  /* --- Layering scale --- */
  --z-popover: 2000;  /* context-menu, find-bar (transient) */
  --z-overlay: 2100;  /* notif-panel, feed-panel (persistent popovers) */
  --z-modal: 2500;    /* palette, settings, help (full modal) */

  /* --- Motion --- */
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --t-fast: 0.12s;    /* hover/press feedback */
  --t-enter: 0.14s;   /* overlay fade-in */

  /* --- Chrome font --- */
  --ui-font: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
}
```

## Regras por componente

### Floating surface (all overlays: notif-panel, settings-card, help-card, palette-box, context-menu, find-bar, feed-panel)
One surface identity. Background --bg-elev, border --bw-hair solid --border-strong, text --text. Context-menu drops its odd #161b26 bg and joins --bg-elev (line 590). Inputs inside an overlay use --bg (palette/find/browser) or --bg-sink (settings).

Tokens: --bg-elev, --border-strong, --text, --bw-hair

### Modal (settings, help, palette) vs Popover (context-menu, find, notif, feed)
Modals: position:fixed, inset:0 flex-center, scrim --scrim backdrop, z-index --z-modal, radius --r-lg, shadow --shadow-modal. Popovers: coordinate/edge placed, no backdrop, radius --r-md, shadow --shadow-popover. notif-panel z-index lifts from 1000 to --z-overlay (2100) so it stops being buried (line 407); palette backdrop changes 0.35 -> --scrim to match settings (line 785).

Tokens: --scrim, --shadow-modal, --shadow-popover, --z-modal, --z-overlay, --r-lg, --r-md

### Overlay header (notif-panel-header, settings-title, help-section group, feed-header)
Shared .overlay-header: padding --s4 --s5, font-weight 600, font-size --fs-base, border-bottom --bw-hair solid --border. Title variant for forms uses --fs-xl with margin-bottom --s5 and no border. Palette stays headerless by design (input is the header).

Tokens: --s4, --s5, --border, --fs-base, --fs-xl

### Selectable row (palette-row, context-item, notif-row, ws-row, feed-card)
One actionable-row pattern. padding --s4 --s5 (context-item may stay denser --s3 --s5). hover background --border-strong; keyboard/selected background --accent-bg. cursor:pointer and the transition come from the shared class, not per-component. Collapse the three highlight hexes (#1c2740/#2d3650/#161b26) into --accent-bg (selected) and --border-strong (hover). a11y: role=option/menuitem + tabindex + Enter/Space; rely on global :focus-visible ring.

Tokens: --s4, --s5, --accent-bg, --border-strong, --r-sm

### Button base (.btn replacing settings-btn, feed-btn, find-btn, notif-clear, browser-bar button, ws-add)
Single base: background --border, border --bw-hair solid --border-strong, radius --r-sm, padding --s3 --s6, font:inherit, hover background --border-strong, transition background --t-fast --ease, :active { transform: translateY(1px); filter: brightness(0.92) }. Modifiers: .btn--icon (square 26px, --fs-lg glyph, centered, no border), .btn--primary (bg --accent, border --accent, color --on-accent, weight 600, hover --accent-hover), .btn--danger (hover bg --danger, color --on-danger). [disabled],.is-disabled { opacity:0.4; cursor:default; pointer-events:none }.

Tokens: --border, --border-strong, --r-sm, --s3, --s6, --accent, --accent-hover, --on-accent, --danger, --on-danger, --t-fast

### Text input (settings-input, find-input, palette-input, browser-url, ws-rename)
One .input convention: background --bg or --bg-sink, border --bw-hair solid --border, radius --r-sm (inline rename --r-xs), font:inherit, outline:none. Remove bespoke :focus border-color overrides (settings-input L510, browser-url L763) — keyboard focus is shown only by the global :focus-visible ring so mouse-focus does not draw a colored border. palette-input may stay square (radius 0) as a documented flush-in-container exception.

Tokens: --bg, --bg-sink, --border, --r-sm, --r-xs

### Icon-only control (close ✕, add +, browser nav, find prev/next)
Min 24px square hit area even with a small glyph. Every glyph-only control gets an aria-label (and title). Glyph size --fs-lg (14px) unified — drop the lone 15px browser glyph (line 745). Close variants use .btn--danger hover.

Tokens: --fs-lg, --danger, --on-danger

### Focus & selection accent split
Two systems, no mixing. --signal (green) ONLY for pane focus, pane flash, ws-loading runner, browser-url focus border, expressed via --signal-rgb glows. --accent (blue) for keyboard focus ring, selection, primary actions, notif/drop ring, expressed via --accent-rgb glows. Fix the misleading var(--focus,#5aa0ff) fallbacks (L42,172,511): :focus-visible uses --accent; pane elements use --signal; remove every literal #5aa0ff fallback.

Tokens: --signal, --signal-rgb, --accent, --accent-rgb

### Dismiss contract (all overlays)
One contract via the existing overlay.ts stack (pushOverlay/popOverlay): Esc closes topmost, click-outside closes on mousedown consistently. Give notif-panel Esc + click-outside (currently none). Route help Esc through the shared path, not the main.ts onKey special-case. Drop context-menu's extra resize-close unless intentional.

Tokens: (behavioral — no visual token)

### Overlay motion
One shared entrance: @keyframes overlay-in { from { opacity:0; transform: translateY(4px) } to { opacity:1; transform:none } } applied uniformly (animation: overlay-in var(--t-enter) var(--ease)) to palette, settings, help, notif, menu, find, feed. Either all or none — no per-surface motion.

Tokens: --t-enter, --ease

## Top 10 fixes (ordem de impacto)

1. **[z-index/stacking]** notif-panel z-index 1000 (L407) sits below palette/menu/find (2000) and settings (2500); an open notif panel is buried by every other surface. No shared scale.
   - Fix: Adopt --z-popover 2000 / --z-overlay 2100 / --z-modal 2500. Lift notif-panel and feed-panel (L641) to --z-overlay.
2. **[accent split / focus fallback]** --focus is green #5ff967 (L5) but :focus-visible and several input borders fall back to blue #5aa0ff (L42,172,511) — the fallback contradicts the var. Blue accent has no token at all and is hardcoded ~15x.
   - Fix: Two systems: --signal (green) for pane focus only, --accent (blue) for interactive focus/selection. :focus-visible uses --accent; remove every literal #5aa0ff fallback.
3. **[hardcoded theme colors]** ~8 recurring hexes (bg, borders, text, accent, danger) are hardcoded across all surfaces instead of vars; only one var(--focus) usage. A theme change cannot reach the overlays.
   - Fix: Promote to tokens (--bg-sink/--bg-elev/--border/--border-strong/--text*/--accent/--danger) and reference everywhere. Phase 1 swaps are pixel-identical.
4. **[button consistency]** 5 unrelated button styles (settings-btn r6, feed-btn r5, find-btn/notif-clear/browser r4; some bordered, some not), no base class, no pressed or disabled state.
   - Fix: Single .btn base (bg --border, border --border-strong, --r-sm, --s3 --s6) + --icon/--primary/--danger modifiers; add :active press and [disabled] convention.
5. **[dismiss contract]** Five surfaces, five different Esc/click-outside contracts; notif-panel has neither; help Esc is special-cased in main.ts:888 despite sharing .settings-overlay; click-outside is mousedown in settings but click in palette.
   - Fix: One contract via overlay.ts stack: Esc closes topmost + mousedown-outside closes, applied uniformly. Give notif-panel both; route help through the shared path.
6. **[surface background]** context-menu bg is #161b26 (L590) while every sibling overlay uses #11151f; the menu is a different shade than the family.
   - Fix: Map context-menu bg to --bg-elev (#11151f) so all floating surfaces share one surface color.
7. **[row highlight]** Same 'highlighted list item' concept uses 3 colors: palette .sel #1c2740, context-item:hover #2d3650, notif-row:hover #161b26.
   - Fix: Shared tokens: selected/keyboard = --accent-bg (#1c2740), hover = --border-strong (#2d3650), applied via one actionable-row class.
8. **[backdrop + radius + shadow]** Two equal-weight modals dim differently (palette 0.35 vs settings 0.5); radius split 8 vs 10px; 3 hand-tuned shadow strings.
   - Fix: One --scrim (0.5) for all modals; --r-md/--r-lg radius scale; two shadow tokens --shadow-popover / --shadow-modal.
9. **[keyboard a11y of rows]** ws-row, palette-row, notif-row, context-item, surface-tab are plain divs with onclick only — no tabindex/role/Enter handling. Keyboard users cannot reach them.
   - Fix: One actionable-row pattern: role=option/menuitem + tabindex=0 + Enter/Space; global :focus-visible already supplies the ring.
10. **[icon-button hit target + a11y]** Close/add controls are 14-22px (below 24px min); find-bar prev/next/close glyph buttons have no aria-label/title; browser glyph is a lone 15px.
   - Fix: Min 24px square hit area, aria-label on every icon-only control via a shared helper, unify glyph to --fs-lg (14px).

## Plano de normalizacao

## Scanline normalization plan (low-risk first)

All line numbers reference `C:/Users/luiz.rs/Documents/Projects/scanline/app/src/styles.css` unless noted.

### Phase 0 — Land the token block (zero visual change)
1. Paste the `:root` token block at the top of `styles.css`, replacing the current 9-line `:root` (L1-9). Keep `--gutter`/`--gutter-hover`/`--focus` as aliases so nothing breaks immediately.

### Phase 1 — Pure color token swaps (identical pixels, safest)
These map existing hardcoded hexes to vars with the SAME value, so output is byte-identical.
2. `--bg` #0d1017: replace literals at L756 (.browser-url), L774 (.browser-viewport), L802 (.palette-input), L848 (.find-input).
3. `--bg-sink` #0a0d13: L78 (#sidebar), L170 (.ws-rename), L298 (.surface-tabs), L502 (.settings-input), L516 (.settings-color).
4. `--bg-elev` #11151f: L154/157 (.ws-row), L204 (.ws-add), L307 (.surface-tab), L404 (.notif-panel), L477 (.settings-card), L638 (.feed-panel), L734 (.browser-bar), L794 (.palette-box), L838 (.find-bar).
5. `--border` #1c2230: L79, L205, L308, L417, L421, L649, L735, L755, L804, L849.
6. `--border-strong` #2d3650: L27 (scrollbar), L151, L405, L429, L430, L478, L504, L517, L536, L543, L591, L608, L624, L683, L690, L748, L795, L839, L865.
7. `--border-strongest` #3a455f: L33.
8. Text tokens: `--text` #c5c8c6 (~20 sites: L158,171,213,318,409,422,482,503,535,578,595,683,739,757,805,817,851); `--text-dim` #8a8f99 (L103,192,206,311,364,442,449); `--text-faint` #5a6172 (L115,349,615,825); `--text-soft` #a8acb3 (L498,581,668) and replace #aeb4c0 at L619 with `--text-soft`.
9. `--accent` #5aa0ff at all literal sites (L183,273,277,321,391,437,546,547,639,651,694,893); `--accent-hover` #6fb0ff (L552,699); `--accent-bg` #1c2740 (L822); `--on-accent`: set L184 (#061018) and L548,695 (#0a0d13) all to `--on-accent`.
10. `--danger` #c0392b (L199,338,611,766,895); `--on-danger` #fff (L200,339,612,767); `--warning` #e3b341 (L888).
11. Glow alphas: define and use `rgb(var(--accent-rgb)/...)` at L274,278,392 and `rgb(var(--signal-rgb)/...)` at L129,387,709,763. Same rendered color, now tracking the token.

### Phase 2 — Scale alignment (small, deliberate visual nudges)
12. Radius: map to `--r-xs/sm/md/lg`. Unify the elevated surfaces — notif/menu/find from 8px stay --r-md; settings/help/palette/feed stay --r-lg. Buttons all to --r-sm (settings-btn 6->5 L537, browser/find/notif-clear 4->5 L424,741,861). Inputs to --r-sm (browser-url 4->5, rename --r-xs).
13. Shadow + backdrop: collapse the 3 shadow strings into `--shadow-popover`/`--shadow-modal` (L410,480,593,644,797,843). Change palette backdrop 0.35 -> `--scrim` (L785); settings already 0.5.
14. z-index: replace 1000/2000/2500 with `--z-overlay`/`--z-popover`/`--z-modal`. Lift notif-panel (L407) and feed-panel (L641) to `--z-overlay` so they stop hiding behind palette/settings.
15. Context-menu bg: change #161b26 -> `--bg-elev` (L590) so it matches its sibling surfaces.
16. Spacing: snap off-scale paddings to `--s*` — settings-card 18px20px->`--s6 --s7` (L476), settings-input 5px8px->`--s3 --s4` (L506), palette-input 12px14px->`--s5 --s5` (L801), palette-row 9px14px->`--s4 --s5` (L816), notif-row align to context-item rhythm.
17. Type: drop the lone 15px browser glyph (L744) -> `--fs-lg`; map remaining font-sizes to the type scale.

### Phase 3 — Component unification (touches markup, higher risk)
18. Introduce `.btn` base + `--icon/--primary/--danger` modifiers; refactor settings-btn, feed-btn, find-btn, notif-clear, browser-bar button, ws-add onto it. Add `:active` press + `[disabled]` convention. Wire browser back/fwd disabled state in `app/src/browser.ts`.
19. Introduce `.overlay-header` and apply to notif, settings, help, feed.
20. Introduce actionable-row class (cursor, hover --border-strong, selected --accent-bg, transition) for palette-row, context-item, notif-row, ws-row.
21. Unify input focus: remove bespoke :focus borders (L510,763); standardize text inputs on global :focus-visible.

### Phase 4 — Behavior + a11y (separate PR)
22. One dismiss contract via existing `overlay.ts` stack: Esc + mousedown-outside for all; give notif-panel both; route help Esc off the main.ts special-case (`app/src/main.ts:888`, settings.ts:27, palette.ts:55/193/227, contextmenu.ts:25-31, notifications.ts).
23. Keyboard a11y for rows + aria-labels on icon-only buttons (browser.ts, palette.ts find buttons, surface-tab/ws close). role=dialog/menu/listbox + focus trap on overlays.
24. Optional: add the single `overlay-in` entrance animation to all overlays, or document that overlays are intentionally motionless.