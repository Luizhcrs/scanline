import { defineConfig } from "vitest/config";
import path from "path";

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      // Stub Tauri runtime APIs — not available in node.
      "@tauri-apps/api/core": r("src/__mocks__/tauri-core.ts"),
      "@tauri-apps/api/event": r("src/__mocks__/tauri-event.ts"),
      "@tauri-apps/api/window": r("src/__mocks__/tauri-window.ts"),
      "@tauri-apps/plugin-notification": r("src/__mocks__/tauri-notification.ts"),
      "@tauri-apps/plugin-clipboard-manager": r("src/__mocks__/tauri-clipboard.ts"),
      "@tauri-apps/plugin-opener": r("src/__mocks__/tauri-opener.ts"),
      // Stub xterm — requires a real browser canvas.
      "@xterm/xterm": r("src/__mocks__/xterm.ts"),
      "@xterm/addon-fit": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-web-links": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-serialize": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-search": r("src/__mocks__/xterm-addon.ts"),
    },
  },
});
