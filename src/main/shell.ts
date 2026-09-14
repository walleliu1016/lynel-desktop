// 项目终端：每个 Claude 会话一个独立的交互式 shell，cwd 绑定该会话的 workDir。
// 与 Claude 会话的 PTY（session.ts / app.ts 的 wirePty）完全隔离：本模块的输出走
// `shell:<sessionId>` 事件前缀，绝不能复用 `session:<sessionId>` —— 那会导致两个
// 终端的输出串流。
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { getBus } from './events.js';
import { getLogger } from './log.js';
import { start as startPty, PtyMode, resolveCmdExe, type PtyProcess } from './pty.js';
import { OutputBatcher } from './output-batcher.js';

const MAX_BUFFER = 64 * 1024;

export interface ShellSession {
  sessionId: string;
  workDir: string;
  proc: PtyProcess;
  buffer: string;
  cols: number;
  rows: number;
}

const shells = new Map<string, ShellSession>();

// 独立于 app.ts 的 ptyOutBatcher：那个实例的 flush 回调写死了 `session:` 前缀
const batcher = new OutputBatcher((sessionId, data) => {
  getBus().emit(`shell:${sessionId}`, data);
});

/**
 * 选择交互式 shell，返回**绝对路径**。
 * node-pty 的 native 侧对【相对】命令名会走自己的 PATH 解析，实现在某些机器上会
 * 丢 Path 末段或取不到超长 Path，解析为空就抛 `File not found:`（见 pty.ts 顶部
 * resolveCmdExe 的注释）。传绝对路径可完全绕开该解析。
 */
export function pickShell(): string {
  if (process.platform === 'win32') {
    const ps = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (fs.existsSync(ps)) return ps;
    return resolveCmdExe();
  }
  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return process.env.SHELL || fallback;
}

function appendBuffer(s: ShellSession, data: string): void {
  s.buffer += data;
  if (s.buffer.length > MAX_BUFFER) {
    s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER);
  }
}

/** 启动或复用会话 shell。已有进程时回放缓冲，避免前端 xterm 重建后白屏。 */
export function ensure(
  sessionId: string,
  workDir: string,
  cols: number,
  rows: number,
): { ok: true; replay: string } | { ok: false; error: string } {
  const existing = shells.get(sessionId);
  if (existing) return { ok: true, replay: existing.buffer };

  try {
    const proc = startPty(
      workDir,
      '',
      pickShell(),
      PtyMode.Auto,
      {},
      { cols, rows },
      [],
      { raw: true },
    );
    const s: ShellSession = { sessionId, workDir, proc, buffer: '', cols, rows };
    shells.set(sessionId, s);

    proc.onData((data) => {
      appendBuffer(s, data);
      // 用 s.sessionId（可变）而非闭包捕获的 sessionId：rebind 后的事件要发到新 id
      batcher.push(s.sessionId, data);
    });
    proc.onExit((info) => {
      // 先 flush 掉窗口期内的残余输出，保证退出事件不越位
      batcher.flush(s.sessionId);
      getBus().emit(`shell:exit:${s.sessionId}`, { code: info.code });
      shells.delete(s.sessionId);
      batcher.clear(s.sessionId);
      getLogger().info(
        `[shell] exited sid=${s.sessionId.slice(0, 8)} code=${info.code} duration=${info.durationMs}ms`,
      );
    });

    getLogger().info(`[shell] started sid=${sessionId.slice(0, 8)} cwd=${workDir}`);
    return { ok: true, replay: '' };
  } catch (err: any) {
    const msg = err?.message || String(err);
    getLogger().error(`[shell] ensure failed sid=${sessionId.slice(0, 8)}: ${msg}`);
    return { ok: false, error: msg };
  }
}

export function write(sessionId: string, data: string): void {
  shells.get(sessionId)?.proc.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  const s = shells.get(sessionId);
  if (!s) return;
  s.cols = cols;
  s.rows = rows;
  s.proc.resize(cols, rows);
}

export function close(sessionId: string): void {
  const s = shells.get(sessionId);
  if (!s) return;
  s.proc.kill();
  shells.delete(sessionId);
  batcher.clear(sessionId);
}

/** Claude /clear 场景：把终端迁到新 sessionId，不 kill 进程，保留 buffer */
export function rebind(oldId: string, newId: string): void {
  const s = shells.get(oldId);
  if (!s) return;
  // 先把窗口期内的残余按旧 id 发掉，避免 pending 残留
  batcher.flush(oldId);
  shells.delete(oldId);
  s.sessionId = newId;
  shells.set(newId, s);
}

export function closeAll(): void {
  for (const id of Array.from(shells.keys())) close(id);
}

export function registerShellIpc(): void {
  ipcMain.handle(
    'shell:ensure',
    (_e, sessionId: string, workDir: string, cols: number, rows: number) =>
      ensure(sessionId, workDir, cols, rows),
  );
  // write/resize/close 对不存在的会话是静默 no-op，没有失败路径；IPC 边界统一回 { ok: true }
  ipcMain.handle('shell:write', (_e, sessionId: string, data: string) => {
    write(sessionId, data);
    return { ok: true };
  });
  ipcMain.handle('shell:resize', (_e, sessionId: string, cols: number, rows: number) => {
    resize(sessionId, cols, rows);
    return { ok: true };
  });
  ipcMain.handle('shell:close', (_e, sessionId: string) => {
    close(sessionId);
    return { ok: true };
  });
}
