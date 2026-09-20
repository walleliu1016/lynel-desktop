// src/main/tasks/index.ts
// 定时任务的对外入口：注册 IPC、接上事件推送、启动/停止调度器。
import { ipcMain, type BrowserWindow } from 'electron';
import { windowAttention } from '../attention.js';
import { getLogger } from '../log.js';
import { ensureTasksDir, tasksDir } from './paths.js';
import { closeDb, getDb } from './db.js';
import { computeNextRun, describeSchedule, type Schedule } from './schedule.js';
import { parseStreamLine } from './streamParse.js';
import * as scheduler from './scheduler.js';
import * as runner from './runner.js';
import {
  createTask, deleteTask, getRun, getTask, listEventsRaw, listRuns, listTasks,
  updateTask, type RunRow, type TaskRow,
} from './store.js';
import { randomUUID } from 'node:crypto';
import { setExcludedProjects } from '../jsonl.js';
import { getStore } from '../store.js';
import { agentSpec } from '../agents/index.js';

let win: (() => BrowserWindow | null) | null = null;

function send(channel: string, payload: unknown): void {
  const w = win?.();
  if (!w || w.isDestroyed()) return;
  w.webContents.send(channel, payload);
}

function toTaskDto(task: TaskRow) {
  const schedule: Schedule = task.scheduleType === 'once'
    ? { type: 'once', runAt: task.runAt ?? 0 }
    : { type: 'cron', expression: task.scheduleExpr ?? '' };
  return {
    ...task,
    enabled: task.enabled === 1,
    sessionInitialized: task.sessionInitialized === 1,
    schedule: describeSchedule(schedule),
    scheduleRaw: schedule,
  };
}

function toRunDto(run: RunRow) {
  return { ...run };
}

function normalizeEvents(runId: string, afterSeq: number) {
  return listEventsRaw(runId, afterSeq).map((row) => ({
    seq: row.seq,
    ts: row.ts,
    event: parseStreamLine(row.payload) ?? { type: row.type as 'stderr', text: row.payload, subtype: row.subtype ?? undefined },
  }));
}

/** claude 可执行文件路径。与 app.ts 创建会话时同一套约定：读设置里的 `claude_path`，留空回退 spec.command。
 *  每次调用都重新读设置 —— 用户改完设置不必重启应用。 */
function resolveClaudeBin(): string {
  const spec = agentSpec('claude');
  try {
    const configured = getStore('settings').get('claude_path', '');
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
  } catch {
    /* 设置读不到就回退 spec.command */
  }
  return spec.command;
}

export function initTasks(getMainWindow: () => BrowserWindow | null): void {
  win = getMainWindow;
  const logger = getLogger();

  // 1. 建目录 + 落初始 CLAUDE.md
  try {
    ensureTasksDir();
  } catch (err) {
    logger.error(`[tasks] 建任务目录失败: ${String((err as Error)?.message ?? err)}`);
  }

  // 2. 会话扫描排除 —— 必须在任何会话扫描之前执行
  try {
    setExcludedProjects([tasksDir()]);
  } catch (err) {
    logger.error(`[tasks] 设置会话扫描排除失败: ${String((err as Error)?.message ?? err)}`);
  }

  // 3. 开库（触发 migration）
  try {
    getDb();
  } catch (err) {
    logger.error(`[tasks] 打开任务数据库失败，定时任务不可用: ${String((err as Error)?.message ?? err)}`);
    return;
  }

  try {
    scheduler.setSchedulerCallbacks({
      onEvent: (runId, events) => send('tasks:runEvent', { runId, events }),
      onRunChanged: (runId) => {
        const run = getRun(runId);
        if (run) send('tasks:runChanged', toRunDto(run));
      },
      onTasksChanged: () => send('tasks:changed', listTasks().map(toTaskDto)),
    });

    // 失败通知：只在 error / timeout / interrupted 时打扰用户
    scheduler.setSchedulerNotify((task, run) => {
      const reason = run.error || run.resultSubtype || run.status;
      try {
        windowAttention.notifyTaskFailure(task.name, `任务失败：${reason}`);
      } catch (err) {
        logger.warn('[tasks] 失败通知发送失败:', err);
      }
    });

    // 执行器的 claude 路径来自设置，不接的话生产环境会拿裸 `claude` 去 spawn
    runner.setRunnerDeps({ claudeBin: resolveClaudeBin });

    // 启动调度器必须放在上面三个注入之后：startScheduler 里要跑一次启动恢复
    // （running → interrupted、queued → 重新入队），恢复过程中会回调上面的 callbacks。
    scheduler.startScheduler();
  } catch (err) {
    logger.error(`[tasks] 启动调度器失败，定时任务不可用: ${String((err as Error)?.message ?? err)}`);
  }

  // ---- IPC ----
  ipcMain.handle('tasks:list', () => listTasks().map(toTaskDto));

  ipcMain.handle('tasks:get', (_e, id: string) => {
    const t = getTask(id);
    return t ? toTaskDto(t) : null;
  });

  ipcMain.handle('tasks:create', (_e, input: {
    name: string; prompt: string; schedule: Schedule;
  }) => {
    const sessionId = randomUUID();
    const nextRunAt = computeNextRun(input.schedule, Date.now());
    const task = createTask({
      name: input.name.trim(),
      prompt: input.prompt,
      sessionId,
      scheduleType: input.schedule.type,
      scheduleExpr: input.schedule.type === 'cron' ? input.schedule.expression : null,
      runAt: input.schedule.type === 'once' ? input.schedule.runAt : null,
      nextRunAt,
    });
    send('tasks:changed', listTasks().map(toTaskDto));
    return toTaskDto(task);
  });

  ipcMain.handle('tasks:update', (_e, id: string, patch: {
    name?: string; prompt?: string; schedule?: Schedule; enabled?: boolean;
  }) => {
    const before = getTask(id);
    if (!before) throw new Error(`任务不存在: ${id}`);

    const fields: Parameters<typeof updateTask>[1] = {};
    if (patch.name !== undefined) fields.name = patch.name.trim();
    if (patch.prompt !== undefined) fields.prompt = patch.prompt;
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (patch.schedule) {
      const s = patch.schedule;
      const changedKind = s.type !== before.scheduleType;
      fields.scheduleType = s.type;
      fields.scheduleExpr = s.type === 'cron' ? s.expression : null;
      fields.runAt = s.type === 'once' ? s.runAt : null;
      fields.nextRunAt = computeNextRun(s, Date.now());
      // once → cron 时把 enabled 恢复，否则「一次性跑完自停」的语义会让人以为坏了
      if (changedKind && s.type === 'cron') fields.enabled = true;
    }
    const updated = updateTask(id, fields);
    send('tasks:changed', listTasks().map(toTaskDto));
    return toTaskDto(updated);
  });

  ipcMain.handle('tasks:delete', (_e, id: string) => {
    // 先杀掉该任务在跑的 run，再删行：deleteTask 会连带删掉 runs / run_events，
    // 但进程不懂数据库 —— 留着就成了 UI 永远看不见、也取消不了的 claude 进程
    // （appendEvent 还会继续往已删除的 run_id 里写，无外键 → 永久孤儿行）。
    try {
      const n = runner.cancelTaskRuns(id);
      if (n > 0) logger.warn(`[tasks] 删除任务 ${id} 前取消了 ${n} 个在跑的 run`);
    } catch (err) {
      logger.warn(`[tasks] 取消在跑的 run 失败，继续删除: ${String((err as Error)?.message ?? err)}`);
    }
    deleteTask(id);
    send('tasks:changed', listTasks().map(toTaskDto));
  });

  ipcMain.handle('tasks:setEnabled', (_e, id: string, enabled: boolean) => {
    const task = getTask(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    // 重新启用且没有下次运行时间时补算一个，否则任务永远不会触发
    const patch: Parameters<typeof updateTask>[1] = { enabled };
    if (enabled && task.nextRunAt == null) {
      const s: Schedule = task.scheduleType === 'once'
        ? { type: 'once', runAt: task.runAt ?? 0 }
        : { type: 'cron', expression: task.scheduleExpr ?? '' };
      patch.nextRunAt = computeNextRun(s, Date.now());
    }
    updateTask(id, patch);
    send('tasks:changed', listTasks().map(toTaskDto));
  });

  // runTaskNow 对未知 id 会抛 —— 不吞掉，让 invoke 直接 reject，渲染层能展示原因。
  // 该 task 已有非终态 run 时不新建、直接返回那个 run 的 id（去重口径见 scheduler.runTaskNow）。
  ipcMain.handle('tasks:runNow', (_e, id: string) => scheduler.runTaskNow(id));

  ipcMain.handle('tasks:cancel', (_e, runId: string) => runner.cancelRun(runId));

  ipcMain.handle('tasks:runs', (_e, taskId: string, opts: { limit: number; before?: number }) =>
    listRuns(taskId, opts).map(toRunDto));

  ipcMain.handle('tasks:run', (_e, runId: string) => {
    const r = getRun(runId);
    return r ? toRunDto(r) : null;
  });

  ipcMain.handle('tasks:runEvents', (_e, runId: string, opts: { afterSeq?: number } = {}) =>
    normalizeEvents(runId, opts.afterSeq ?? -1));

  ipcMain.handle('tasks:preview', (_e, schedule: Schedule) => {
    const out: number[] = [];
    let cursor = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const next = computeNextRun(schedule, cursor);
      if (next == null) break;
      out.push(next);
      cursor = next;
    }
    return { nextRuns: out };
  });
}

export async function tasksShutdown(): Promise<void> {
  scheduler.stopScheduler();
  await runner.killAllRuns();
  closeDb();
}
