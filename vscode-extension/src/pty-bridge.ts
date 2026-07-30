import * as pty from 'node-pty';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';

export enum PtyMode {
  Auto = 'auto',
  New = 'new',
  Resume = 'resume',
}

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtyProcess {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (info: PtyExitInfo) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}

export interface PtyExitInfo {
  code: number;
  durationMs: number;
  outputTail: string;
  resolvedBin: string;
  binExists: boolean | 'unknown';
  spawnArgs: string[];
  cwd: string;
}

// macOS env 缓存（与现有逻辑一致）
let cachedDarwinEnv: Record<string, string> | null = null;

export async function preloadEnv(): Promise<void> {
  if (os.platform() !== 'darwin') return;
  const userShell = process.env.SHELL || '/bin/zsh';
  return new Promise<void>((resolve) => {
    execFile(
      userShell, ['-ilc', 'env'],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 },
      (err: Error | null, stdout: string) => {
        if (!err && stdout) {
          cachedDarwinEnv = {};
          for (const line of stdout.split('\n')) {
            const idx = line.indexOf('=');
            if (idx > 0) {
              cachedDarwinEnv[line.slice(0, idx)] = line.slice(idx + 1);
            }
          }
        }
        resolve();
      },
    );
  });
}

function resolveBin(bin: string, env: Record<string, string>): string {
  // 如果是含路径分隔符的路径，直接返回
  if (path.isAbsolute(bin) || bin.includes(path.sep)) return bin;
  // Windows 下 CLI 可能是 .cmd shim
  if (os.platform() === 'win32' && !bin.endsWith('.exe') && !bin.endsWith('.cmd')) {
    return bin + '.cmd';
  }
  // 在 PATH 中查找
  const envPath = env.PATH || process.env.PATH || '';
  const dirs = envPath.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return bin; // fallback
}

function buildCommand(
  bin: string, args: string[], mode: PtyMode, sid: string,
): { shell: string; shellArgs: string[] } {
  if (os.platform() === 'win32') {
    const allArgs = [bin, ...args];
    if (mode === PtyMode.New) allArgs.push('--session-id', sid);
    else if (mode === PtyMode.Resume) allArgs.push('--resume', sid);
    return {
      shell: 'cmd.exe',
      shellArgs: ['/c', allArgs.join(' ')],
    };
  }
  const finalArgs = [...args];
  if (mode === PtyMode.New) finalArgs.push('--session-id', sid);
  else if (mode === PtyMode.Resume) finalArgs.push('--resume', sid);
  return { shell: bin, shellArgs: finalArgs };
}

export interface StartPtyOptions {
  bin: string;
  args?: string[];
  mode: PtyMode;
  sessionId: string;
  workDir: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export function startPty(opts: StartPtyOptions): PtyProcess {
  const { bin, args = [], mode, sessionId, workDir, cols = 80, rows = 24 } = opts;
  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(os.platform() === 'darwin' ? cachedDarwinEnv : {}),
    ...opts.env,
  };
  const resolvedBin = resolveBin(bin, mergedEnv);
  const { shell, shellArgs } = buildCommand(resolvedBin, args, mode, sessionId);

  const startTime = Date.now();
  const outputChunks: string[] = [];

  const proc = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workDir,
    env: mergedEnv,
  });

  const adapt: PtyProcess = {
    pid: proc.pid,
    onData(cb) {
      proc.onData((d: string) => {
        outputChunks.push(d);
        if (outputChunks.length > 200) outputChunks.shift();
        cb(d);
      });
    },
    onExit(cb) {
      proc.onExit(({ exitCode }) => {
        cb({
          code: exitCode,
          durationMs: Date.now() - startTime,
          outputTail: outputChunks.join('').slice(-4096),
          resolvedBin,
          binExists: fs.existsSync(resolvedBin),
          spawnArgs: shellArgs,
          cwd: workDir,
        });
      });
    },
    write(data) { proc.write(data); },
    resize(cols, rows) { proc.resize(cols, rows); },
    kill(signal) {
      if (os.platform() === 'win32') {
        try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch { /* 进程可能已退出 */ }
      } else {
        proc.kill(signal || 'SIGTERM');
      }
    },
  };

  return adapt;
}
