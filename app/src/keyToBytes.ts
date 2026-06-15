/** Map a key chord (e.g. "ctrl+c", "enter", "f1") to raw terminal bytes. */
export function keyToBytes(key: string): string {
  const k = key.toLowerCase();
  const named: Record<string, string> = {
    enter: "\r",
    tab: "\t",
    escape: "\x1b",
    esc: "\x1b",
    space: " ",
    backspace: "\x7f",
    delete: "\x1b[3~",
    up: "\x1b[A",
    down: "\x1b[B",
    right: "\x1b[C",
    left: "\x1b[D",
    home: "\x1b[H",
    end: "\x1b[F",
    pageup: "\x1b[5~",
    pagedown: "\x1b[6~",
    // F1-F4: SS3 (VT220 / xterm default)
    f1: "\x1bOP",
    f2: "\x1bOQ",
    f3: "\x1bOR",
    f4: "\x1bOS",
    // F5-F12: CSI tilde (xterm)
    f5:  "\x1b[15~",
    f6:  "\x1b[17~",
    f7:  "\x1b[18~",
    f8:  "\x1b[19~",
    f9:  "\x1b[20~",
    f10: "\x1b[21~",
    f11: "\x1b[23~",
    f12: "\x1b[24~",
    // Shift-Tab (reverse-tab)
    "s-tab": "\x1b[Z",
    btab:    "\x1b[Z",
  };
  if (named[k]) return named[k];
  // C-/ctrl- modifier: map to control character (e.g. C-c -> \x03)
  const ctrl = k.match(/^(?:c|ctrl)-(.)$/);
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);
  // M-/meta-/alt- modifier: prefix with ESC
  const meta = k.match(/^(?:m|meta|alt)-(.+)$/);
  if (meta) return "\x1b" + keyToBytes(meta[1]);
  // S-/shift- modifier: uppercase the base character
  const shift = k.match(/^s-(.+)$/);
  if (shift) return keyToBytes(shift[1]).toUpperCase();
  return key;
}
