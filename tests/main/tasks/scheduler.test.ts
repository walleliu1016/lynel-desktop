import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, getTask, updateTask, listRuns, createRun, getRun, listLiveRuns,
  markRunRunning, finishRun,
} from '../../../src/main/tasks/store.js';
import {
  setSchedulerDeps, tick, runTaskNow, startScheduler, stopScheduler, schedulerSnapshot,
} from '../../../src/main/tasks/scheduler.js';
import { CATCH_UP_MS, QUEUE_TIMEOUT_MS, computeNextRun } from '../../../src/main/tasks/schedule.js';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('tree-kill', () => ({ default: (_pid: number, cb?: (e?: Error) => void) => cb?.() }));

const started: string[] = [];
const finished: Array<{ runId: string; status: string }> = [];
let failStart = false;

const NOW = new Date('2026-09-18T09:00:00').getTime();

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-sched-'));
  setDbFile(path.join(dir, 'tasks.db'));
  started.length = 0;
  finished.length = 0;
  failStart = false;
  setSchedulerDeps({
    now: () => NOW,
    readConcurrency: () => 2,
    runner: {
      start(run, task) {
        started.push(run.id);
        if (failStart) {
          finished.push({ runId: run.id, status: 'error' });
        }
      },
    },
  });
});
afterEach(() => {
  stopScheduler();
  closeDb();
  setDbFile(null);
});

function cronTask(name: string, expr: string, nextRunAt: number | null) {
  return createTask({
    name, prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
    scheduleType: 'cron', scheduleExpr: expr, runAt: null, nextRunAt,
  });
}

describe('tick：到期判定', () => {
  it('nextRunAt 为空 → 只计算落库，不触发', () => {
    const t = cronTask('A', '0 9 * * *', null);
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.nextRunAt).toBe(computeNextRun({ type: 'cron', expression: '0 9 * * *' }, NOW));
    expect(started).toHaveLength(0);
  });

  it('未到点 → 不触发', () => {
    cronTask('A', '0 9 * * *', NOW + 60_000);
    tick(NOW);
    expect(started).toHaveLength(0);
  });

  it('生效区间已过 → 自动停用并标 missed，不再每 tick 重算', () => {
    const t = createTask({
      name: 'A', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
      // 区间在 NOW 之前就结束了，computeNextRun 恒为 null
      scheduleStartAt: NOW - 20 * 86400_000, scheduleEndAt: NOW - 10 * 86400_000,
    });
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.enabled).toBe(0);
    expect(after.lastStatus).toBe('missed');
    expect(after.nextRunAt).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('生效区间还没开始 → 保持启用，下次运行排在区间内', () => {
    const t = createTask({
      name: 'A', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
      scheduleStartAt: NOW + 3 * 86400_000, scheduleEndAt: null,
    });
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.enabled).toBe(1);
    expect(after.nextRunAt).toBeGreaterThanOrEqual(NOW + 3 * 86400_000);
  });

  it('到点 → 建 queued run、推进 nextRunAt、启动执行', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    const before = listRuns(t.id, { limit: 10 }).length;
    tick(NOW);
    const runs = listRuns(t.id, { limit: 10 });
    expect(runs.length).toBe(before + 1);
    expect(started).toHaveLength(1);
    expect(getRun(started[0])!.trigger).toBe('scheduled');
    expect(getTask(t.id)!.nextRunAt).toBe(computeNextRun({ type: 'cron', expression: '0 9 * * *' }, NOW));
  });

  it('超过补跑窗口 → 跳过并重排下一次，不建 run', () => {
    const t = cronTask('A', '0 9 * * *', NOW - CATCH_UP_MS - 1);
    tick(NOW);
    expect(started).toHaveLength(0);
    expect(listRuns(t.id, { limit: 10 })).toHaveLength(0);
    expect(getTask(t.id)!.nextRunAt).toBeGreaterThan(NOW);
  });

  it('窗口边界内（正好 60 分钟）→ 补跑', () => {
    cronTask('A', '0 9 * * *', NOW - CATCH_UP_MS);
    tick(NOW);
    expect(started).toHaveLength(1);
  });

  it('once 超窗 → 标 missed 且 enabled=0，不建 run', () => {
    const t = createTask({
      name: 'once', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'once', scheduleExpr: null, runAt: NOW - CATCH_UP_MS - 1, nextRunAt: NOW - CATCH_UP_MS - 1,
    });
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.lastStatus).toBe('missed');
    expect(after.enabled).toBe(0);
    expect(after.nextRunAt).toBeNull();
    expect(listRuns(t.id, { limit: 10 })).toHaveLength(0);
  });

  it('停用任务不参与 tick', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    updateTask(t.id, { enabled: false });
    tick(NOW);
    expect(started).toHaveLength(0);
  });
});

describe('tick：单任务去重', () => {
  it('已有非终态 run 的任务本 tick 跳过，且不推进 nextRunAt', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    createRun(t.id, 'scheduled'); // 遗留 queued
    const before = getTask(t.id)!.nextRunAt;
    tick(NOW);
    expect(started).toHaveLength(0);
    expect(getTask(t.id)!.nextRunAt).toBe(before);
  });
});

describe('tick：并发与队列', () => {
  it('并发满了之后超出的任务留在队列，下一次 tick 继续启动', () => {
    const a = cronTask('A', '0 9 * * *', NOW);
    const b = cronTask('B', '0 9 * * *', NOW);
    const c = cronTask('C', '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(2);
    expect(schedulerSnapshot().queueLength).toBe(1);
    expect(listLiveRuns()).toHaveLength(3);
  });

  it('排队超 30 分钟仍未启动 → 标 skipped，不入队', () => {
    // 并发上限 1：A 占住，B 只能排队
    setSchedulerDeps({ readConcurrency: () => 1 });
    cronTask('A', '0 9 * * *', NOW);
    const b = cronTask('B', '0 9 * * *', NOW);
    tick(NOW);
    expect(schedulerSnapshot().queueLength).toBe(1);

    // 让 A 正常结束（并发空出），并把时钟推过排队上限，再 tick
    const runA = getRun(started[0])!;
    markRunRunning(runA.id);
    finishRun(runA.id, 'done');
    setSchedulerDeps({ now: () => NOW + QUEUE_TIMEOUT_MS + 60_000 });
    tick(NOW + QUEUE_TIMEOUT_MS + 60_000);

    const runs = listRuns(b.id, { limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].error).toContain('排队超过 30 分钟');
  });

  it('并发上限从设置读取（读到 1 时只启动 1 个）', () => {
    setSchedulerDeps({ readConcurrency: () => 1 });
    cronTask('A', '0 9 * * *', NOW);
    cronTask('B', '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(1);
  });

  it('readConcurrency 返回非法值时回退到 6', () => {
    setSchedulerDeps({ readConcurrency: () => 0 });
    for (let i = 0; i < 8; i += 1) cronTask(`T${i}`, '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(6);
  });
});

describe('启动恢复', () => {
  it('startScheduler 把遗留 queued run 重新入队并启动', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    createRun(t.id, 'scheduled'); // 崩溃时排队的
    startScheduler();
    expect(started).toHaveLength(1);
    stopScheduler();
  });

  it('startScheduler 把遗留 running run 标成 interrupted（无进程可救）', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    startScheduler();
    const got = getRun(r.id)!;
    expect(got.status).toBe('interrupted');
    expect(got.error).toBe('App 退出时仍在运行');
    stopScheduler();
  });
});

describe('runTaskNow', () => {
  it('建 manual run 并立即开始，不改变 nextRunAt', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    const before = getTask(t.id)!.nextRunAt;
    const runId = runTaskNow(t.id);
    expect(getRun(runId)!.trigger).toBe('manual');
    expect(started).toEqual([runId]);
    expect(getTask(t.id)!.nextRunAt).toBe(before);
  });

  it('任务不存在时抛错', () => {
    expect(() => runTaskNow('nope')).toThrow();
  });

  it('停用的任务也能手动执行', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    updateTask(t.id, { enabled: false });
    expect(() => runTaskNow(t.id)).not.toThrow();
    expect(started).toHaveLength(1);
  });
});
