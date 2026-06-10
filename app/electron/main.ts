import { app, BrowserWindow, ipcMain, clipboard, shell, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execFile } from 'child_process';
import { PtyManager } from './pty-manager';
import { BrowserManager } from './browser-manager';
import { ControlServer } from './control-server';
import { AppConfig } from './app-config';

const isDev = !app.isPackaged;

app.name = 'Scanline';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.scanline.app');
}

function getAppVersion(): string {
  try {
    const pkgPath = isDev
      ? path.join(__dirname, '../package.json')
      : path.join(app.getAppPath(), 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win: BrowserWindow | null = null;
let ptyMgr: PtyManager;
let browserMgr: BrowserManager;
let ctrlSrv: ControlServer;
let appCfg: AppConfig;

function grepDir(p: { query: string; dir: string }): Promise<Array<{ file: string; line: number; text: string }>> {
  return new Promise((resolve) => {
    const results: Array<{ file: string; line: number; text: string }> = [];

    execFile('rg', ['--json', '-m', '50', p.query, p.dir], (err, stdout) => {
      if (!err || stdout) {
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (results.length >= 200) break;
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'match') {
              results.push({
                file: obj.data.path.text,
                line: obj.data.line_number,
                text: obj.data.lines.text.trimEnd(),
              });
            }
          } catch {
            continue;
          }
        }
        resolve(results);
        return;
      }

      const fallbackBin = process.platform === 'win32' ? 'findstr' : 'grep';
      const fallbackArgs = process.platform === 'win32'
        ? ['/s', '/i', '/n', p.query, `${p.dir}\\*.*`]
        : ['-rn', '--include=*', '-m', '50', p.query, p.dir];
      execFile(fallbackBin, fallbackArgs, (_err2, stdout2) => {
        const lines2 = stdout2.split('\n');
        for (const line of lines2) {
          if (results.length >= 200) break;
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/^(.+?):(\d+):(.*)/);
          if (match) {
            results.push({ file: match[1], line: parseInt(match[2], 10), text: match[3] });
          }
        }
        resolve(results);
      });
    });
  });
}

function repoInfo(p: { dir: string }): Promise<{ branch: string; dirty: boolean; commit: string }> {
  return new Promise((resolve) => {
    if (!p?.dir) {
      resolve({ branch: '', dirty: false, commit: '' });
      return;
    }
    const d = p.dir.replace(/"/g, '\\"');
    let branch = '';
    let dirty = false;
    let commit = '';
    let done = 0;

    const finish = () => {
      done++;
      if (done === 3) resolve({ branch, dirty, commit });
    };

    exec(`git -C "${d}" branch --show-current`, (_, out) => {
      branch = out.trim();
      finish();
    });

    exec(`git -C "${d}" status --porcelain`, (_, out) => {
      dirty = out.trim().length > 0;
      finish();
    });

    exec(`git -C "${d}" log -1 --oneline HEAD`, (_, out) => {
      commit = out.trim();
      finish();
    });
  });
}

function panePorts(p: { surfaceId: number }): Promise<number[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('netstat -ano -p TCP', (err, stdout) => {
        if (err) { resolve([]); return; }
        const pidStr = String(p.surfaceId);
        const ports: number[] = [];
        for (const line of stdout.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 5) continue;
          if (parts[parts.length - 1] === pidStr) {
            const m = parts[1].match(/:(\d+)$/);
            if (m) ports.push(parseInt(m[1], 10));
          }
        }
        resolve(ports);
      });
    } else {
      exec(`lsof -i TCP -n -P -sTCP:LISTEN -a -p ${p.surfaceId}`, (err, stdout) => {
        if (err) { resolve([]); return; }
        const ports: number[] = [];
        for (const line of stdout.split('\n').slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 9) continue;
          const m = parts[8].match(/:(\d+)$/);
          if (m) ports.push(parseInt(m[1], 10));
        }
        resolve(ports);
      });
    }
  });
}

function checkForUpdate(): Promise<null> {
  return Promise.resolve(null);
}

function createWindow(): BrowserWindow {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png';
  const iconPath = isDev
    ? path.join(__dirname, '../icons/', iconFile)
    : path.join(process.resourcesPath, 'icons/', iconFile);
  const w = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 640,
    minHeight: 400,
    center: true,
    frame: false,
    show: false,
    icon: iconPath,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  w.webContents.on('did-finish-load', () => w.show());

  if (isDev) {
    w.loadURL('http://localhost:1420');
  } else {
    w.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  w.on('close', () => {
    ptyMgr.closeAll();
    browserMgr.closeAll();
    ctrlSrv.stop();
    win = null;
  });

  return w;
}

app.on('second-instance', () => {
  if (win) {
    win.show();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!win) {
    win = createWindow();
    ptyMgr = new PtyManager(win);
    browserMgr = new BrowserManager(win);
    ctrlSrv = new ControlServer(win);
    ctrlSrv.start();
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && isDev) {
    try { app.dock.setIcon(path.join(__dirname, '../icons/icon.png')); } catch {}
  }

  win = createWindow();

  ptyMgr = new PtyManager(win);
  browserMgr = new BrowserManager(win);
  ctrlSrv = new ControlServer(win);
  appCfg = new AppConfig();

  ctrlSrv.start();

  ipcMain.handle('pty:spawn', (_, p) => ptyMgr.spawn(p.id, p.rows, p.cols, p.shell, p.command, p.cwd));
  ipcMain.handle('pty:write', (_, p) => ptyMgr.write(p.id, p.data));
  ipcMain.on('pty:resize', (_, p) => ptyMgr.resize(p.id, p.rows, p.cols));
  ipcMain.handle('pty:close', (_, p) => ptyMgr.close(p.id));

  ipcMain.handle('browser:open', (_, p) => browserMgr.open(p.id, p.url, p.x, p.y, p.w, p.h));
  ipcMain.on('browser:navigate', (_, p) => browserMgr.navigate(p.id, p.url));
  ipcMain.on('browser:bounds', (_, p) => browserMgr.bounds(p.id, p.x, p.y, p.w, p.h));
  ipcMain.on('browser:visible', (_, p) => browserMgr.visible(p.id, p.visible));
  ipcMain.on('browser:back', (_, p) => browserMgr.back(p.id));
  ipcMain.on('browser:forward', (_, p) => browserMgr.forward(p.id));
  ipcMain.handle('browser:close', (_, p) => browserMgr.close(p.id));
  ipcMain.on('browser:devtools', (_, p) => browserMgr.devtools(p.id));
  ipcMain.handle('browser:cdp', (_, p) => browserMgr.cdp(p.id, p.method, p.params));
  ipcMain.on('browser:dialog-reply', () => {});

  ipcMain.handle('config:load', () => appCfg.loadConfig());
  ipcMain.handle('config:save', (_, p) => appCfg.saveConfig(p.json));
  ipcMain.handle('session:load', () => appCfg.loadSession());
  ipcMain.handle('session:save', (_, p) => appCfg.saveSession(p.json));
  ipcMain.on('config:edit', () => appCfg.editConfig());

  ipcMain.on('app:devtools', () => win!.webContents.openDevTools());
  ipcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.on('app:open-url', (_, u) => shell.openExternal(u));
  ipcMain.on('control:ready', () => {});
  ipcMain.on('control:reply', (_, p) => ctrlSrv.reply(p.id, p.response));
  ipcMain.on('app:version', (e) => { e.returnValue = getAppVersion(); });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_, text) => { clipboard.writeText(text); });

  ipcMain.handle('app:grep-dir', (_, p) => grepDir(p));
  ipcMain.handle('app:repo-info', (_, p) => repoInfo(p));
  ipcMain.handle('app:pane-ports', (_, p) => panePorts(p));

  ipcMain.handle('app:locale', () => app.getLocale());
  ipcMain.handle('updater:check', () => checkForUpdate());
  ipcMain.on('app:show-notification', (_, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); });
  ipcMain.on('win:close', () => win?.close());
});
