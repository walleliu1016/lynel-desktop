import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(private terminalManager: TerminalManager) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 50,
    );
    this.item.command = 'lynel.newTerminal';
    this.item.tooltip = 'Lynel: New Claude Terminal';
    this.update();
    this.item.show();
  }

  update(): void {
    const count = this.terminalManager.getTerminalCount();
    this.item.text = `$(comment-discussion) Claude${count > 1 ? ` (${count})` : ''}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
