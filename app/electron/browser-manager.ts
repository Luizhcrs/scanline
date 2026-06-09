import { BrowserWindow, WebContentsView, shell } from 'electron';

export class BrowserManager {
  private win: BrowserWindow;
  private views: Map<number, WebContentsView> = new Map();

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  open(id: number, url: string, x: number, y: number, w: number, h: number): void {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    this.win.contentView.addChildView(view);
    view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
    view.webContents.loadURL(url || 'about:blank');

    view.webContents.on('did-navigate', (_, u) => {
      this.win.webContents.send('browser:url:' + id, u);
    });

    view.webContents.on('did-navigate-in-page', (_, u) => {
      this.win.webContents.send('browser:url:' + id, u);
    });

    view.webContents.setWindowOpenHandler(({ url: u }) => {
      this.win.webContents.send('browser:new-window:' + id, u);
      return { action: 'deny' };
    });

    try {
      view.webContents.debugger.attach('1.3');
    } catch (_) {}

    this.views.set(id, view);
  }

  navigate(id: number, url: string): void {
    try {
      this.views.get(id)?.webContents.loadURL(url);
    } catch (_) {}
  }

  bounds(id: number, x: number, y: number, w: number, h: number): void {
    if (!(w > 0 && h > 0)) return;
    this.views.get(id)?.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
  }

  visible(id: number, v: boolean): void {
    const view = this.views.get(id);
    if (!view) return;
    if (v) {
      this.win.contentView.addChildView(view);
    } else {
      this.win.contentView.removeChildView(view);
    }
  }

  back(id: number): void {
    this.views.get(id)?.webContents.goBack();
  }

  forward(id: number): void {
    this.views.get(id)?.webContents.goForward();
  }

  close(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    (view as any).webContents.destroy?.();
    this.views.delete(id);
  }

  devtools(id: number): void {
    this.views.get(id)?.webContents.openDevTools();
  }

  async cdp(id: number, method: string, paramsStr: string): Promise<string> {
    const view = this.views.get(id);
    if (!view) return JSON.stringify({});
    try {
      const params = JSON.parse(paramsStr || '{}');
      const result = await view.webContents.debugger.sendCommand(method, params);
      return JSON.stringify(result || {});
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  closeAll(): void {
    for (const id of this.views.keys()) {
      this.close(id);
    }
  }
}
