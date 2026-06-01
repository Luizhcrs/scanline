// Stub for @xterm addons
export class FitAddon {
  activate(_terminal: unknown) {}
  dispose() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 }; }
}
export class WebLinksAddon {
  activate(_terminal: unknown) {}
  dispose() {}
  constructor(_handler?: unknown, _opts?: unknown) {}
}
export class SerializeAddon {
  activate(_terminal: unknown) {}
  dispose() {}
  serialize(_opts?: unknown): string { return ""; }
}
export class SearchAddon {
  activate(_terminal: unknown) {}
  dispose() {}
  findNext(_term: string, _opts?: unknown): boolean { return false; }
  findPrevious(_term: string, _opts?: unknown): boolean { return false; }
  onDidChangeResults(_fn: unknown) { return { dispose: () => {} }; }
}
