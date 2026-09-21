// src/main/tasks/index.ts
// 定时任务的对外入口：注册 IPC、接上事件推送、启动/停止调度器。
import { ipcMain, type BrowserWindow } from 'electron';
import { windowAttention } from '../attention.js';
import { getLogger } from '../log.js';
import { ensureTasksDir, tasksDir } from './paths.js';
import { closeDb, getDb } from './db.js';
import {
  computeNextRun, describeSchedule, scheduleOf, scheduleToCron, type Schedule,
} from './schedule.js';
import { parseStreamLine } from './streamParse.js';
import * as scheduler from './scheduler.js';
import { deleteTemplate, listTemplates, saveTemplate, type TaskTemplate } from './templates.js';
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

/** 模块级 logger：notifyTaskFinished 在 initTasks 之外，拿不到那里的局部 logger */
const log = getLogger().scope('tasks');

/** 一次运行结束的对外载荷（托盘/系统通知、渲染层 toast、企业微信推送共用同一份）。 */
export interface TaskResultPayload {
  taskId: string;
  runId: string;
  taskName: string;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  /** 结果**摘要**（一行、截断）：给 toast / 托盘气泡这类位置有限的地方用 */
  text: string;
  /** 结果**全文**：给企业微信这类能放完整内容的出口用。
   *  只发摘要的话，手机上和桌面看到的不是一回事（用户报过这个）。 */
  resultText: string;
}

let resultSink: ((p: TaskResultPayload) => void) | null = null;

/**
 * 任务结果的**对外投递**钩子（目前是企业微信推送）。由 app.ts 注入 —— 任务模块不认识
 * 通道，通道也不认识任务，接线放在组装处。未注入时只走桌面内的提示。
 */
export function setTaskResultSink(fn: ((p: TaskResultPayload) => void) | null): void {
  resultSink = fn;
}

function send(channel: string, payload: unknown): void {
  const w = win?.();
  if (!w || w.isDestroyed()) return;
  w.webContents.send(channel, payload);
}

function toTaskDto(task: TaskRow) {
  const schedule = scheduleOf(task);
  return {
    ...task,
    enabled: task.enabled === 1,
    sessionInitialized: task.sessionInitialized === 1,
    schedule: describeSchedule(schedule),
    scheduleRaw: schedule,
  };
}

/** 落库的 schedule_type 只有两态（cron / once）；「每天 / 按间隔 / 自定义」的区别在表达式与
 *  生效区间里，不需要为它们扩枚举（扩了就得给老库做数据迁移）。 */
function dbScheduleType(s: Schedule): 'cron' | 'once' {
  return s.type === 'once' ? 'once' : 'cron';
}

/** Schedule → 落库字段。cron 构造失败（表达式非法）时抛错，由 IPC 拒绝，不写脏数据。 */
function scheduleFields(s: Schedule) {
  return {
    scheduleType: dbScheduleType(s),
    scheduleExpr: scheduleToCron(s),
    runAt: s.type === 'once' ? s.runAt : null,
    scheduleStartAt: s.type === 'once' ? null : s.startAt,
    scheduleEndAt: s.type === 'once' ? null : s.endAt,
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

/** 终态 → 人读文案。与渲染层 toast 的口径保持一致（两边各展示一处，不共用样式）。 */
/** 完整结果：优先 result_text，没有就退回 error，再没有才用摘要。 */
function fullResultText(run: RunRow): string {
  const r = (run.resultText ?? '').trim();
  if (r) return r;
  return (run.error ?? '').trim() || outcomeText(run);
}

function outcomeText(run: RunRow): string {
  const first = (run.resultText ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  switch (run.status) {
    case 'done': return first ? first.slice(0, 120) : '执行完成';
    case 'error': return run.error ?? (first ? first.slice(0, 120) : '执行失败');
    case 'timeout': return run.error ?? '超过 30 分钟上限，已终止';
    case 'interrupted': return run.error ?? '已中断';
    case 'skipped': return run.error ?? '排队超时未启动';
    default: return run.status;
  }
}

/**
 * 任务跑完的提示。**分流点只有这里** —— 两边都弹会重复：
 *   前台（窗口可见 + 未最小化 + 有焦点）→ 发 IPC，渲染层弹右上角 toast（含任务名 / 时间 / 结果）
 *   后台（最小化 / 被遮挡 / 隐藏到托盘）→ 托盘气泡（win32）或系统通知
 */
function notifyTaskFinished(task: TaskRow, run: RunRow): void {
  const payload: TaskResultPayload = {
    taskId: task.id,
    runId: run.id,
    taskName: task.name,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    text: outcomeText(run),
    resultText: fullResultText(run),
  };
  // 对外投递独立于「前台/后台」那条分流：企微推送是另一个通道，
  // 不该因为窗口恰好在前台就被吞掉（反之亦然）。
  try {
    resultSink?.(payload);
  } catch (err) {
    log.warn('结果对外投递失败:', err);
  }

  if (windowAttention.isForeground()) {
    send('tasks:finished', payload);
    return;
  }
  const label = run.status === 'done' ? '任务完成' : '任务未成功';
  windowAttention.showTaskPopup(`${task.name} · ${label}`, payload.text, () => {
    windowAttention.focusMainWindow();
    send('tasks:open', { taskId: task.id, runId: run.id });
  });
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

    // 任务跑完的提示，按「窗口在不在前台」分流（见 notifyTaskFinished）
    scheduler.setSchedulerNotify((task, run) => {
      try {
        notifyTaskFinished(task, run);
      } catch (err) {
        logger.warn('[tasks] 任务结果通知发送失败:', err);
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
    const fields = scheduleFields(input.schedule);
    const task = createTask({
      name: input.name.trim(),
      prompt: input.prompt,
      sessionId,
      ...fields,
      nextRunAt: computeNextRun(input.schedule, Date.now()),
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
      const changedKind = dbScheduleType(s) !== before.scheduleType;
      Object.assign(fields, scheduleFields(s));
      fields.nextRunAt = computeNextRun(s, Date.now());
      // once → cron 时把 enabled 恢复，否则「一次性跑完自停」的语义会让人以为坏了
      if (changedKind && s.type !== 'once') fields.enabled = true;
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
      patch.nextRunAt = computeNextRun(scheduleOf(task), Date.now());
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

  // 预览同时回人读摘要：渲染层就不必再实现一份「预设 ↔ cron」的模板逻辑。
  // 那一份历史上已经漂移过（表单认成「每周」而主进程认成「自定义」），能删就删。
  ipcMain.handle('tasks:preview', (_e, schedule: Schedule) => {
    const out: number[] = [];
    let cursor = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const next = computeNextRun(schedule, cursor);
      if (next == null) break;
      out.push(next);
      cursor = next;
    }
    let error: string | null = null;
    try {
      scheduleToCron(schedule);
    } catch (err) {
      error = String((err as Error)?.message ?? err);
    }
    return { nextRuns: out, summary: describeSchedule(schedule), error };
  });

  // ---- 用户模板 ----
  ipcMain.handle('tasks:templates', () => listTemplates());
  ipcMain.handle('tasks:saveTemplate', (_e, input: Omit<TaskTemplate, 'id' | 'createdAt'>) =>
    saveTemplate(input));
  ipcMain.handle('tasks:deleteTemplate', (_e, id: string) => deleteTemplate(id));
}

export async function tasksShutdown(): Promise<void> {
  scheduler.stopScheduler();
  await runner.killAllRuns();
  closeDb();
}
