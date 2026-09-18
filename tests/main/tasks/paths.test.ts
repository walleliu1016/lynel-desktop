// tests/main/tasks/paths.test.ts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTasksDir, ensureTasksDir, DEFAULT_TASKS_DIR } from '../../../src/main/tasks/paths.js';

vi.mock('electron', () => ({ safeStorage: {} }));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-'));
}

describe('resolveTasksDir', () => {
  it('空值 / 非字符串 / 纯空白都回退到默认目录', () => {
    expect(resolveTasksDir(undefined)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir(null)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir(123)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir('')).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir('   ')).toBe(DEFAULT_TASKS_DIR);
  });

  it('接受合法字符串并去掉首尾空白', () => {
    expect(resolveTasksDir('  /tmp/x  ')).toBe('/tmp/x');
  });
});

describe('ensureTasksDir', () => {
  it('创建目录并写入初始 CLAUDE.md', () => {
    const dir = path.join(tmpDir(), 'tasks');
    expect(fs.existsSync(dir)).toBe(false);
    const ret = ensureTasksDir(dir);
    expect(ret).toBe(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(md).toContain('Lynel');
    expect(md).toContain('绝对路径');
  });

  it('不覆盖用户已改过的 CLAUDE.md', () => {
    const dir = path.join(tmpDir(), 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '用户自己写的内容', 'utf8');
    ensureTasksDir(dir);
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('用户自己写的内容');
  });

  it('目录已存在时不报错（幂等）', () => {
    const dir = path.join(tmpDir(), 'tasks');
    ensureTasksDir(dir);
    expect(() => ensureTasksDir(dir)).not.toThrow();
  });
});
