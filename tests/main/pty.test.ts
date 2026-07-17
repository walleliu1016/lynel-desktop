import { describe, it, expect } from 'vitest';

// GitHub Actions macOS runner 在 headless 环境下 posix_spawnp 会失败，本地可正常执行。
// 这里用动态导入，避免 CI 跳过测试时仍加载 node-pty 原生模块导致套件加载失败。
const isCI = !!process.env.CI;

describe('pty', () => {
  it.skipIf(isCI)('spawns a process and exits', async () => {
    const { start, PtyMode } = await import('../../src/main/pty.js');
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'cmd.exe' : '/bin/sh';
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
      proc.write(isWin ? 'exit 0\r' : 'exit 0\n');
      setTimeout(() => proc.kill('SIGTERM'), 2000);
    });
  });
});
