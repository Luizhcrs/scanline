import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

interface PtyData {
  id: number;
  bytes: number[];
}

async function main() {
  const el = document.getElementById("terminal");
  if (!el) return;

  const term = new Terminal({
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 14,
    cursorBlink: true,
    theme: {
      background: "#0d1017",
      foreground: "#c5c8c6",
      cursor: "#5ff967",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(el);
  fit.fit();

  // Spawn the shell sized to the current viewport.
  const ptyId = await invoke<number>("pty_spawn", {
    rows: term.rows,
    cols: term.cols,
  });

  // ConPTY output -> terminal.
  await listen<PtyData>("pty-data", (e) => {
    if (e.payload.id !== ptyId) return;
    term.write(new Uint8Array(e.payload.bytes));
  });

  await listen<number>("pty-exit", (e) => {
    if (e.payload === ptyId) term.write("\r\n[process exited]\r\n");
  });

  // Keystrokes -> ConPTY.
  term.onData((data) => {
    invoke("pty_write", { id: ptyId, data });
  });

  // Keep ConPTY size in sync with the viewport.
  const doFit = () => {
    fit.fit();
    invoke("pty_resize", { id: ptyId, rows: term.rows, cols: term.cols });
  };
  window.addEventListener("resize", doFit);
  doFit();

  term.focus();
}

window.addEventListener("DOMContentLoaded", main);
