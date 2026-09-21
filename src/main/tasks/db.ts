// node:sqlite 的唯一接触点。实测 Electron 43.0.0 / Node 24.17.0 可用；
// 它是 experimental API，所有 sqlite 依赖都收敛在本文件，便于将来换 better-sqlite3。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

export const DEFAULT_DB_FILE = path.join(os.homedir(), '.lynel-desktop', 'tasks.db');

let dbFile: string | null = DEFAULT_DB_FILE;
let db: DatabaseSync | null = null;

/** 测试/外部切换数据库文件。传 null 关闭当前连接并置空路径。 */
export function setDbFile(file: string | null): void {
  closeDb();
  dbFile = file;
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* 已关闭 / 文件已删，忽略 */
    }
    db = null;
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  if (!dbFile) throw new Error('tasks db file 未设置');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const opened = new DatabaseSync(dbFile);
  opened.exec('PRAGMA journal_mode=WAL');
  opened.exec('PRAGMA foreign_keys=ON');
  migrate(opened);
  db = opened;
  return db;
}

/** 幂等加列：老库已有该列时是 no-op。`CREATE TABLE IF NOT EXISTS` 只对全新库生效，
 *  已经存在的表加字段必须走 ALTER，否则老用户的库永远缺这一列。 */
function addColumn(database: DatabaseSync, table: string, column: string, decl: string): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

export function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      agent TEXT,
      session_id TEXT,
      session_initialized INTEGER NOT NULL DEFAULT 0,
      schedule_type TEXT NOT NULL,
      schedule_expr TEXT,
      run_at INTEGER,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      session_id TEXT,
      resume_used INTEGER,
      exit_code INTEGER,
      is_error INTEGER,
      result_subtype TEXT,
      result_text TEXT,
      num_turns INTEGER,
      duration_ms INTEGER,
      total_cost_usd REAL,
      usage_json TEXT,
      error TEXT,
      event_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    )
  `);

  // v2：调度新增「生效区间」（可选的起止时间）。startAt / stopAt 交给 croner 的
  // startAt / stopAt 选项，不在 cron 表达式里表达（cron 本身没有日期边界的概念）。
  addColumn(database, 'tasks', 'schedule_start_at', 'INTEGER');
  addColumn(database, 'tasks', 'schedule_end_at', 'INTEGER');

  database.exec('CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, queued_at DESC)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_next ON tasks(next_run_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)');

  database
    .prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
    .run('schema_version', String(SCHEMA_VERSION));
}
