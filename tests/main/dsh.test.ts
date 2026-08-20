import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * dsh 进程管理回归测试。
 *
 * 背景：dsh 与 claude 一致，使用用户全局安装的 dsh（npm install -g @deepseek-ai/dsh），
 * 版本由用户用 npm 管理。Windows 下 dsh 是 `.cmd` shim，经 `cmd.exe /c` 执行；
 * 其他平台直接执行 `dsh`（POSIX shebang）。spawn 本身不带 shell（cmd 是真实
 * cmd.exe，含空格的安装路径由 Node 按 CommandLineToArgvW 自动加引号，避免被
 * cmd.exe 拆散）。启动前先探测 `dsh --version`，未安装时抛出带安装指引的错误。
 */

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

// macOS 下 resolveShellEnvSync 内部会经 execFileSync 跑 `$SHELL -ilc env`，会污染
// dsh 探测（dsh --version）的调用计数。mock 掉 pty 的 shell-env 解析，让本测试
// 聚焦 dsh 自身逻辑，与平台无关（CI 的 darwin runner 也能通过）。
vi.mock('../../src/main/pty.js', () => ({
  resolveShellEnvSync: () => ({}),
}));

// mock 必须在 import 之前声明，vitest 会 hoist；dshManager 是模块级单例
import { dshManager } from '../../src/main/dsh.js';

function fakeProc(): { stdout: EventEmitter; stderr: EventEmitter; pid: number; on: () => void } {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return { stdout, stderr, pid: 4242, on: () => {} };
}

beforeEach(() => {
  spawnMock.mockReset();
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue('0.1.0-rc.7'); // 探测 dsh --version 成功
  (dshManager as unknown as { reset: () => void }).reset();
});

describe('dshManager', () => {
  it('spawns 全局 dsh 且不带 shell（Windows 经 cmd.exe /c 执行 .cmd shim）', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc);

    const pending = dshManager.ensure();
    // 模拟 harness 就绪信号，让 ensure() 正常 resolve，避免挂起 120s 超时
    proc.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:51777\r\n'));
    const handle = await pending;

    expect(handle.url).toBe('http://127.0.0.1:51777');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args, options] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    // 核心回归点：spawn 不带 shell（cmd 是真实可执行文件，shell 会引发含空格路径坑）
    expect(options.shell).toBeFalsy();
    // Windows：dsh 是 .cmd shim，经 cmd.exe /c 执行；其他平台直接执行 dsh
    if (process.platform === 'win32') {
      expect(cmd).toBe('cmd.exe');
      expect(args).toEqual(['/c', 'dsh', 'web', '--port', '0']);
    } else {
      expect(cmd).toBe('dsh');
      expect(args).toEqual(['web', '--port', '0']);
    }
    // 启动前必须探测 dsh --version（未安装则抛出安装指引）
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('dsh 未安装时 ensure() 抛出安装指引，且单例重置可重试', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    await expect(dshManager.ensure()).rejects.toThrow('请先执行: npm install -g @deepseek-ai/dsh');
    // 失败后单例应重置，下次 ensure 重新走探测
    await expect(dshManager.ensure()).rejects.toThrow('请先执行: npm install -g @deepseek-ai/dsh');
  });
});
