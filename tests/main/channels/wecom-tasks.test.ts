// tests/main/channels/wecom-tasks.test.ts
// 企业微信的任务指令：/tasks 列表、/run <序号|名称> 触发一次。
// 只测纯函数（解析 + 参数消歧）—— 真正的入站分发要起 websocket，交给手测。
import { describe, it, expect, vi } from 'vitest';
import { parseTaskCommand, resolveTaskArg, type WeComTaskInfo } from '../../../src/main/channels/wecom-channel.js';

vi.mock('electron', () => ({ safeStorage: {} }));

const task = (over: Partial<WeComTaskInfo>): WeComTaskInfo => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  name: '每日 CI 失败巡检',
  enabled: true,
  schedule: '每天 09:00',
  lastStatus: 'done',
  nextRunAt: null,
  running: false,
  ...over,
});

describe('parseTaskCommand', () => {
  it('/tasks 精确匹配 → 列表指令', () => {
    expect(parseTaskCommand('/tasks')).toEqual({ kind: 'list' });
    expect(parseTaskCommand('  /tasks  ')).toEqual({ kind: 'list' });
  });

  it('/run <参数> → 运行指令，参数去掉两端空白', () => {
    expect(parseTaskCommand('/run 1')).toEqual({ kind: 'run', arg: '1' });
    expect(parseTaskCommand('/run   每日 CI  ')).toEqual({ kind: 'run', arg: '每日 CI' });
  });

  it('/run 不带参数也算运行指令（由解析层给出用法提示，不当成普通消息转发）', () => {
    expect(parseTaskCommand('/run')).toEqual({ kind: 'run', arg: '' });
  });

  it('不是任务指令的一律返回 null → 继续走普通消息转发', () => {
    for (const t of ['/tasks 1', '/runtime', '/runx 1', '/interrupt', 'hello', '/Tasks']) {
      expect(parseTaskCommand(t), t).toBeNull();
    }
  });
});

describe('resolveTaskArg', () => {
  const all = [
    task({ id: 'id-ci', name: '每日 CI 失败巡检' }),
    task({ id: 'id-sec', name: '依赖安全审计' }),
    task({ id: 'id-ci2', name: '每日 CI 回归' }),
  ];

  it('序号 → 按列表顺序取（1 起）', () => {
    expect(resolveTaskArg('1', all)).toEqual({ task: all[0] });
    expect(resolveTaskArg('3', all)).toEqual({ task: all[2] });
  });

  it('序号越界 / 非纯数字不按序号处理，落到名称匹配', () => {
    expect('error' in resolveTaskArg('9', all)).toBe(true);
    expect('error' in resolveTaskArg('1a', all)).toBe(true);
  });

  it('完整 id 直接命中', () => {
    expect(resolveTaskArg('id-sec', all)).toEqual({ task: all[1] });
  });

  it('名称全等优先于前缀：只有唯一全等时才认', () => {
    expect(resolveTaskArg('依赖安全审计', all)).toEqual({ task: all[1] });
  });

  it('名称唯一前缀可以命中', () => {
    expect(resolveTaskArg('依赖', all)).toEqual({ task: all[1] });
  });

  it('前缀命中多个 → 报歧义，不猜', () => {
    const r = resolveTaskArg('每日', all);
    expect('error' in r && r.error).toMatch(/有 2 个任务匹配/);
  });

  it('空参数 / 找不到 → 可读错误并指引 /tasks', () => {
    expect('error' in resolveTaskArg('', all) && resolveTaskArg('', all)).toMatchObject({
      error: expect.stringContaining('/tasks'),
    });
    const miss = resolveTaskArg('不存在的任务', all);
    expect('error' in miss && miss.error).toMatch(/未找到匹配任务/);
  });

  it('空任务列表时任何参数都报未找到（不抛错）', () => {
    expect('error' in resolveTaskArg('1', [])).toBe(true);
    expect('error' in resolveTaskArg('随便', [])).toBe(true);
  });
});
