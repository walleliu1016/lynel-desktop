import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  terminalManager: TerminalManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminal', async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      await terminalManager.createTerminal(
        wsFolder?.uri.fsPath ?? process.cwd(),
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminalWithWorkDir', async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Start Claude Session',
      });
      if (folders?.[0]) {
        await terminalManager.createTerminal(folders[0].fsPath);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.closeAllTerminals', () => {
      terminalManager.closeAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.showSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'lynel',
      );
    }),
  );
}
