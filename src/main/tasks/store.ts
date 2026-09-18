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
