import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import { BrowserWindow } from 'electron';

const pipePath = process.platform === 'win32'
  ? '\\\\.\\pipe\\scanline'
  : `${os.tmpdir()}/scanline-${process.getuid!()}.sock`;

const MAX_BUFFER = 1024 * 1024; // 1 MB

export class ControlServer {
  private win: BrowserWindow;
  private server: net.Server;
  private pending: Map<string, net.Socket> = new Map();

  constructor(win: BrowserWindow) {
    this.win = win;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (e) => console.error('[pipe]', e));
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > MAX_BUFFER) {
        socket.destroy();
        return;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let cmd: Record<string, unknown>;
        try {
          cmd = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (typeof cmd.id === 'string' && cmd.id) {
          this.pending.set(cmd.id, socket);
          this.win.webContents.send('control:request', cmd);
        } else {
          this.win.webContents.send('control:command', cmd);
        }
      }
    });

    const cleanup = () => {
      for (const [id, s] of this.pending) {
        if (s === socket) {
          this.pending.delete(id);
        }
      }
    };

    socket.on('close', cleanup);
    socket.on('error', () => { cleanup(); socket.destroy(); });
  }

  start(): void {
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(pipePath); } catch {}
    }
    this.server.listen(pipePath);
  }

  reply(id: string, response: object): void {
    const socket = this.pending.get(id);
    if (!socket) return;
    socket.write(JSON.stringify(response) + '\n');
    this.pending.delete(id);
  }

  stop(): void {
    for (const [, sock] of this.pending) sock.destroy();
    this.pending.clear();
    this.server.close();
  }
}
