import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

function getDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'scanline');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'scanline');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'scanline');
}

const dataDir = getDataDir();
const configPath = path.join(dataDir, 'scanline.json');
const sessionPath = path.join(dataDir, 'session.json');

export class AppConfig {
  constructor() {
    fs.mkdir(dataDir, { recursive: true });
  }

  async loadConfig(): Promise<string | null> {
    try {
      return await fs.readFile(configPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async saveConfig(json: string): Promise<void> {
    await fs.writeFile(configPath, json, 'utf-8');
  }

  async loadSession(): Promise<string | null> {
    try {
      return await fs.readFile(sessionPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async saveSession(json: string): Promise<void> {
    await fs.writeFile(sessionPath, json, 'utf-8');
  }

  editConfig(): void {
    if (process.platform === 'win32') {
      exec('notepad.exe "' + configPath + '"');
    } else if (process.platform === 'darwin') {
      exec('open -t "' + configPath + '"');
    } else {
      exec('xdg-open "' + configPath + '"');
    }
  }
}
