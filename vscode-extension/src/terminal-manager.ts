import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  PtyMode, startPty, type PtyProcess, type PtyExitInfo,
} from './pty-bridge.js';
import {
  newSession, register, remove, setProcess, writeInput,
  resize as sessionResize, appendBuffer,
} from './session.js';
import { OutputBatcher } from './output-batcher.js';
import { getConfig } from './config.js';
import { APIProxy } from './apiproxy.js';

class LynelPseudoterminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number>();
  private proc: PtyProcess | null = null;
  private proxy: APIProxy | null = null;
  private batcher: OutputBatcher;
  private sessionId: string;
  private workDir: string;
  private onDispose: (id: string) => void;

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  constructor(sessionId: string, workDir: string, onDispose: (id: string) => void) {
    this.sessionId = sessionId;
    this.workDir = workDir;
    this.onDispose = onDispose;
    this.batcher = new OutputBatcher((_, data) => {
      // PTY ANSI 输出直接写入 VS Code 终端
      this.writeEmitter.fire(data);
    });
  }

  async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    const session = newSession(this.sessionId, this.workDir);
    register(session);

    const config = getConfig();

    // 启动 APIProxy 拦截 Claude API 流量，失败不阻塞 PTY
    let envPatch: Record<string, string> = {};
    try {
      this.proxy = new APIProxy(this.sessionId, this.workDir);
      const proxyPort = await this.proxy.start();
      envPatch = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxyPort}` };
    } catch (err) {
      console.error(`[terminal-manager] APIProxy 启动失败: ${err}`);
      this.proxy = null;
    }

    let proc: PtyProcess;
    try {
      proc = startPty({
        bin: config.claudeBin,
        mode: PtyMode.New,
        sessionId: this.sessionId,
        workDir: this.workDir,
        cols,
        rows,
        env: envPatch,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.writeEmitter.fire(`\r\n\x1b[31m[Lynel] PTY 启动失败: ${msg}\x1b[0m\r\n`);
      this.closeEmitter.fire(1);
      return;
    }

    this.proc = proc;
    setProcess(this.sessionId, proc, { cols, rows });

    proc.onData((data: string) => {
      appendBuffer(this.sessionId, data);
      this.batcher.push(this.sessionId, data);
    });

    proc.onExit((info: PtyExitInfo) => {
      this.batcher.flush(this.sessionId);
      if (info.code !== 0 || info.durationMs < 5000) {
        this.writeEmitter.fire(`\r\n\x1b[31m[Claude exited with code ${info.code} after ${info.durationMs}ms]\x1b[0m\r\n`);
      }
      this.closeEmitter.fire(info.code);
    });
  }

  close(): void {
    this.batcher.clear(this.sessionId);
    this.proxy?.close();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    remove(this.sessionId);
    this.onDispose(this.sessionId);
  }

  handleInput(data: string): void {
    if (this.proc) {
      writeInput(this.sessionId, data);
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    sessionResize(this.sessionId, dimensions.columns, dimensions.rows);
  }
}

export class TerminalManager implements vscode.Disposable {
  private terminals = new Map<string, { terminal: vscode.Terminal; pty: LynelPseudoterminal }>();
  private _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount: vscode.Event<number> = this._onDidChangeCount.event;

  async createTerminal(workDir?: string): Promise<vscode.Terminal> {
    const sessionId = randomUUID();
    const cwd = workDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const name = `Claude ${sessionId.slice(0, 8)}`;

    const pty = new LynelPseudoterminal(sessionId, cwd, (id) => {
      this.terminals.delete(id);
      this._onDidChangeCount.fire(this.terminals.size);
    });

    const terminal = vscode.window.createTerminal({
      name,
      pty,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
    });

    this.terminals.set(sessionId, { terminal, pty });
    this._onDidChangeCount.fire(this.terminals.size);
    terminal.show();
    return terminal;
  }

  getTerminalCount(): number {
    return this.terminals.size;
  }

  closeAll(): void {
    for (const [, entry] of this.terminals) {
      entry.terminal.dispose();
    }
  }

  dispose(): void {
    this.closeAll();
    this._onDidChangeCount.dispose();
  }
}
