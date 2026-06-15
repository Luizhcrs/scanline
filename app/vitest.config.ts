import { defineConfig } from "vitest/config";
import path from "path";

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      // Stub xterm — requires a real browser canvas.
      "@xterm/xterm": r("src/__mocks__/xterm.ts"),
      "@xterm/addon-fit": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-web-links": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-serialize": r("src/__mocks__/xterm-addon.ts"),
      "@xterm/addon-search": r("src/__mocks__/xterm-addon.ts"),
    },
  },
});
