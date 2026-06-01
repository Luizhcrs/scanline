// Stub for @xterm/xterm
export class Terminal {
  element: HTMLElement | null = null;
  options: Record<string, unknown> = {};
  constructor(_opts?: unknown) {}
  open(_el: HTMLElement) {}
  write(_data: string | Uint8Array) {}
  writeln(_data: string) {}
  clear() {}
  dispose() {}
  onData(_fn: (data: string) => void) { return { dispose: () => {} }; }
  onTitleChange(_fn: (title: string) => void) { return { dispose: () => {} }; }
  onCursorMove(_fn: () => void) { return { dispose: () => {} }; }
  onBell(_fn: () => void) { return { dispose: () => {} }; }
  onScroll(_fn: (pos: number) => void) { return { dispose: () => {} }; }
  loadAddon(_addon: unknown) {}
  focus() {}
  blur() {}
  scrollToBottom() {}
  select(_col: number, _row: number, _len: number) {}
  getSelection() { return ""; }
  clearSelection() {}
}
