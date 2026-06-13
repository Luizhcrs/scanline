import { contextBridge, ipcRenderer } from 'electron'

const version: string = ipcRenderer.sendSync('app:version')

contextBridge.exposeInMainWorld('scanline', {
  ptySpawn(args: { id: number; rows: number; cols: number; shell: string; command?: string; surfaceId: number; cwd?: string }): Promise<void> {
    return ipcRenderer.invoke('pty:spawn', args)
  },
  ptyWrite(args: { id: number; data: number[] }): Promise<void> {
    return ipcRenderer.invoke('pty:write', args)
  },
  ptyResize(args: { id: number; rows: number; cols: number }): void {
    ipcRenderer.send('pty:resize', args)
  },
  ptyClose(args: { id: number }): Promise<void> {
    return ipcRenderer.invoke('pty:close', args)
  },
  onPtyData(id: number, cb: (data: string) => void): () => void {
    const channel = `pty:data:${id}`
    const handler = (_: Electron.IpcRendererEvent, data: string) => cb(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onPtyExit(id: number, cb: () => void): () => void {
    const channel = `pty:exit:${id}`
    const handler = () => cb()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  browserOpen(args: { id: number; url: string; x: number; y: number; w: number; h: number }): Promise<void> {
    return ipcRenderer.invoke('browser:open', args)
  },
  browserNavigate(args: { id: number; url: string }): void {
    ipcRenderer.send('browser:navigate', args)
  },
  browserBounds(args: { id: number; x: number; y: number; w: number; h: number }): void {
    ipcRenderer.send('browser:bounds', args)
  },
  browserVisible(args: { id: number; visible: boolean }): void {
    ipcRenderer.send('browser:visible', args)
  },
  browserBack(args: { id: number }): void {
    ipcRenderer.send('browser:back', args)
  },
  browserForward(args: { id: number }): void {
    ipcRenderer.send('browser:forward', args)
  },
  browserClose(args: { id: number }): Promise<void> {
    return ipcRenderer.invoke('browser:close', args)
  },
  browserDevtools(args: { id: number }): void {
    ipcRenderer.send('browser:devtools', args)
  },
  browserCdp(args: { id: number; method: string; params: string }): Promise<string> {
    return ipcRenderer.invoke('browser:cdp', args)
  },
  browserDialogReply(args: { paneId: number; req: any; accept: boolean; text?: string }): void {
    ipcRenderer.send('browser:dialog-reply', args)
  },
  onBrowserUrl(id: number, cb: (url: string) => void): () => void {
    const channel = `browser:url:${id}`
    const handler = (_: Electron.IpcRendererEvent, url: string) => cb(url)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onBrowserNewWindow(id: number, cb: (url: string) => void): () => void {
    const channel = `browser:new-window:${id}`
    const handler = (_: Electron.IpcRendererEvent, url: string) => cb(url)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onBrowserDialog(id: number, cb: (p: any) => void): () => void {
    const channel = `browser:dialog:${id}`
    const handler = (_: Electron.IpcRendererEvent, p: any) => cb(p)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  loadConfig(): Promise<string | null> {
    return ipcRenderer.invoke('config:load')
  },
  saveConfig(args: { json: string }): Promise<void> {
    return ipcRenderer.invoke('config:save', args)
  },
  loadSession(): Promise<string | null> {
    return ipcRenderer.invoke('session:load')
  },
  saveSession(args: { json: string }): Promise<void> {
    return ipcRenderer.invoke('session:save', args)
  },
  editConfig(): void {
    ipcRenderer.send('config:edit')
  },

  openDevtools(): void {
    ipcRenderer.send('app:devtools')
  },
  getVersion(): string {
    return version
  },
  getPlatform(): string {
    return ipcRenderer.sendSync('app:platform')
  },
  isDarkTheme(): boolean {
    return ipcRenderer.sendSync('app:theme')
  },
  onThemeChange(cb: (dark: boolean) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, dark: boolean) => cb(dark)
    ipcRenderer.on('theme:changed', handler)
    return () => ipcRenderer.removeListener('theme:changed', handler)
  },
  relaunch(): void {
    ipcRenderer.send('app:relaunch')
  },
  openUrl(url: string): void {
    ipcRenderer.send('app:open-url', url)
  },

  grepDir(args: { dir: string; query: string; caseSensitive: boolean; wholeWord: boolean }): Promise<unknown> {
    return ipcRenderer.invoke('app:grep-dir', args)
  },
  repoInfo(args: { dir: string }): Promise<unknown> {
    return ipcRenderer.invoke('app:repo-info', args)
  },
  panePorts(args: { surfaceId: number }): Promise<number[]> {
    return ipcRenderer.invoke('app:pane-ports', args)
  },

  clipboardRead(): Promise<string> {
    return ipcRenderer.invoke('clipboard:read')
  },
  clipboardWrite(text: string): Promise<void> {
    return ipcRenderer.invoke('clipboard:write', text)
  },

  controlReply(args: { id: string; response: string }): void {
    ipcRenderer.send('control:reply', args)
  },
  controlFrontendReady(): void {
    ipcRenderer.send('control:ready')
  },
  onControlRequest(cb: (cmd: any) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, cmd: any) => cb(cmd)
    ipcRenderer.on('control:request', handler)
    return () => ipcRenderer.removeListener('control:request', handler)
  },
  onControlCommand(cb: (cmd: any) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, cmd: any) => cb(cmd)
    ipcRenderer.on('control:command', handler)
    return () => ipcRenderer.removeListener('control:command', handler)
  },

  getLocale(): Promise<string> {
    return ipcRenderer.invoke('app:locale')
  },
  checkUpdate(): Promise<{ version: string; body: string; download(cb: (e: any) => void): Promise<void> } | null> {
    return ipcRenderer.invoke('updater:check')
  },
  showNotification(title: string, body: string): void {
    ipcRenderer.send('app:show-notification', { title, body })
  },
  minimize(): void { ipcRenderer.send('win:minimize') },
  maximize(): void { ipcRenderer.send('win:maximize') },
  close(): void { ipcRenderer.send('win:close') },
  fullscreen(): void { ipcRenderer.send('win:fullscreen') },
})
