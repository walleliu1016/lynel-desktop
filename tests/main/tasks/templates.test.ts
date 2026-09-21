// tests/main/tasks/templates.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ safeStorage: {} }));

let home: string;
let prevEnv: { HOME: string | undefined; USERPROFILE: string | undefined };

// templates.ts 走 os.homedir()：**win32 读 USERPROFILE、POSIX（mac/linux）读 HOME**。
// 两个都要覆盖 —— 只改 USERPROFILE 的话在 CI 的 macOS runner 上根本没隔离，测试会去动
// 真实的 ~/.lynel-desktop，表现是一串 ENOENT，本机还可能把用户已有的模板覆盖掉。
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tpl-'));
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // 自检：homedir 必须真的落到临时目录。漏了这一步的话，平台差异只会表现成
  // 「测试莫名 ENOENT」，而真正的后果是污染真实家目录 —— 宁可在这里直接失败。
  expect(os.homedir()).toBe(home);
  vi.resetModules();
});
afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const load = async () => import('../../../src/main/tasks/templates.js');

const sample = {
  name: '部署前检查',
  icon: 'bookmark',
  blurb: '我保存的模板',
  prompt: '对 /repo 执行部署前检查。',
  schedule: { type: 'daily' as const, hour: 9, minute: 0, days: [1, 2, 3, 4, 5], startAt: null, endAt: null },
};

describe('用户模板存储', () => {
  it('文件不存在时返回空列表，不抛错', async () => {
    const { listTemplates } = await load();
    expect(listTemplates()).toEqual([]);
  });

  it('保存后能列出来，最新的排在最前', async () => {
    const { saveTemplate, listTemplates } = await load();
    saveTemplate(sample);
    saveTemplate({ ...sample, name: '第二个' });
    expect(listTemplates().map((t) => t.name)).toEqual(['第二个', '部署前检查']);
  });

  it('保存时补齐 id / createdAt / icon / blurb，调度原样保留', async () => {
    const { saveTemplate } = await load();
    const t = saveTemplate({ ...sample, icon: '', blurb: '' });
    expect(t.id).toBeTruthy();
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.icon).toBe('bookmark'); // 缺了给中性默认值，而不是让整条模板没有图标
    expect(t.blurb).toBe('我保存的模板');
    expect(t.schedule).toEqual(sample.schedule);
  });

  it('删除只影响目标条目', async () => {
    const { saveTemplate, deleteTemplate, listTemplates } = await load();
    const a = saveTemplate(sample);
    saveTemplate({ ...sample, name: '第二个' });
    deleteTemplate(a.id);
    expect(listTemplates().map((t) => t.name)).toEqual(['第二个']);
  });

  it('文件被手改坏 / 不是数组 → 当空列表，不让任务面板打不开', async () => {
    const { listTemplates } = await load();
    const file = path.join(home, '.lynel-desktop', 'task-templates.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ 这不是 JSON', 'utf8');
    expect(listTemplates()).toEqual([]);
    fs.writeFileSync(file, '{"a":1}', 'utf8');
    expect(listTemplates()).toEqual([]);
  });

  it('数组里混着形状不对的条目时逐条过滤，不整体丢弃', async () => {
    const { saveTemplate, listTemplates } = await load();
    saveTemplate(sample);
    const file = path.join(home, '.lynel-desktop', 'task-templates.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.push({ id: 1, name: null }); // 缺 prompt / schedule
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(listTemplates()).toHaveLength(1);
    expect(listTemplates()[0].name).toBe('部署前检查');
  });

  it('写入是「先临时文件再 rename」，不留下 .tmp', async () => {
    const { saveTemplate } = await load();
    saveTemplate(sample);
    const dir = path.join(home, '.lynel-desktop');
    expect(fs.readdirSync(dir)).toEqual(['task-templates.json']);
  });
});
