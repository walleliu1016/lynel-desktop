import { describe, it, expect, vi, beforeEach } from 'vitest';

/** probe（claude --version 预探测）启动链回归。
 *  目标行为：probe 是 fire-and-forget —— 只为补 ENOENT/EACCES 诊断与
 *  macOS forkpty 静默失败的真因，绝不能拖慢或阻断真正的 PTY spawn。
 *  踩过的坑：probe 曾 await 在启动链上，主进程上下文 --version 实测 3~8s+，
 *  每次开会话都白付这笔延迟，超时前会话根本起不来。 */

interface FakeChild {
  pid: number;
  on: (ev: string, cb: (...args: any[]) => void) => void;
  emitExit: (code: number) => void;
}

function fakeChild(): FakeChild {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    pid: 4242,
    on: (ev, cb) => { handlers[ev] = cb; },
    emitExit: (code) => handlers.exit?.(code, null),
  };
}

const spawnedChildren: FakeChild[] = [];
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

// node-pty 换假实现：测试只关心 probe 与启动链的时序，不跑真 ConPTY/forkpty
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 99999,
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  })),
}));

import { start, PtyMode } from '../../src/main/pty.js';

// 两个用例必须用不同的 bin（probeOkCache 按 resolvedBin 缓存），
// 否则前一个用例的成功结果会让后一个用例根本不再探测。
const BIN_A = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
const BIN_B = process.platform === 'win32' ? 'where.exe' : '/bin/ls';

beforeEach(() => {
  spawnedChildren.length = 0;
  spawnMock.mockReset();
});

describe('probe fire-and-forget（不阻塞 PTY 启动链）', () => {
  it('probe 失败（exit 1 重试后仍失败）：start 照常成功，且探测确实发生过', async () => {
    spawnMock.mockImplementation(() => {
      const c = fakeChild();
      spawnedChildren.push(c);
      // 首次与重试两次都立即失败（非超时路径）
      queueMicrotask(() => c.emitExit(1));
      return c;
    });

    const proc = await start(
      process.cwd(),
      'sid-probe-fail',
      BIN_A,
      PtyMode.Auto,
      {},
      { cols: 80, rows: 24 },
      [],
      { probe: true },
    );

    expect(proc.pid).toBe(99999);
    // 防"删掉 probe 也能过"：--version 探测必须真实发出过（首次 + 失败重试）。
    // fire-and-forget 后首次/重试都发生在后台，需要轮询等待。
    const countProbeCalls = () =>
      spawnMock.mock.calls.filter(([, args]) =>
        Array.isArray(args) && (args as string[]).includes('--version'),
      ).length;
    const deadline = Date.now() + 3000;
    while (countProbeCalls() < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(countProbeCalls()).toBeGreaterThanOrEqual(2);
  });

  it('probe 慢/挂起：start 不等它，立即进入 PTY spawn', { timeout: 15000 }, async () => {
    // 探测子进程永不退出 —— 当前实现会 await 到 8s 超时才放行
    spawnMock.mockImplementation(() => {
      const c = fakeChild();
      spawnedChildren.push(c);
      return c;
    });

    const t0 = Date.now();
    const proc = await start(
      process.cwd(),
      'sid-probe-hang',
      BIN_B,
      PtyMode.Auto,
      {},
      { cols: 80, rows: 24 },
      [],
      { probe: true },
    );
    const elapsed = Date.now() - t0;

    expect(proc.pid).toBe(99999);
    expect(elapsed).toBeLessThan(3000); // 旧实现 ≥8000ms（probe 超时放行）

    // 收尾：让后台 probe settle，清掉 8s 定时器，避免测试进程被挂住
    spawnedChildren.forEach((c) => c.emitExit(0));
  });
});
