import { describe, it, expect, afterEach } from 'vitest';

// 与 pty.test.ts 同样的原因：CI 的 macOS runner 在 headless 下 posix_spawnp 会失败
const isCI = !!process.env.CI;

describe('shell', () => {
  afterEach(async () => {
    const mod = await import('../../src/main/shell.js');
    mod.closeAll();
  });

  it('pickShell 返回绝对路径', async () => {
    const { pickShell } = await import('../../src/main/shell.js');
    const sh = pickShell();
    expect(sh.length).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      expect(sh).toMatch(/\.exe$/i);
    } else {
      expect(sh.startsWith('/')).toBe(true);
    }
  });

  it('ensure 对未知会话返回 ok=false 以外的合法结构', async () => {
    const { ensure } = await import('../../src/main/shell.js');
    // workDir 传一个不存在的目录：spawn 应失败并返回结构化错误，而不是抛异常
    const res = ensure('nonexistent-session', '/definitely/not/a/real/dir/lynel', 80, 24);
    expect(res).toHaveProperty('ok');
    if (!res.ok) expect(typeof res.error).toBe('string');
  });

  it.skipIf(isCI)('ensure 启动 shell，write 后能收到回显，close 后清理', { timeout: 30000 }, async () => {
    const mod = await import('../../src/main/shell.js');
    const { getBus } = await import('../../src/main/events.js');
    const sid = 'test-shell-1';
    const marker = 'LYNEL_SHELL_OK';

    const chunks: string[] = [];
    const onData = (data: string) => chunks.push(data);
    getBus().on(`shell:${sid}`, onData);

    const res = mod.ensure(sid, process.cwd(), 80, 24);
    expect(res.ok).toBe(true);

    const isWin = process.platform === 'win32';
    mod.write(sid, isWin ? `echo ${marker}\r` : `echo ${marker}\n`);

    await new Promise((r) => setTimeout(r, 10000));
    getBus().off(`shell:${sid}`, onData);

    expect(chunks.join('')).toContain(marker);
    mod.close(sid);
  });
});
