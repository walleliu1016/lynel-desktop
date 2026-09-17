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
const killMock = vi.fn();
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

// restart / update 都会杀 harness 进程树，mock 掉以免测试真的去 taskkill（同步回调）
vi.mock('tree-kill', () => ({
  default: (...args: unknown[]) => killMock(...args),
}));

// mock 必须在 import 之前声明，vitest 会 hoist；dshManager 是模块级单例
import { dshManager } from '../../src/main/dsh.js';

// 假进程必须是真的 EventEmitter：restart / update 用例要 emit exit 驱动状态推进，
// 用空实现的 on() 会让这些事件监听注册不上。
type FakeProc = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };

function fakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 4242;
  return proc;
}

/** 推进微任务队列，等 async 方法内部（shutdown → ensure 等）走到下一步。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  spawnMock.mockReset();
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue('0.1.0-rc.7'); // 探测 dsh --version 成功
  killMock.mockReset();
  killMock.mockImplementation((_pid: number, _signal: string, cb?: () => void) => { cb?.(); });
  const internals = dshManager as unknown as { reset: () => void; restarting: unknown; updating: boolean };
  internals.reset();
  // reset() 只清进程状态（restart/update 进行中时它也会被调用，不能连带清掉互斥标志）
  internals.restarting = null;
  internals.updating = false;
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
      expect(args).toEqual(['/c', 'dsh', 'web', '--no-open', '--port', '0']);
    } else {
      expect(cmd).toBe('dsh');
      expect(args).toEqual(['web', '--no-open', '--port', '0']);
    }
    // 启动前先 where/which 定位可执行文件，再探测 dsh --version（未安装则抛出安装指引）
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    expect((execFileSyncMock.mock.calls[1] as [string, string[]])[1].join(' ')).toContain('--version');
  });

  it('dsh 未安装时 ensure() 抛出安装指引，且单例重置可重试', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    await expect(dshManager.ensure()).rejects.toThrow('请先执行: npm install -g @deepseek-ai/dsh');
    // 失败后单例应重置，下次 ensure 重新走探测
    await expect(dshManager.ensure()).rejects.toThrow('请先执行: npm install -g @deepseek-ai/dsh');
  });

  it('就绪行带 ?token= 时完整保留，不能只取端口', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc);

    const pending = dshManager.ensure();
    proc.stdout.emit('data', Buffer.from(
      'dsh web: http://127.0.0.1:60763/?token=s7up3DGuT3VDwi7MsOVkr40yT\r\n',
    ));
    const handle = await pending;

    // 丢掉 token 的话 iframe 加载的是未鉴权地址
    expect(handle.url).toBe('http://127.0.0.1:60763/?token=s7up3DGuT3VDwi7MsOVkr40yT');
    expect(handle.port).toBe(60763);
  });

  it('restart() 杀掉旧进程后按原参数重启，返回新端口', async () => {
    const first = fakeProc();
    const second = fakeProc();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const pending = dshManager.ensure();
    first.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:1111\r\n'));
    await pending;

    const restarted = dshManager.restart();
    await flush(); // 让 shutdown 走完、进入第二次 ensure
    second.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:2222\r\n'));
    const handle = await restarted;

    // 重启分配新随机端口，iframe 必须切到新 URL
    expect(handle).toEqual({ url: 'http://127.0.0.1:2222', port: 2222 });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    // 启动参数与首次一致，仍是 `dsh web --no-open --port 0`
    const [cmd, args] = spawnMock.mock.calls[1] as [string, string[]];
    if (process.platform === 'win32') expect(cmd).toBe('cmd.exe');
    else expect(cmd).toBe('dsh');
    expect(args).toContain('--no-open');
  });

  it('version() 返回本地版本与 registry 最新版本', async () => {
    const npmProc = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc);

    const pending = dshManager.version();
    await flush(); // 等 npm view 子进程被 spawn 出来
    npmProc.stdout.emit('data', Buffer.from('0.2.0\n'));
    npmProc.emit('exit', 0);

    await expect(pending).resolves.toEqual({ current: '0.1.0-rc.7', latest: '0.2.0' });
    const [, args, options] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(args).toContain('view');
    expect(options.shell).toBeFalsy();
  });

  it('version() 区分「没装」与「装了但跑不起来」，并带出真实原因', async () => {
    const lookup = process.platform === 'win32' ? 'where' : 'which';

    // 1) where/which 找不到可执行文件 → 未安装
    execFileSyncMock.mockImplementation((cmd: string) => {
      if (cmd === lookup) throw new Error('not found');
      return '0.1.0-rc.7';
    });
    const npmProc1 = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc1);
    const first = dshManager.version();
    await flush();
    npmProc1.emit('exit', 1);
    await expect(first).resolves.toMatchObject({
      current: '',
      error: expect.stringContaining('未找到 dsh 命令'),
    });

    // 2) 命令在、但执行时崩了（例如上一次安装被打断，依赖残缺）：
    //    必须带出 stderr，不能笼统报成"没装" —— 那会让用户以为明明装了却找不到
    execFileSyncMock.mockImplementation((cmd: string) => {
      if (cmd === lookup) return '/usr/local/bin/dsh';
      throw Object.assign(new Error('Command failed'), {
        status: 1,
        stderr: Buffer.from("Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'js-yaml'"),
      });
    });
    const npmProc2 = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc2);
    const second = dshManager.version();
    await flush();
    npmProc2.emit('exit', 1);

    const info = await second;
    expect(info.current).toBe('');
    expect(info.error).toContain('ERR_MODULE_NOT_FOUND');
    expect(info.error).not.toContain('未找到 dsh 命令');
  });

  it('version() 在 registry 查询失败时 latest 为 null（不阻塞本地版本展示）', async () => {
    const npmProc = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc);

    const pending = dshManager.version();
    await flush();
    npmProc.emit('exit', 1);

    await expect(pending).resolves.toEqual({ current: '0.1.0-rc.7', latest: null });
  });

  it('update() 先停 harness 再全局安装，返回安装后的版本', async () => {
    const running = fakeProc();
    const npmProc = fakeProc();
    spawnMock.mockReturnValueOnce(running).mockReturnValueOnce(npmProc);

    const ensured = dshManager.ensure();
    running.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:1111\r\n'));
    await ensured;

    // 安装完成后重新探测版本，应拿到新版本而非启动时那个
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    execFileSyncMock.mockImplementation((cmd: string) =>
      cmd === lookup ? '/usr/local/bin/dsh' : '0.2.0');

    const pending = dshManager.update();
    await flush();
    npmProc.emit('exit', 0);

    await expect(pending).resolves.toEqual({ version: '0.2.0' });

    const [cmd, args] = spawnMock.mock.calls[1] as [string, string[]];
    if (process.platform === 'win32') expect(cmd).toBe('cmd.exe');
    else expect(cmd).toBe('npm');
    // --force 不能省：没有它，残缺依赖（版本对得上、文件缺失）不会被重新解包
    expect(args).toEqual(
      process.platform === 'win32'
        ? ['/d', '/c', 'npm', 'install', '-g', '@deepseek-ai/dsh@latest', '--force']
        : ['install', '-g', '@deepseek-ai/dsh@latest', '--force'],
    );
    // 安装前必须已经把 harness 停掉（Windows 下运行中的 node 会锁定全局包文件）
    expect(dshManager.status.running).toBe(false);
  });

  it('更新期间应用退出：shutdown() 一并收掉 npm 子进程，不留孤儿安装', async () => {
    const npmProc = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc);

    const pending = dshManager.update();
    await flush(); // npm 已启动、挂在 update() 上

    const shutdown = dshManager.shutdown();
    npmProc.emit('exit', null); // 被杀的进程以非 0 退出
    await shutdown;

    // npm 子进程被杀 → update() 以失败告终（应用正在退出，调用方已不关心结果）
    await expect(pending).rejects.toThrow(/npm 安装失败/);
    expect(killMock).toHaveBeenCalledWith(npmProc.pid, 'SIGTERM', expect.any(Function));
  });

  it('update() 中 npm 失败时抛出带 npm 输出的错误', async () => {
    const npmProc = fakeProc();
    spawnMock.mockReturnValueOnce(npmProc);

    const pending = dshManager.update();
    await flush();
    npmProc.stderr.emit('data', Buffer.from('EACCES: permission denied'));
    npmProc.emit('exit', 1);

    await expect(pending).rejects.toThrow(/npm 安装失败/);
    await expect(pending).rejects.toThrow(/EACCES/);
  });
});
