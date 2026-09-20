import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setRoot, setExcludedProjects, scanAll, encodeProjectDirName, getSessionJsonlPath, listSessionIds,
} from '../../../src/main/jsonl.js';

vi.mock('electron', () => ({ safeStorage: {} }));

let root: string;

function writeSession(workDir: string, id: string, opts: { cwd?: string } = {}) {
  const dir = path.join(root, encodeProjectDirName(workDir));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '你好' }, cwd: opts.cwd ?? workDir, timestamp: '2026-09-18T01:00:00Z' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } }),
  ];
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-jsonl-'));
  setRoot(root);
  setExcludedProjects([]);
});
afterEach(() => {
  // 排除集合是模块级状态：不复位会污染同进程里其它测试
  setExcludedProjects([]);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('setExcludedProjects', () => {
  it('被排除的项目目录不出现在 scanAll 结果里', async () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-x');
    writeSession('/work/proj-a', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    writeSession(tasksDir, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
    expect((await scanAll()).map((s) => s.id).sort()).toEqual([
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    ]);

    setExcludedProjects([tasksDir]);
    const after = await scanAll();
    expect(after.map((s) => s.id)).toEqual(['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa']);
  });

  it('排除不影响直接路径查询（listSessionIds / getSessionJsonlPath）', () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-y');
    writeSession(tasksDir, 'cccccccc-3333-4333-8333-cccccccccccc');
    setExcludedProjects([tasksDir]);
    expect(listSessionIds(tasksDir)).toEqual(['cccccccc-3333-4333-8333-cccccccccccc']);
    expect(getSessionJsonlPath('cccccccc-3333-4333-8333-cccccccccccc', tasksDir)).toContain(
      'cccccccc-3333-4333-8333-cccccccccccc.jsonl',
    );
  });

  it('传空数组恢复全部可见', async () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-z');
    writeSession(tasksDir, 'dddddddd-4444-4444-8444-dddddddddddd');
    setExcludedProjects([tasksDir]);
    expect(await scanAll()).toHaveLength(0);
    setExcludedProjects([]);
    expect(await scanAll()).toHaveLength(1);
  });

  it('被排除目录的编码名没算错（含盘符/中文）', async () => {
    const tasksDir = 'G:\\我的项目\\tasks';
    writeSession(tasksDir, 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee');
    setExcludedProjects([tasksDir]);
    const all = await scanAll();
    expect(all.some((s) => s.id === 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee')).toBe(false);
  });
});
