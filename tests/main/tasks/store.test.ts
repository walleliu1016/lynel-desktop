// tests/main/tasks/store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDbFile, closeDb, getDb } from '../../../src/main/tasks/db.js';
import {
  createTask, getTask, listTasks, updateTask, deleteTask,
  setTaskSession, touchTaskAfterRun,
  createRun, getRun, listRuns, listLiveRuns, markRunRunning,
  finishRun, appendEvent, listEventsRaw, recoverStaleRuns,
} from '../../../src/main/tasks/store.js';

vi.mock('electron', () => ({ safeStorage: {} }));

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-store-'));
  setDbFile(path.join(dir, 'tasks.db'));
});
afterEach(() => {
  closeDb();
  setDbFile(null);
});

const base = {
  name: '每日巡检',
  prompt: '检查 CI',
  sessionId: '11111111-1111-4111-8111-111111111111',
  scheduleType: 'cron' as const,
  scheduleExpr: '0 9 * * *',
  runAt: null,
  nextRunAt: 1_700_000_000_000,
};

describe('tasks CRUD', () => {
  it('createTask 落库并回读全部字段', () => {
    const t = createTask(base);
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.enabled).toBe(1);
    expect(t.scheduleType).toBe('cron');
    expect(t.scheduleExpr).toBe('0 9 * * *');
    expect(t.nextRunAt).toBe(1_700_000_000_000);
    expect(t.sessionInitialized).toBe(0);
    expect(getTask(t.id)?.name).toBe('每日巡检');
  });

  it('默认 enabled=1，agent 默认 claude', () => {
    const t = createTask(base);
    expect(t.enabled).toBe(1);
    expect(t.agent).toBe('claude');
  });

  it('getTask 不存在返回 null', () => {
    expect(getTask('nope')).toBeNull();
  });

  it('listTasks 默认按 enabled 优先、再按 next_run_at 升序，null 沉底', () => {
    const a = createTask({ ...base, name: 'A', nextRunAt: 300 });
    const b = createTask({ ...base, name: 'B', nextRunAt: 100 });
    const c = createTask({ ...base, name: 'C', nextRunAt: null });
    updateTask(a.id, { enabled: false });
    const ids = listTasks().map((t) => t.id);
    expect(ids).toEqual([b.id, c.id, a.id]);
  });

  it('listTasks({enabledOnly}) 过滤停用任务', () => {
    const a = createTask(base);
    const b = createTask({ ...base, name: '另一个' });
    updateTask(a.id, { enabled: false });
    expect(listTasks({ enabledOnly: true }).map((t) => t.id)).toEqual([b.id]);
  });

  it('updateTask 改字段并推进 updatedAt，返回新行', () => {
    const t = createTask(base);
    // 先把 updated_at 回拨到 0，否则 updatedAt 断言可能因同一毫秒内相等而失去区分度
    getDb().prepare('UPDATE tasks SET updated_at = 0 WHERE id = ?').run(t.id);
    const updated = updateTask(t.id, { name: '改名', nextRunAt: 999 });
    expect(updated.name).toBe('改名');
    expect(updated.nextRunAt).toBe(999);
    expect(updated.updatedAt).toBeGreaterThan(0);
    expect(getTask(t.id)!.updatedAt).toBe(updated.updatedAt);
  });

  it('updateTask 的 enabled 用 boolean 入参、落库为 0/1', () => {
    const t = createTask(base);
    expect(updateTask(t.id, { enabled: false }).enabled).toBe(0);
    expect(updateTask(t.id, { enabled: true }).enabled).toBe(1);
  });

  it('updateTask 不存在抛错', () => {
    expect(() => updateTask('nope', { name: 'x' })).toThrow();
  });

  it('updateTask 对空 patch 不报错、只推 updatedAt', () => {
    const t = createTask(base);
    getDb().prepare('UPDATE tasks SET updated_at = 0 WHERE id = ?').run(t.id);
    let updated: ReturnType<typeof updateTask>;
    expect(() => {
      updated = updateTask(t.id, {});
    }).not.toThrow();
    expect(updated!.updatedAt).toBeGreaterThan(0);
    // 空 patch 不得顺带改动其他字段
    expect(updated!.name).toBe(t.name);
    expect(updated!.nextRunAt).toBe(t.nextRunAt);
  });

  it('scheduleType 换成 once 时 scheduleExpr 置 null，反之亦然', () => {
    const t = createTask(base);
    const u = updateTask(t.id, { scheduleType: 'once', scheduleExpr: null, runAt: 500 });
    expect(u.scheduleType).toBe('once');
    expect(u.scheduleExpr).toBeNull();
    expect(u.runAt).toBe(500);
  });

  it('setTaskSession 更新 session id 与初始化标记', () => {
    const t = createTask(base);
    setTaskSession(t.id, '22222222-2222-4222-8222-222222222222', true);
    const row = getTask(t.id)!;
    expect(row.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(row.sessionInitialized).toBe(1);
  });

  it('touchTaskAfterRun 只写 last_run_at / last_status', () => {
    const t = createTask(base);
    touchTaskAfterRun(t.id, 12345, 'done');
    const row = getTask(t.id)!;
    expect(row.lastRunAt).toBe(12345);
    expect(row.lastStatus).toBe('done');
    expect(row.nextRunAt).toBe(1_700_000_000_000);
  });

  it('deleteTask 删除任务', () => {
    const t = createTask(base);
    deleteTask(t.id);
    expect(getTask(t.id)).toBeNull();
  });
});

describe('runs 与 run_events', () => {
  it('createRun 建 queued run，trigger 正确落库', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    expect(r.status).toBe('queued');
    expect(r.trigger).toBe('scheduled');
    expect(r.queuedAt).toBeGreaterThan(0);
    expect(r.startedAt).toBeNull();
    expect(r.eventCount).toBe(0);
  });

  it('markRunRunning 写 started_at 并切状态', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'manual');
    markRunRunning(r.id);
    const got = getRun(r.id)!;
    expect(got.status).toBe('running');
    expect(got.startedAt).toBeGreaterThan(0);
  });

  it('finishRun 写终态与 result 字段', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    finishRun(r.id, 'done', {
      resultSubtype: 'success',
      resultText: '搞定了',
      numTurns: 3,
      durationMs: 1200,
      totalCostUsd: 0.0123,
      usageJson: '{"input_tokens":10}',
      exitCode: 0,
      isError: 0,
    });
    const got = getRun(r.id)!;
    expect(got.status).toBe('done');
    expect(got.finishedAt).toBeGreaterThan(0);
    expect(got.resultText).toBe('搞定了');
    expect(got.numTurns).toBe(3);
    expect(got.totalCostUsd).toBeCloseTo(0.0123);
  });

  it('listRuns 按 queued_at 倒序分页，before 做游标', () => {
    const t = createTask(base);
    const r1 = createRun(t.id, 'scheduled');
    const r2 = createRun(t.id, 'scheduled');
    const r3 = createRun(t.id, 'scheduled');
    const page1 = listRuns(t.id, { limit: 2 });
    expect(page1.map((r) => r.id)).toEqual([r3.id, r2.id]);
    const page2 = listRuns(t.id, { limit: 2, before: page1[1].queuedAt });
    expect(page2.map((r) => r.id)).toEqual([r1.id]);
  });

  it('listRuns 只返回该任务的 run', () => {
    const t1 = createTask(base);
    const t2 = createTask({ ...base, name: '另一个' });
    createRun(t1.id, 'scheduled');
    createRun(t2.id, 'scheduled');
    expect(listRuns(t1.id, { limit: 10 })).toHaveLength(1);
  });

  it('appendEvent 逐行落库并可增量读取', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    appendEvent(r.id, 0, 'system', 'init', '{"a":1}');
    appendEvent(r.id, 1, 'assistant', null, '{"b":2}');
    const all = listEventsRaw(r.id);
    expect(all.map((e) => e.seq)).toEqual([0, 1]);
    expect(all[0].payload).toBe('{"a":1}');
    expect(listEventsRaw(r.id, 0).map((e) => e.seq)).toEqual([1]);
    expect(listEventsRaw(r.id, 1)).toHaveLength(0);
  });

  it('appendEvent 同步递增 runs.event_count', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    appendEvent(r.id, 0, 'stderr', null, 'x');
    appendEvent(r.id, 1, 'stderr', null, 'y');
    expect(getRun(r.id)!.eventCount).toBe(2);
  });

  it('listLiveRuns 只返回非终态', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    const b = createRun(t.id, 'scheduled');
    const c = createRun(t.id, 'scheduled');
    markRunRunning(a.id);
    finishRun(b.id, 'done');
    expect(listLiveRuns().map((r) => r.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('recoverStaleRuns: running 标 interrupted，queued 原样返回待重新入队', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    const b = createRun(t.id, 'scheduled');
    markRunRunning(a.id);
    const res = recoverStaleRuns();
    expect(res.interrupted.map((r) => r.id)).toEqual([a.id]);
    expect(res.requeued.map((r) => r.id)).toEqual([b.id]);
    expect(getRun(a.id)!.status).toBe('interrupted');
    expect(getRun(a.id)!.error).toBe('App 退出时仍在运行');
    expect(getRun(b.id)!.status).toBe('queued');
  });

  it('recoverStaleRuns 不动终态 run', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    finishRun(a.id, 'done');
    const res = recoverStaleRuns();
    expect(res.interrupted).toHaveLength(0);
    expect(res.requeued).toHaveLength(0);
    expect(getRun(a.id)!.status).toBe('done');
  });

  it('recoverStaleRuns 幂等：二次调用不再动已 interrupted 的 run', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    markRunRunning(a.id);
    const first = recoverStaleRuns();
    expect(first.interrupted.map((r) => r.id)).toEqual([a.id]);
    const finishedAt = getRun(a.id)!.finishedAt;
    const second = recoverStaleRuns();
    expect(second.interrupted).toHaveLength(0);
    expect(second.requeued).toHaveLength(0);
    expect(getRun(a.id)!.finishedAt).toBe(finishedAt);
  });
});
