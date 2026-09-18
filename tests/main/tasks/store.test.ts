// tests/main/tasks/store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, getTask, listTasks, updateTask, deleteTask,
  setTaskSession, touchTaskAfterRun,
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
    const updated = updateTask(t.id, { name: '改名', nextRunAt: 999 });
    expect(updated.name).toBe('改名');
    expect(updated.nextRunAt).toBe(999);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
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
    expect(() => updateTask(t.id, {})).not.toThrow();
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
