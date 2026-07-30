import * as vscode from 'vscode';
import { TerminalManager } from './terminal-manager.js';
import { StatusBarManager } from './status-bar.js';
import { registerCommands } from './commands.js';
import { preloadEnv } from './pty-bridge.js';

let terminalManager: TerminalManager;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 预加载 shell 环境（macOS PATH 修复）
  await preloadEnv();

  terminalManager = new TerminalManager();
  statusBar = new StatusBarManager(terminalManager);

  registerCommands(context, terminalManager);

  // 扩展激活时自动创建一个 Claude 终端
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    await terminalManager.createTerminal(wsFolder.uri.fsPath);
  }

  context.subscriptions.push(terminalManager, statusBar);
}

export function deactivate(): void {
  terminalManager?.dispose();
}
