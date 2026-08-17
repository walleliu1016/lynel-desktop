import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * dsh 进程管理回归测试。
 *
 * 背景：曾用 `shell: process.platform === 'win32'` 启动 dsh。Windows 下 shell
 * 走 cmd.exe，Node 只拼接字符串不转义，安装路径含空格（`...\Programs\Lynel`）
 * 时被拆散报"不是内部或外部命令"，dsh 提前退出（macOS / 无空格路径不受影响）。
 * 现在 spawn 不带 shell，此处断言 spawn 选项里 shell 必须为 falsy。
 */

// mock electron：dsh.ts 顶层依赖 app，测试环境无 electron runtime
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => 'C:\\App',
  },
}));

// packaged 分支读取 process.resourcesPath（Electron 全局，测试环境无）
beforeEach(() => {
  (process as unknown as { resourcesPath?: string }).resourcesPath = 'C:\\Resources';
});

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
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
  (dshManager as unknown as { reset: () => void }).reset();
});

describe('dshManager', () => {
  it('spawns 内置 dsh 且不带 shell（含空格的 Windows 安装路径不受影响）', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc);

    const pending = dshManager.ensure();
    // 模拟 harness 就绪信号，让 ensure() 正常 resolve，避免挂起 120s 超时
    proc.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:51777\r\n'));
    const handle = await pending;

    expect(handle.url).toBe('http://127.0.0.1:51777');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args, options] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    // 核心回归点：Windows 下不能走 cmd.exe（shell），否则含空格的 execPath 被拆散
    expect(options.shell).toBeFalsy();
    expect(cmd).toBe(process.execPath);
    // 参数结构：--expose-internals <dshBin> web --port 0
    expect(args[0]).toBe('--expose-internals');
    expect(args[1]).toContain('@deepseek-ai');
    expect(args.slice(2)).toEqual(['web', '--port', '0']);
    // ELECTRON_RUN_AS_NODE 必须注入，否则 execPath 会以 Electron 模式启动
    const env = options.env as Record<string, string>;
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  });
});
