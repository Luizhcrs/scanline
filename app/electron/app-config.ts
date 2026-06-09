import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

const dataDir = path.join(process.env.APPDATA || os.homedir(), 'scanline');
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
    exec('notepad.exe "' + configPath + '"');
  }
}
