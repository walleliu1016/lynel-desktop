import { describe, it, expect } from 'vitest';

// GitHub Actions macOS runner 在 headless 环境下 posix_spawnp 会失败，本地可正常执行。
// 这里用动态导入，避免 CI 跳过测试时仍加载 node-pty 原生模块导致套件加载失败。
const isCI = !!process.env.CI;

describe('pty', () => {
  // Windows 上 node-pty(ConPTY) spawn+exit 裸测约 1.4s，全量测试并发负载下可达 4-5s+，
  // 5s 默认超时太紧导致偶发失败，故单独放宽。
  it.skipIf(isCI)('spawns a process and exits', { timeout: 20000 }, async () => {
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

  // raw 模式用于启动交互式 shell（powershell/cmd/bash）：跳过 buildCommand 的
  // win32 `cmd.exe /c` 包装，直接把 shell 交给 pty.spawn。
  it.skipIf(isCI)('raw 模式直通 spawn shell 并能收发', { timeout: 20000 }, async () => {
    const { start, PtyMode } = await import('../../src/main/pty.js');
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'powershell.exe' : '/bin/sh';
    const marker = 'LYNEL_RAW_OK';

    const proc = start(
      process.cwd(),
      '',
      bin,
      PtyMode.Auto,
      {},
      { cols: 80, rows: 24 },
      [],
      { raw: true },
    );
    expect(proc.pid).toBeGreaterThan(0);

    const output = await new Promise<string>((resolve) => {
      let acc = '';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(acc);
      };
      proc.onData((d) => {
        acc += d;
        if (acc.includes(marker)) finish();
      });
      proc.write(isWin ? `echo ${marker}\r` : `echo ${marker}\n`);
      // PowerShell 冷启动可能较慢，给足时间；超时也会 resolve，由断言给出可读失败
      setTimeout(finish, 12000);
    });

    proc.kill('SIGTERM');
    expect(output).toContain(marker);
  });
});
