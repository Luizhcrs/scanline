import { app, BrowserWindow, ipcMain, clipboard, shell, Notification, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { PtyManager } from './pty-manager';
import { BrowserManager } from './browser-manager';
import { ControlServer } from './control-server';
import { AppConfig } from './app-config';

const isDev = !app.isPackaged;

if (process.platform === 'darwin') {
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
  const currentPaths = (process.env.PATH || '').split(':');
  process.env.PATH = [...extraPaths.filter(p => !currentPaths.includes(p)), ...currentPaths].join(':');
}

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

function grepDir(p: { query: string; cwd: string }): Promise<Array<{ file: string; line: number; text: string }>> {
  return new Promise((resolve) => {
    const results: Array<{ file: string; line: number; text: string }> = [];

    execFile('rg', ['--json', '-m', '200', p.query, p.cwd], (err, stdout) => {
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
        ? ['/s', '/i', '/n', p.query, `${p.cwd}\\*.*`]
        : ['-rn', '--include=*', '-m', '50', p.query, p.cwd];
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

function repoInfo(p: { cwd: string }): Promise<{ branch: string; dirty: boolean; commit: string }> {
  return new Promise((resolve) => {
    if (!p?.cwd) {
      resolve({ branch: '', dirty: false, commit: '' });
      return;
    }
    let branch = '';
    let dirty = false;
    let commit = '';
    let done = 0;

    const finish = () => {
      done++;
      if (done === 3) resolve({ branch, dirty, commit });
    };

    execFile('git', ['-C', p.cwd, 'branch', '--show-current'], (_, out) => {
      branch = (out ?? '').trim();
      finish();
    });

    execFile('git', ['-C', p.cwd, 'status', '--porcelain'], (_, out) => {
      dirty = (out ?? '').trim().length > 0;
      finish();
    });

    execFile('git', ['-C', p.cwd, 'log', '-1', '--oneline', 'HEAD'], (_, out) => {
      commit = (out ?? '').trim();
      finish();
    });
  });
}

function panePorts(p: { surfaceId: number }): Promise<number[]> {
  return new Promise((resolve) => {
    const pid = ptyMgr.getPid(p.surfaceId);
    if (!pid) { resolve([]); return; }
    if (process.platform === 'win32') {
      execFile('netstat', ['-ano', '-p', 'TCP'], (err, stdout) => {
        if (err) { resolve([]); return; }
        const pidStr = String(pid);
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
      execFile('lsof', ['-i', 'TCP', '-n', '-P', '-sTCP:LISTEN', '-a', '-p', String(pid)], (err, stdout) => {
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
  const isDarwin = process.platform === 'darwin';
  const w = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 640,
    minHeight: 400,
    center: true,
    frame: process.platform !== 'win32',
    titleBarStyle: isDarwin ? 'hiddenInset' : 'default',
    trafficLightPosition: isDarwin ? { x: 12, y: 10 } : undefined,
    vibrancy: isDarwin ? 'sidebar' : undefined,
    show: false,
    icon: iconPath,
    backgroundColor: isDarwin ? undefined : '#000000',
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
    try { app.dock.setIcon(path.join(__dirname, '../icons/icon.png')); } catch { /* icon may not exist in dev */ }
  }

  nativeTheme.themeSource = 'system';

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

  ipcMain.on('app:devtools', () => win?.webContents.openDevTools());
  ipcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.on('app:open-url', (_, u) => shell.openExternal(u));
  ipcMain.on('control:ready', () => {});
  ipcMain.on('control:reply', (_, p) => ctrlSrv.reply(p.id, p.response));
  ipcMain.on('app:version', (e) => { e.returnValue = getAppVersion(); });
  ipcMain.on('app:platform', (e) => { e.returnValue = process.platform; });
  ipcMain.on('app:theme', (e) => { e.returnValue = nativeTheme.shouldUseDarkColors; });

  nativeTheme.on('updated', () => {
    win?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
  });

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
  ipcMain.on('win:fullscreen', () => { if (win?.isFullScreen()) win.setFullScreen(false); else win?.setFullScreen(true); });
});
