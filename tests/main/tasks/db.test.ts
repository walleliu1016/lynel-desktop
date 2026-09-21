// tests/main/tasks/db.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, closeDb, setDbFile, migrate, SCHEMA_VERSION } from '../../../src/main/tasks/db.js';

vi.mock('electron', () => ({ safeStorage: {} }));

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-db-'));
  return path.join(dir, 'tasks.db');
}

afterEach(() => {
  closeDb();
  setDbFile(null);
});

describe('db', () => {
  it('创建三张表 + meta 表，并写入 schema 版本', () => {
    setDbFile(tmpFile());
    const db = getDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['meta', 'run_events', 'runs', 'tasks']));
    const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('开启 WAL 模式', () => {
    setDbFile(tmpFile());
    const row = getDb().prepare('PRAGMA journal_mode').get() as any;
    expect(String(row.journal_mode).toLowerCase()).toBe('wal');
  });

  it('同一个文件重复 getDb 返回同一实例', () => {
    setDbFile(tmpFile());
    expect(getDb()).toBe(getDb());
  });

  it('migrate 幂等：跑两次不报错、版本不变', () => {
    setDbFile(tmpFile());
    const db = getDb();
    migrate(db);
    migrate(db);
    const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('closeDb 之后 getDb 能重新打开同一文件且数据还在', () => {
    const f = tmpFile();
    setDbFile(f);
    getDb().prepare("INSERT INTO tasks(id,name,enabled,prompt,agent,session_id,session_initialized,schedule_type,schedule_expr,run_at,next_run_at,last_run_at,last_status,created_at,updated_at) VALUES('t1','n',1,'p',NULL,NULL,0,'cron','0 9 * * *',NULL,NULL,NULL,NULL,1,1)").run();
    closeDb();
    const rows = getDb().prepare('SELECT id FROM tasks').all();
    expect(rows).toHaveLength(1);
  });

  it('v1 老库升级：补出生效区间两列，且老行数据不丢', () => {
    const f = tmpFile();
    setDbFile(f);
    // 先造一个 v1 形状的库（只有旧列），再走 migrate —— CREATE TABLE IF NOT EXISTS 不会加列，
    // 必须靠 ALTER 补，否则老用户升级后一读 schedule_start_at 就报 no such column。
    const raw = new DatabaseSync(f);
    raw.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL, agent TEXT, session_id TEXT,
      session_initialized INTEGER NOT NULL DEFAULT 0, schedule_type TEXT NOT NULL,
      schedule_expr TEXT, run_at INTEGER, next_run_at INTEGER, last_run_at INTEGER,
      last_status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    raw.prepare("INSERT INTO tasks(id,name,prompt,schedule_type,schedule_expr,created_at,updated_at) VALUES('old','老任务','p','cron','0 9 * * *',1,1)").run();
    raw.close();

    const db = getDb();
    const cols = (db.prepare('PRAGMA table_info(tasks)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('schedule_start_at');
    expect(cols).toContain('schedule_end_at');
    const old = db.prepare("SELECT name, schedule_expr, schedule_start_at FROM tasks WHERE id='old'").get() as any;
    expect(old.name).toBe('老任务');
    expect(old.schedule_expr).toBe('0 9 * * *');
    expect(old.schedule_start_at).toBeNull();
  });

  it('run_events 主键 (run_id, seq) 约束生效', () => {
    setDbFile(tmpFile());
    const db = getDb();
    const ins = db.prepare('INSERT INTO run_events(run_id,seq,ts,type,subtype,payload) VALUES(?,?,?,?,?,?)');
    ins.run('r1', 0, 1, 'system', null, '{}');
    expect(() => ins.run('r1', 0, 1, 'system', null, '{}')).toThrow();
  });
});
