export type UnlistenFn = () => void;

export async function invoke<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T> {
  const api = (window as any).scanline;
  switch (command) {
    // PTY
    case 'pty_spawn':   return api.ptySpawn(params) as Promise<T>;
    case 'pty_write':   return api.ptyWrite(params) as Promise<T>;
    case 'pty_resize':  api.ptyResize(params); return undefined as T;
    case 'pty_close':   return api.ptyClose(params) as Promise<T>;
    // Browser
    case 'browser_open':         return api.browserOpen(params) as Promise<T>;
    case 'browser_navigate':     api.browserNavigate(params); return undefined as T;
    case 'browser_bounds':       api.browserBounds(params); return undefined as T;
    case 'browser_visible':      api.browserVisible(params); return undefined as T;
    case 'browser_back':         api.browserBack(params); return undefined as T;
    case 'browser_forward':      api.browserForward(params); return undefined as T;
    case 'browser_close':        return api.browserClose(params) as Promise<T>;
    case 'browser_devtools':     api.browserDevtools(params); return undefined as T;
    case 'browser_cdp':          return api.browserCdp(params) as Promise<T>;
    case 'browser_dialog_reply': api.browserDialogReply(params); return undefined as T;
    // Config / Session
    case 'load_config':     return api.loadConfig() as Promise<T>;
    case 'save_config':     return api.saveConfig(params) as Promise<T>;
    case 'load_session':    return api.loadSession() as Promise<T>;
    case 'save_session':    return api.saveSession(params) as Promise<T>;
    case 'edit_config':     api.editConfig(); return undefined as T;
    // App
    case 'open_devtools':          api.openDevtools(); return undefined as T;
    case 'control_reply':          api.controlReply(params); return undefined as T;
    case 'control_frontend_ready': api.controlFrontendReady(); return undefined as T;
    // Search
    case 'grep_dir':    return api.grepDir(params) as Promise<T>;
    case 'repo_info':   return api.repoInfo(params) as Promise<T>;
    case 'pane_ports':  return api.panePorts(params) as Promise<T>;
    default: throw new Error('unknown command: ' + command);
  }
}

export function listen<T = unknown>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  const api = (window as any).scanline;

  // pty://{id}/exit
  const ptyExit = event.match(/^pty:\/\/(\d+)\/exit$/);
  if (ptyExit) {
    const id = parseInt(ptyExit[1]);
    return Promise.resolve(api.onPtyExit(id, () => handler({ payload: undefined as T })));
  }

  // browser://{id}/url
  const browserUrl = event.match(/^browser:\/\/(\d+)\/url$/);
  if (browserUrl) {
    const id = parseInt(browserUrl[1]);
    return Promise.resolve(api.onBrowserUrl(id, (url: string) => handler({ payload: url as T })));
  }

  // browser://{id}/new-window
  const browserNew = event.match(/^browser:\/\/(\d+)\/new-window$/);
  if (browserNew) {
    const id = parseInt(browserNew[1]);
    return Promise.resolve(api.onBrowserNewWindow(id, (url: string) => handler({ payload: url as T })));
  }

  // browser://{id}/dialog
  const browserDlg = event.match(/^browser:\/\/(\d+)\/dialog$/);
  if (browserDlg) {
    const id = parseInt(browserDlg[1]);
    return Promise.resolve(api.onBrowserDialog(id, (p: any) => handler({ payload: p as T })));
  }

  // control://request
  if (event === 'control://request') {
    return Promise.resolve(api.onControlRequest((cmd: any) => handler({ payload: cmd as T })));
  }

  // control://command
  if (event === 'control://command') {
    return Promise.resolve(api.onControlCommand((cmd: any) => handler({ payload: cmd as T })));
  }

  console.warn('[api] unhandled listen:', event);
  return Promise.resolve(() => {});
}
