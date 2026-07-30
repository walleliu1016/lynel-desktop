import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface LynelConfig {
  claudeBin: string;
  dataDir: string;
}

export function getConfig(): LynelConfig {
  const cfg = vscode.workspace.getConfiguration('lynel');
  const dataDir = cfg.get<string>('dataDir', '') ||
    path.join(os.homedir(), '.lynel-desktop');
  return {
    claudeBin: cfg.get<string>('claudeBin', 'claude'),
    dataDir,
  };
}

// 读取 Lynel Desktop settings.json（复用现有配置）
export function getLynelSettings(): Record<string, unknown> {
  const config = getConfig();
  const settingsPath = path.join(config.dataDir, 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}
  return {};
}
