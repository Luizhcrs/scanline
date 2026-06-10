import * as nodePty from 'node-pty';
import { BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';

export class PtyManager {
  private ptys: Map<number, nodePty.IPty> = new Map();
  private win: BrowserWindow;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  spawn(
    id: number,
    rows: number,
    cols: number,
    shell: string | null,
    command: string | null,
    cwd: string | null
  ): void {
    const resolvedShell = shell || (
      process.platform === 'win32'
        ? (process.env.SCANLINE_SHELL || 'powershell.exe')
        : (process.env.SHELL || '/bin/zsh')
    );
    const args = command !== null
      ? (process.platform === 'win32' ? ['/c', command] : ['-c', command])
      : [];
    const resolvedCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

    const pty = nodePty.spawn(resolvedShell, args, {
      name: 'xterm-color',
      rows,
      cols,
      cwd: resolvedCwd,
      env: process.env as { [key: string]: string },
    });

    pty.onData((data) => {
      if (!this.win.webContents.isDestroyed()) {
        this.win.webContents.send('pty:data:' + id, data);
      }
    });

    pty.onExit(() => {
      this.ptys.delete(id);
      if (!this.win.webContents.isDestroyed()) {
        this.win.webContents.send('pty:exit:' + id);
      }
    });

    this.ptys.set(id, pty);
  }

  write(id: number, data: number[]): void {
    const pty = this.ptys.get(id);
    if (!pty) return;
    pty.write(Buffer.from(data).toString());
  }

  resize(id: number, rows: number, cols: number): void {
    const pty = this.ptys.get(id);
    if (!pty) return;
    if (cols > 0 && rows > 0) {
      pty.resize(cols, rows);
    }
  }

  close(id: number): void {
    const pty = this.ptys.get(id);
    if (!pty) return;
    pty.kill();
    this.ptys.delete(id);
  }

  closeAll(): void {
    for (const id of this.ptys.keys()) {
      this.close(id);
    }
  }
}
