// 30s 轮询 tick + 内存队列 + 并发闸门。状态只有 DB 一份真相，所以不用 per-task timer。
import { getStore } from '../store.js';
import {
  CATCH_UP_MS, QUEUE_TIMEOUT_MS, computeNextRun, isDue, type Schedule,
} from './schedule.js';
import {
  createRun, finishRun, getRun, getTask, listLiveRuns, listTasks, markRunRunning,
  recoverStaleRuns, updateTask, type RunRow, type TaskRow,
} from './store.js';
import * as runner from './runner.js';

export const TICK_INTERVAL_MS = 30_000;
export const DEFAULT_CONCURRENCY = 6;

export interface SchedulerDeps {
  now(): number;
  readConcurrency(): number;
  runner: { start(run: RunRow, task: TaskRow): void };
}

let deps: SchedulerDeps = {
  now: () => Date.now(),
  readConcurrency: () => {
    const raw = getStore('settings').get('tasks_max_concurrency');
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY;
  },
  // 惰性取 `runner.startRun`：测试会用 setSchedulerDeps 换掉整个 runner，绑太早会绕过注入。
  runner: { start: (run, task) => runner.startRun(run, task, runnerCallbacks) },
};

export function setSchedulerDeps(patch: Partial<SchedulerDeps>): void {
  deps = { ...deps, ...patch };
}

export type NotifyFn = (task: TaskRow, run: RunRow) => void;
let notify: NotifyFn | null = null;
export function setSchedulerNotify(fn: NotifyFn): void {
  notify = fn;
}

// ---- 事件推送（由 index.ts 注入实际实现，scheduler 不直接碰 IPC）----
export interface SchedulerCallbacks {
  onEvent(runId: string, events: unknown[]): void;
  onRunChanged(runId: string): void;
  onTasksChanged(): void;
}
let callbacks: SchedulerCallbacks = {
  onEvent: () => {},
  onRunChanged: () => {},
  onTasksChanged: () => {},
};
export function setSchedulerCallbacks(cb: SchedulerCallbacks): void {
  callbacks = cb;
}

/** 只在这三种终态通知（失败要看得见；成功不打扰）。 */
const NOTIFY_STATUSES = new Set(['error', 'timeout', 'interrupted']);

/** tick 会从 setInterval 与 runner 的 finish 回边进来，任何一步抛错都不能逃到事件循环。 */
function guard(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[tasks:scheduler] ${label} 失败:`, err);
  }
}

const runnerCallbacks = {
  onEvent: (runId: string, events: unknown[]) => callbacks.onEvent(runId, events),
  onFinish: (runId: string) => {
    guard(`run ${runId} 收尾`, () => {
      callbacks.onRunChanged(runId);
      callbacks.onTasksChanged();
      const run = getRun(runId);
      if (!run) return;
      const task = getTask(run.taskId);
      if (task && notify && NOTIFY_STATUSES.has(run.status)) notify(task, run);
    });
    // 独立 guard：通知回调炸了也要把队列放出去，否则排队的 run 要空等到下个 tick。
    guard('drain', () => drain());
  },
};

interface QueuedRun {
  runId: string;
  /** 入队时刻（取注入时钟）。不用 run.queuedAt —— 那是 store 用真实 Date.now() 写的。 */
  enqueuedAt: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let queue: QueuedRun[] = [];
let recovered = false;

function scheduleOf(task: TaskRow): Schedule {
  return task.scheduleType === 'once'
    ? { type: 'once', runAt: task.runAt ?? 0 }
    : { type: 'cron', expression: task.scheduleExpr ?? '' };
}

function activeCount(): number {
  return listLiveRuns().filter((r) => r.status === 'running').length;
}

function concurrency(): number {
  const n = deps.readConcurrency();
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY;
}

export function schedulerSnapshot(): { queueLength: number; activeCount: number } {
  return { queueLength: queue.length, activeCount: activeCount() };
}

/** 出队直到并发满；排队超时的不启动、直接标 skipped。 */
export function drain(): void {
  const now = deps.now();
  while (queue.length > 0 && activeCount() < concurrency()) {
    const { runId, enqueuedAt } = queue.shift()!;
    const run = getRun(runId);
    if (!run || run.status !== 'queued') continue;
    const task = getTask(run.taskId);
    if (!task) {
      finishRun(runId, 'error', { error: '任务已被删除' });
      callbacks.onRunChanged(runId);
      continue;
    }
    if (now - enqueuedAt > QUEUE_TIMEOUT_MS) {
      finishRun(runId, 'skipped', { error: '排队超过 30 分钟未启动' });
      callbacks.onRunChanged(runId);
      continue;
    }
    // 先落 running 再启动：并发闸门数的是 running，不写就会把整个队列一口气放出去。
    markRunRunning(runId);
    callbacks.onRunChanged(runId);
    // 重新取行：上面的 `run` 是 markRunRunning 之前的快照（status 仍是 queued、startedAt 为 null），
    // 直接传下去会让 runner 拿到陈旧数据。
    const running = getRun(runId) ?? run;
    try {
      deps.runner.start(running, task);
    } catch (err) {
      // 启动抛错时 run 已经是 running，不落终态会永久占住一个并发位。
      finishRun(runId, 'error', { error: `启动失败: ${String((err as Error)?.message ?? err)}` });
      callbacks.onRunChanged(runId);
    }
  }
}

export function enqueue(runId: string): void {
  queue.push({ runId, enqueuedAt: deps.now() });
  drain();
}

/** 启动时的一次性恢复：running → interrupted（进程已不在），queued → 重新入队。
 *  用 run 自己落库的 queuedAt 作入队戳，遗留 run 的排队超时按它自己的排队时刻判定。 */
function recoverStale(): void {
  if (recovered) return;
  const { requeued } = recoverStaleRuns();
  // 只有恢复成功才置位：中途抛错时下一次 tick 还要重试，否则一次启动期的 DB 故障
  // 就让遗留 running 永远占着并发位（activeCount 虚高），整个调度器静默停摆。
  recovered = true;
  for (const r of requeued) queue.push({ runId: r.id, enqueuedAt: r.queuedAt });
}

export function tick(now: number = deps.now()): void {
  const tasks = listTasks({ enabledOnly: true });
  const liveTaskIds = new Set(listLiveRuns().map((r) => r.taskId));
  let changed = false;

  for (const task of tasks) {
    const due = isDue(task.nextRunAt, now, CATCH_UP_MS);

    if (due === 'not_due' && task.nextRunAt == null) {
      const next = computeNextRun(scheduleOf(task), now);
      if (next != null) {
        updateTask(task.id, { nextRunAt: next });
        changed = true;
      }
      continue;
    }

    if (due === 'missed') {
      if (task.scheduleType === 'once') {
        updateTask(task.id, { nextRunAt: null, lastStatus: 'missed', enabled: false });
      } else {
        updateTask(task.id, { nextRunAt: computeNextRun(scheduleOf(task), now) });
      }
      changed = true;
      continue;
    }

    if (due !== 'due') continue;

    if (liveTaskIds.has(task.id)) continue; // 单任务去重：上次没跑完，本 tick 跳过且不推进时间

    const run = createRun(task.id, 'scheduled');
    if (task.scheduleType === 'once') {
      updateTask(task.id, { nextRunAt: null, enabled: false });
    } else {
      updateTask(task.id, { nextRunAt: computeNextRun(scheduleOf(task), now) });
    }
    changed = true;
    queue.push({ runId: run.id, enqueuedAt: now });
    callbacks.onRunChanged(run.id);
  }

  drain();
  if (changed) callbacks.onTasksChanged();
}

export function startScheduler(): void {
  if (timer) return;
  guard('启动恢复', () => recoverStale());
  guard('tick', () => tick());
  // 恢复失败时 recovered 还是 false，由后续 tick 重试（guard 保证回调本身不抛）。
  timer = setInterval(() => {
    guard('启动恢复', () => recoverStale());
    guard('tick', () => tick());
  }, TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  queue = [];
  recovered = false;
}

export function runTaskNow(taskId: string): string {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  const run = createRun(taskId, 'manual');
  callbacks.onRunChanged(run.id);
  queue.push({ runId: run.id, enqueuedAt: deps.now() });
  drain();
  return run.id;
}
