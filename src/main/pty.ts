import * as pty from 'node:pty';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getLogger } from './log.js';

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
  onExit: (cb: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}

// macOS GUI 应用从 Finder 启动时 PATH 不完整，这里用用户的 login shell 解析完整环境变量，
// 确保能找到通过 npm/homebrew 安装的 claude。
let cachedDarwinEnv: Record<string, string> | null = null;

function resolveShellEnv(): Record<string, string> {
  if (os.platform() !== 'darwin') return {};
  if (cachedDarwinEnv) return cachedDarwinEnv;

  const shell = process.env.SHELL || '/bin/zsh';
  const logger = getLogger();
  logger.info(`[pty] resolving darwin shell env via ${shell}`);

  try {
    const out = execFileSync(shell, ['-ilc', 'env'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const env: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    cachedDarwinEnv = env;
    logger.info(`[pty] resolved PATH=${env.PATH?.slice(0, 120)}...`);
    return env;
  } catch (err: any) {
    logger.warn('[pty] failed to resolve darwin shell env:', err?.message || err);
    return {};
  }
}

// 如果 bin 是相对路径（如 'claude'），在解析后的 PATH 中查找绝对路径，
// 避免 node-pty 因 PATH 不完整找不到命令而直接退出。
function resolveBin(bin: string, env: Record<string, string>): string {
  if (path.isAbsolute(bin) || bin.includes(path.sep)) return bin;
  const pathEnv = env.PATH || process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // continue searching
    }
  }
  return bin;
}

function buildCommand(
  bin: string,
  sessionId: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  extraArgs: string[] = [],
): { file: string; args: string[] } {
  const args: string[] = [];
  if (mode === PtyMode.New && sessionId) {
    args.push('--session-id', sessionId);
  } else if (mode === PtyMode.Resume && sessionId) {
    args.push('--resume', sessionId);
  }
  args.push(...extraArgs);

  if (os.platform() === 'win32') {
    const envEntries = Object.entries(env);
    if (envEntries.length === 0) {
      return { file: 'cmd.exe', args: ['/c', bin, ...args] };
    }
    // Windows ConPTY 通过 pty.spawn 的 env 选项传播环境变量不可靠，
    // 在命令行显式 set 后再执行目标程序，确保 ANTHROPIC_BASE_URL 等变量生效。
    const envArgs = envEntries.flatMap(([k, v]) => ['set', `${k}=${v}`]);
    getLogger().info(`[pty] windows env injection: ${envArgs.join(' ')} && ${bin} ${args.join(' ')}`);
    return { file: 'cmd.exe', args: ['/c', ...envArgs, '&&', bin, ...args] };
  }
  return { file: bin, args };
}

export function start(
  cwd: string,
  sessionId: string,
  bin: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  size: PtySize = { cols: 80, rows: 24 },
  extraArgs: string[] = [],
): PtyProcess {
  const darwinEnv = resolveShellEnv();
  const resolvedBin = resolveBin(bin, darwinEnv);
  const { file, args } = buildCommand(resolvedBin, sessionId, mode, env, extraArgs);
  const mergedEnv = { ...process.env, ...darwinEnv, ...env } as { [key: string]: string };

  const logger = getLogger();
  logger.info(`[pty] spawn ${file} ${args.map((a) => `"${a}"`).join(' ')} (cwd=${cwd})`);

  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: mergedEnv,
  });

  let firstData: string | null = null;

  return {
    pid: proc.pid,
    onData: (cb) => {
      proc.onData((data) => {
        if (firstData === null) {
          firstData = data;
          logger.info(`[pty] first data (sid=${sessionId.slice(0, 8)}...): ${data.slice(0, 200)}`);
        }
        cb(data);
      });
    },
    onExit: (cb) => proc.onExit(({ exitCode }) => {
      logger.info(`[pty] exited sid=${sessionId.slice(0, 8)}... code=${exitCode ?? 0} firstData=${firstData ? firstData.slice(0, 120) : 'none'}`);
      cb(exitCode ?? 0);
    }),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => {
      if (os.platform() === 'win32' && signal) {
        proc.kill();
      } else {
        proc.kill(signal);
      }
    },
  };
}
