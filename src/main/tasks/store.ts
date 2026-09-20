// 三表 CRUD 与状态机。只碰 DB，不含调度/执行逻辑。
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

export type ScheduleType = 'cron' | 'once';
export type RunStatus =
  | 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'skipped' | 'interrupted';

export interface TaskRow {
  id: string;
  name: string;
  enabled: number;
  prompt: string;
  agent: string | null;
  sessionId: string | null;
  sessionInitialized: number;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskPatch = Partial<{
  name: string;
  prompt: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
}>;

export interface CreateTaskInput {
  name: string;
  prompt: string;
  sessionId: string;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  enabled?: boolean;
  agent?: string;
}

const TASK_COLUMNS = `
  id, name, enabled, prompt, agent, session_id AS sessionId,
  session_initialized AS sessionInitialized,
  schedule_type AS scheduleType, schedule_expr AS scheduleExpr, run_at AS runAt,
  next_run_at AS nextRunAt, last_run_at AS lastRunAt, last_status AS lastStatus,
  created_at AS createdAt, updated_at AS updatedAt
`;

function row(r: unknown): TaskRow | null {
  return (r as TaskRow | undefined) ?? null;
}

export function createTask(input: CreateTaskInput): TaskRow {
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO tasks
       (id,name,enabled,prompt,agent,session_id,session_initialized,
        schedule_type,schedule_expr,run_at,next_run_at,last_run_at,last_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
    )
    .run(
      id,
      input.name,
      input.enabled === false ? 0 : 1,
      input.prompt,
      input.agent ?? 'claude',
      input.sessionId,
      0,
      input.scheduleType,
      input.scheduleExpr,
      input.runAt,
      input.nextRunAt,
      now,
      now,
    );
  return getTask(id)!;
}

export function getTask(id: string): TaskRow | null {
  return row(getDb().prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id));
}

export function listTasks(opts: { enabledOnly?: boolean } = {}): TaskRow[] {
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : '';
  return getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks ${where}
       ORDER BY enabled DESC, next_run_at IS NULL, next_run_at ASC, created_at ASC`,
    )
    .all() as unknown as TaskRow[];
}

const PATCH_COLUMN: Record<keyof TaskPatch, string> = {
  name: 'name',
  prompt: 'prompt',
  enabled: 'enabled',
  scheduleType: 'schedule_type',
  scheduleExpr: 'schedule_expr',
  runAt: 'run_at',
  nextRunAt: 'next_run_at',
  lastRunAt: 'last_run_at',
  lastStatus: 'last_status',
};

export function updateTask(id: string, patch: TaskPatch): TaskRow {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(PATCH_COLUMN) as [keyof TaskPatch, string][]) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    sets.push(`${column} = ?`);
    values.push(typeof raw === 'boolean' ? (raw ? 1 : 0) : raw);
  }
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  const info = getDb()
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  if (Number(info.changes) === 0) throw new Error(`task 不存在: ${id}`);
  return getTask(id)!;
}

export function deleteTask(id: string): void {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function setTaskSession(id: string, sessionId: string, initialized: boolean): void {
  getDb()
    .prepare('UPDATE tasks SET session_id = ?, session_initialized = ?, updated_at = ? WHERE id = ?')
    .run(sessionId, initialized ? 1 : 0, Date.now(), id);
}

export function touchTaskAfterRun(id: string, at: number, status: string): void {
  getDb()
    .prepare('UPDATE tasks SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?')
    .run(at, status, Date.now(), id);
}

// ===== runs 与 run_events =====

export interface RunRow {
  id: string;
  taskId: string;
  trigger: string;
  status: RunStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  sessionId: string | null;
  resumeUsed: number | null;
  exitCode: number | null;
  isError: number | null;
  resultSubtype: string | null;
  resultText: string | null;
  numTurns: number | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  usageJson: string | null;
  error: string | null;
  eventCount: number;
}

export interface RawEventRow {
  runId: string;
  seq: number;
  ts: number;
  type: string;
  subtype: string | null;
  payload: string;
}

export interface FinishRunPatch {
  sessionId?: string | null;
  resumeUsed?: number | null;
  exitCode?: number | null;
  isError?: number | null;
  resultSubtype?: string | null;
  resultText?: string | null;
  numTurns?: number | null;
  durationMs?: number | null;
  totalCostUsd?: number | null;
  usageJson?: string | null;
  error?: string | null;
}

const RUN_COLUMNS = `
  id, task_id AS taskId, trigger, status, queued_at AS queuedAt,
  started_at AS startedAt, finished_at AS finishedAt, session_id AS sessionId,
  resume_used AS resumeUsed, exit_code AS exitCode, is_error AS isError,
  result_subtype AS resultSubtype, result_text AS resultText, num_turns AS numTurns,
  duration_ms AS durationMs, total_cost_usd AS totalCostUsd, usage_json AS usageJson,
  error, event_count AS eventCount
`;

const LIVE_STATUSES = `('queued','running')`;

export function createRun(taskId: string, trigger: 'scheduled' | 'manual'): RunRow {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO runs(id, task_id, trigger, status, queued_at, event_count) VALUES(?,?,?,?,?,0)')
    .run(id, taskId, trigger, 'queued', now);
  return getRun(id)!;
}

export function getRun(id: string): RunRow | null {
  return row(getDb().prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id)) as RunRow | null;
}

export function listRuns(taskId: string, opts: { limit: number; before?: number }): RunRow[] {
  const before = opts.before;
  const sql = before
    ? `SELECT ${RUN_COLUMNS} FROM runs WHERE task_id = ? AND queued_at < ? ORDER BY queued_at DESC LIMIT ?`
    : `SELECT ${RUN_COLUMNS} FROM runs WHERE task_id = ? ORDER BY queued_at DESC LIMIT ?`;
  const args = before ? [taskId, before, opts.limit] : [taskId, opts.limit];
  return getDb().prepare(sql).all(...(args as never[])) as unknown as RunRow[];
}

export function listLiveRuns(): RunRow[] {
  return getDb()
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status IN ${LIVE_STATUSES} ORDER BY queued_at ASC`)
    .all() as unknown as RunRow[];
}

export function markRunRunning(id: string): void {
  getDb().prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?').run('running', Date.now(), id);
}

const FINISH_COLUMN: Record<keyof FinishRunPatch, string> = {
  sessionId: 'session_id', resumeUsed: 'resume_used', exitCode: 'exit_code',
  isError: 'is_error', resultSubtype: 'result_subtype', resultText: 'result_text',
  numTurns: 'num_turns', durationMs: 'duration_ms', totalCostUsd: 'total_cost_usd',
  usageJson: 'usage_json', error: 'error',
};

export function finishRun(id: string, status: RunStatus, patch: FinishRunPatch = {}): void {
  const sets = ['status = ?', 'finished_at = ?'];
  const values: unknown[] = [status, Date.now()];
  for (const [key, column] of Object.entries(FINISH_COLUMN) as [keyof FinishRunPatch, string][]) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    values.push(patch[key] ?? null);
  }
  values.push(id);
  getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]));
}

export function appendEvent(
  runId: string,
  seq: number,
  type: string,
  subtype: string | null,
  payload: string,
): void {
  const db = getDb();
  db.prepare('INSERT INTO run_events(run_id,seq,ts,type,subtype,payload) VALUES(?,?,?,?,?,?)').run(
    runId, seq, Date.now(), type, subtype, payload,
  );
  db.prepare('UPDATE runs SET event_count = event_count + 1 WHERE id = ?').run(runId);
}

export function listEventsRaw(runId: string, afterSeq = -1): RawEventRow[] {
  return getDb()
    .prepare(
      `SELECT run_id AS runId, seq, ts, type, subtype, payload
       FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(runId, afterSeq) as unknown as RawEventRow[];
}

/** 启动时调用一次：running 的 run 无进程可救 → 标 interrupted；
 *  queued 的 run 尚未启动 → 原样返回，由 scheduler 重新入队（不能凭空丢弃）。 */
export function recoverStaleRuns(): { interrupted: RunRow[]; requeued: RunRow[] } {
  const db = getDb();
  const running = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'running'`).all() as unknown as RunRow[];
  for (const r of running) {
    db.prepare('UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?').run(
      'interrupted', Date.now(), 'App 退出时仍在运行', r.id,
    );
  }
  const requeued = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'queued' ORDER BY queued_at ASC`).all() as unknown as RunRow[];
  return { interrupted: running, requeued };
}
