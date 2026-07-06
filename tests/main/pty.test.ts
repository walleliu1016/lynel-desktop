import { describe, it, expect } from 'vitest';
import { start, PtyMode } from '../../src/main/pty.js';

describe('pty', () => {
  it('spawns a process and exits', async () => {
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'cmd.exe' : '/bin/echo';
    const proc = start(
      process.cwd(),
      '',
      bin,
      PtyMode.Auto,
      {},
      { cols: 80, rows: 24 },
    );
    expect(proc.pid).toBeGreaterThan(0);

    return new Promise<void>((resolve) => {
      proc.onExit(() => resolve());
      if (isWin) {
        proc.write('exit 0\r');
      } else {
        proc.write('hello\n');
      }
      setTimeout(() => proc.kill('SIGTERM'), 2000);
    });
  });
});
