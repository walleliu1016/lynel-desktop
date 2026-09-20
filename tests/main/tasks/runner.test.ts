// tests/main/tasks/runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, createRun, getRun, listEventsRaw, markRunRunning, getTask, setTaskSession,
} from '../../../src/main/tasks/store.js';
import {
  setRunnerDeps, startRun, cancelRun, isRunning, buildSpawnArgs, buildSpawnCommand,
  activeRunCount, killAllRuns,
} from '../../../src/main/tasks/runner.js';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('tree-kill', () => ({ default: (pid: number, cb?: (e?: Error) => void) => cb?.() }));

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

let proc: FakeProc;
let dir: string;
let spawnArgs: { bin: string; args: string[]; opts: Record<string, unknown> } | null = null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-runner-'));
  setDbFile(path.join(dir, 'tasks.db'));
  proc = new FakeProc();
  spawnArgs = null;
  setRunnerDeps({
    spawn: ((bin: string, args: string[], opts: Record<string, unknown>) => {
      spawnArgs = { bin, args, opts };
      return proc as never;
    }) as never,
    // claudeBin 必须注入绝对 .exe 路径：win32 下 runner 会解析 claudeBin（裸名在本机没装 claude 时
    // 走 fail-fast、根本不 spawn），绝对 .exe 路径会被 buildSpawnCommand 原样放行，fake spawn 才会被调用。
    claudeBin: () => (process.platform === 'win32' ? path.join(dir, 'claude.exe') : 'claude'),
    // 注入 tmp 目录：不注入的话 deps.tasksDir() 会真实 mkdir + 写 ~/.lynel-desktop/tasks/CLAUDE.md。
    tasksDir: () => dir,
  });
});
afterEach(async () => {
  // 把上一个用例可能留下的 run 清干净，避免用例之间串状态
  await killAllRuns();
  expect(activeRunCount()).toBe(0);
  closeDb();
  setDbFile(null);
});

function seed() {
  const t = createTask({
    name: 'n', prompt: '干活', sessionId: '11111111-1111-4111-8111-111111111111',
    scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
  });
  const r = createRun(t.id, 'scheduled');
  markRunRunning(r.id);
  return { task: getTask(t.id)!, run: getRun(r.id)! };
}

describe('buildSpawnArgs', () => {
  it('首次运行用 --session-id，且必带 stream-json + verbose + bypassPermissions', () => {
    const { task } = seed();
    const args = buildSpawnArgs({ ...task, sessionInitialized: 0 });
    expect(args).toContain('-p');
    expect(args).toContain('干活');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });

  it('已有会话后用 --resume，且不再是 --session-id', () => {
    const { task } = seed();
    const args = buildSpawnArgs({ ...task, sessionInitialized: 1 });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
    expect(args[args.indexOf('--resume') + 1]).toBe(task.sessionId);
  });
});

describe('buildSpawnCommand', () => {
  it('非 win32：原样返回裸命令（交给内核按 PATH 解析，不改 POSIX 行为）', () => {
    const res = buildSpawnCommand('claude', ['-p', 'x'], 'linux');
    expect(res).toEqual({ ok: true, file: 'claude', args: ['-p', 'x'] });
  });

  it('win32：从 npm shim 里解析出背后的原生 exe，args 不变', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-shim-'));
    const exeDir = path.join(base, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(exeDir, { recursive: true });
    const exe = path.join(exeDir, 'claude.exe');
    fs.writeFileSync(exe, 'MZ');
    // npm 生成的 cmd shim 就是 `"<shim 目录>\node_modules\...\claude.exe"   %*` 这个形状
    const target = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'].join(path.sep);
    const shim = path.join(base, 'claude.cmd');
    fs.writeFileSync(shim, `@"%dp0%${path.sep}${target}"   %*\r\n`);

    const res = buildSpawnCommand(shim, ['-p', 'x'], 'win32');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.file).toBe(exe);
      expect(res.args).toEqual(['-p', 'x']);
    }
  });

  it('win32：解析不出原生目标 → fail-fast，错误文案可照抄', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-shim-'));
    // 自定义包装：认不出原生目标（目录里也没有 npm 全局安装的 claude.exe）
    const shim = path.join(base, 'claude.cmd');
    fs.writeFileSync(shim, '@echo off\r\nsome-wrapper %*\r\n');

    const res = buildSpawnCommand(shim, ['-p', 'x'], 'win32');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('无法启动 claude');
      expect(res.error).toContain('只找到');
      expect(res.error).toContain('未启动任何进程');
      expect(res.error).toContain('claude_path');
    }
  });

  it('win32：有原生 exe 候选时把具体路径写进建议里', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-shim-'));
    const exeDir = path.join(base, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(exeDir, { recursive: true });
    const exe = path.join(exeDir, 'claude.exe');
    fs.writeFileSync(exe, 'MZ');
    const shim = path.join(base, 'claude.cmd');
    fs.writeFileSync(shim, '@echo off\r\nwrapped %*\r\n');

    const res = buildSpawnCommand(shim, [], 'win32');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(exe);
  });
});

describe('startRun 的进程参数', () => {
  it('stdio[0] 是 ignore（否则 claude 会等 stdin 3 秒）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect((spawnArgs!.opts.stdio as string[])[0]).toBe('ignore');
    expect(spawnArgs!.opts.windowsHide).toBe(true);
    expect(spawnArgs!.opts.detached).toBe(true);
  });

  it('剔除 CLAUDECODE（防嵌套守卫），保留其他 env', () => {
    const { task, run } = seed();
    const saved = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect((spawnArgs!.opts.env as Record<string, unknown>).CLAUDECODE).toBeUndefined();
    if (saved === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = saved;
  });

  it('cwd 是 tasksDir()（所有任务共用）', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    // 精确比对注入值：用 toContain('tasks') 是空转的（tmp 目录名本身就含 tasks）。
    expect(spawnArgs!.opts.cwd).toBe(dir);
  });
});

describe('startRun 的事件落库与推送', () => {
  it('stdout 逐行落库，推送按批（同一 tick 的多行合成一批）', () => {
    const { task, run } = seed();
    const batches: number[] = [];
    startRun(run, task, { onEvent: (_id, evs) => batches.push(evs.length), onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from(
      '{"type":"system","subtype":"init","model":"m","cwd":"/x","tools":["Read"],"mcp_servers":[]}\n' +
      '{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"hi"}]}}\n' +
      'garbage line\n',
    ));
    const rows = listEventsRaw(run.id);
    expect(rows.map((r) => r.type)).toEqual(['system', 'assistant']);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(batches).toEqual([2]);
  });

  it('跨 chunk 的半行被缓冲，拼起来才算一条', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from('{"type":"stderr","text":"半'));
    expect(listEventsRaw(run.id)).toHaveLength(0);
    proc.stdout.emit('data', Buffer.from('行"}\n'));
    const rows = listEventsRaw(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stderr');
  });

  it('stderr 也进流（type=stderr）', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('some warning\n'));
    const rows = listEventsRaw(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stderr');
    expect(rows[0].payload).toContain('some warning');
  });
});

describe('startRun 的终态判定', () => {
  it('以 result 事件判成败，回填 result_* 字段', async () => {
    const { task, run } = seed();
    const finished: string[] = [];
    startRun(run, task, { onEvent: () => {}, onFinish: (_id, s) => finished.push(s) });
    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: '完成',
      num_turns: 3, duration_ms: 1200, total_cost_usd: 0.02, stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation: { x: 1 }, service_tier: 'standard' },
    }) + '\n'));
    proc.emit('close', 0);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(finished).toEqual(['done']);
    const got = getRun(run.id)!;
    expect(got.status).toBe('done');
    expect(got.resultText).toBe('完成');
    expect(got.numTurns).toBe(3);
    expect(got.usageJson).toBe('{"input_tokens":10,"output_tokens":5}');
  });

  it('result 的 is_error=true → status=error，stderr 尾部进 error 字段', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('boom\n'));
    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, result: '超了', num_turns: 20,
    }) + '\n'));
    proc.emit('close', 1);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    const got = getRun(run.id)!;
    expect(got.status).toBe('error');
    expect(got.resultSubtype).toBe('error_max_turns');
    expect(got.isError).toBe(1);
  });

  it('有 result 事件时即使 exit code 非 0 也按 result 判成败（已知 success+exit0 却失败的场景）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }) + '\n'));
    proc.emit('close', 3);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(getRun(run.id)!.status).toBe('done');
  });

  it('没有 result 事件 + exit 非 0 → status=error，便于排查', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('Error: Invalid session ID. Must be a valid UUID.\n'));
    proc.emit('close', 1);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    const got = getRun(run.id)!;
    expect(got.status).toBe('error');
    expect(got.exitCode).toBe(1);
    expect(got.error).toContain('Invalid session ID');
  });

  it('没有 result 事件 + exit 0 → 也判 error（不能把空跑当成功）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.emit('close', 0);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(getRun(run.id)!.status).toBe('error');
  });
});

describe('resume 回退（R2 实测判据）', () => {
  it('命中 error_during_execution + num_turns=0 + 无 assistant → 用 --session-id 重跑一次，resume_used=0', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);

    const spawned: string[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        spawned.push(args.includes('--resume') ? 'resume' : 'new');
        queueMicrotask(() => {
          if (args.includes('--resume')) {
            proc.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'error_during_execution', is_error: true,
              num_turns: 0, total_cost_usd: 0, result: '', session_id: '99999999-9999-4999-8999-999999999999',
            }) + '\n'));
            proc.emit('close', 1);
          } else {
            proc.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'success', is_error: false, result: '重建成功', num_turns: 1,
            }) + '\n'));
            proc.emit('close', 0);
          }
        });
        return proc as never;
      }) as never,
      claudeBin: () => (process.platform === 'win32' ? path.join(dir, 'claude.exe') : 'claude'),
    });

    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false), { timeout: 4000 });
    expect(spawned).toEqual(['resume', 'new']);
    const got = getRun(r.id)!;
    expect(got.status).toBe('done');
    expect(got.resumeUsed).toBe(0);
    // 关键：错误 result 里的随机 session_id 绝不能写回
    expect(getTask(t.id)!.sessionId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('resume 成功时不重跑，resumeUsed=1', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    const spawned: string[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        spawned.push(args.includes('--resume') ? 'resume' : 'new');
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
          }) + '\n'));
          proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }) + '\n'));
          proc.emit('close', 0);
        });
        return proc as never;
      }) as never,
      claudeBin: () => (process.platform === 'win32' ? path.join(dir, 'claude.exe') : 'claude'),
    });
    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false), { timeout: 4000 });
    expect(spawned).toEqual(['resume']);
    expect(getRun(r.id)!.resumeUsed).toBe(1);
  });

  it('回退只做一次：重建后的 run 再命中同一判据也不再 spawn（防 spawn 风暴）', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);

    const spawned: string[] = [];
    const procs: FakeProc[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        const p = new FakeProc();
        procs.push(p);
        spawned.push(args.includes('--resume') ? 'resume' : 'new');
        // 前三代都吐同一个早失败签名（session id 已存在 / 代理鉴权早退都会长这样）。
        // 第 4 代起静默：万一护栏失效，断言是干净的失败，而不是微任务链饿死事件循环。
        if (procs.length <= 3) {
          queueMicrotask(() => {
            p.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'error_during_execution', is_error: true,
              num_turns: 0, total_cost_usd: 0, result: '',
              session_id: '99999999-9999-4999-8999-999999999999',
            }) + '\n'));
            p.emit('close', 1);
          });
        }
        return p as never;
      }) as never,
      claudeBin: () => (process.platform === 'win32' ? path.join(dir, 'claude.exe') : 'claude'),
    });

    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false), { timeout: 4000 });
    expect(spawned).toEqual(['resume', 'new']); // 出现第 3 个 spawn 就是风暴
    expect(getRun(r.id)!.status).toBe('error');
    expect(getRun(r.id)!.resumeUsed).toBe(0);
  });

  it('回退后旧进程迟到的 error 不会打死新进程的 run', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);

    const spawned: string[] = [];
    const procs: FakeProc[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        // 每次都是**新**进程：共用同一个 emitter 掩盖不出「旧监听器没摘」。
        const p = new FakeProc();
        procs.push(p);
        const isResume = args.includes('--resume');
        spawned.push(isResume ? 'resume' : 'new');
        if (isResume) {
          queueMicrotask(() => {
            p.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'error_during_execution', is_error: true,
              num_turns: 0, total_cost_usd: 0, result: '',
            }) + '\n'));
            p.emit('close', 1);
          });
        }
        return p as never;
      }) as never,
      claudeBin: () => (process.platform === 'win32' ? path.join(dir, 'claude.exe') : 'claude'),
    });

    const finished: string[] = [];
    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: (_id, s) => finished.push(s) });
    await vi.waitFor(() => expect(spawned).toEqual(['resume', 'new']));

    // 旧进程的 error 迟到：没有 `a.proc !== proc` 这道闸，它会 finish 掉新进程的 run
    procs[0].emit('error', new Error('迟到的进程错误'));
    expect(finished).toEqual([]);
    expect(isRunning(r.id)).toBe(true);

    procs[1].stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: '重建成功', num_turns: 1,
    }) + '\n'));
    procs[1].emit('close', 0);
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false));
    expect(finished).toEqual(['done']);
    expect(getRun(r.id)!.status).toBe('done');
  });
});

describe('取消', () => {
  it('cancelRun 杀掉进程并回落为 error/interrupted 由调用方决定', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect(isRunning(run.id)).toBe(true);
    expect(cancelRun(run.id)).toBe(true);
    expect(proc.killed).toBe(true);
    expect(cancelRun(run.id)).toBe(false);
  });
});
