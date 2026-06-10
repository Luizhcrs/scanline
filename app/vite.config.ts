import { defineConfig } from "vite";

export default defineConfig({
  base: './',
  optimizeDeps: {
    include: [
      "@xterm/xterm",
      "@xterm/addon-fit",
      "@xterm/addon-web-links",
      "@xterm/addon-serialize",
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
