// tests/main/tasks/db.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('run_events 主键 (run_id, seq) 约束生效', () => {
    setDbFile(tmpFile());
    const db = getDb();
    const ins = db.prepare('INSERT INTO run_events(run_id,seq,ts,type,subtype,payload) VALUES(?,?,?,?,?,?)');
    ins.run('r1', 0, 1, 'system', null, '{}');
    expect(() => ins.run('r1', 0, 1, 'system', null, '{}')).toThrow();
  });
});
