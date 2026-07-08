import * as pty from 'node-pty';
import os from 'node:os';
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
  const { file, args } = buildCommand(bin, sessionId, mode, env, extraArgs);

  getLogger().info(`[pty] spawn ${file} ${args.map((a) => `"${a}"`).join(' ')} (cwd=${cwd})`);

  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: { ...process.env, ...env } as { [key: string]: string },
  });

  return {
    pid: proc.pid,
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(({ exitCode }) => cb(exitCode ?? 0)),
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
