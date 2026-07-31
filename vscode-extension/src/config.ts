import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LynelConfig {
  claudeBin: string;
  dataDir: string;
}

export function getConfig(): LynelConfig {
  const cfg = vscode.workspace.getConfiguration('lynel');
  const dataDir = cfg.get<string>('dataDir', '') ||
    path.join(os.homedir(), '.lynel-vscode');
  return {
    claudeBin: cfg.get<string>('claudeBin', 'claude'),
    dataDir,
  };
}
