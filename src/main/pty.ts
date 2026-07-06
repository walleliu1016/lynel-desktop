import * as pty from 'node-pty';
import os from 'node:os';

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
): { file: string; args: string[] } {
  const args: string[] = [];
  if (mode === PtyMode.New && sessionId) {
    args.push('--session-id', sessionId);
  } else if (mode === PtyMode.Resume && sessionId) {
    args.push('--resume', sessionId);
  }

  if (os.platform() === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/c', bin, ...args],
    };
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
): PtyProcess {
  const { file, args } = buildCommand(bin, sessionId, mode);

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
