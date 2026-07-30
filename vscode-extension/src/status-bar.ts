import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private eventDisposable: vscode.Disposable;

  constructor(private terminalManager: TerminalManager) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 50,
    );
    this.item.command = 'lynel.newTerminal';
    this.item.tooltip = 'Lynel: New Claude Terminal';
    this.update();
    this.item.show();

    this.eventDisposable = terminalManager.onDidChangeCount(() => this.update());
  }

  update(): void {
    const count = this.terminalManager.getTerminalCount();
    this.item.text = `$(comment-discussion) Claude${count > 1 ? ` (${count})` : ''}`;
  }

  dispose(): void {
    this.eventDisposable.dispose();
    this.item.dispose();
  }
}
