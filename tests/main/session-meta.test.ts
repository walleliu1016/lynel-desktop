import { describe, it, expect } from 'vitest';
import { rebindRecentList, validateSessionBotBind, type RecentSessionRecord } from '../../src/main/session-meta.js';

function rec(over: Partial<RecentSessionRecord> = {}): RecentSessionRecord {
  return {
    sessionId: 'old-sid',
    workdir: '/wd',
    project: 'demo',
    aiTitle: '旧标题',
    firstPrompt: '旧 prompt',
    lastOpenedAt: 1000,
    state: 'running',
    ...over,
  };
}

describe('rebindRecentList（/clear、/resume 后的 recents 变换）', () => {
  it('/clear：旧记录标 done 且让出 botId，新记录继承绑定，同 bot 不出现双记录', () => {
    const list = [rec({ botId: 'b1' })];
    const out = rebindRecentList(list, 'old-sid', 'new-sid', '/wd2', 'clear', 2000);

    const oldRec = out.find((r) => r.sessionId === 'old-sid')!;
    const newRec = out.find((r) => r.sessionId === 'new-sid')!;
    expect(oldRec.state).toBe('done');
    // 关键：botId 只能留在新记录上，旧记录还留着就会同 bot 双记录 ——
    // listBotBindings（后写赢）与 sessionBotMap（先写赢）顺序相反，UI 与路由互相打架
    expect(oldRec.botId).toBeUndefined();
    expect(newRec.botId).toBe('b1');
    // /clear 是全新对话：标题不继承
    expect(newRec.aiTitle).toBe('');
    expect(newRec.state).toBe('running');
    expect(newRec.workdir).toBe('/wd2');
  });

  it('/clear：旧记录标题等历史字段保留，用户仍可回看', () => {
    const list = [rec()];
    const out = rebindRecentList(list, 'old-sid', 'new-sid', '/wd', 'clear', 2000);
    const oldRec = out.find((r) => r.sessionId === 'old-sid')!;
    expect(oldRec.aiTitle).toBe('旧标题');
    expect(oldRec.firstPrompt).toBe('旧 prompt');
    expect(oldRec.state).toBe('done');
  });

  it('/resume：复用目标会话现有记录，保留其 userTitle，绑定从旧记录迁来', () => {
    const target = rec({
      sessionId: 'new-sid',
      aiTitle: '目标标题',
      userTitle: '用户起的名',
      state: 'done',
      lastOpenedAt: 500,
    });
    const list = [rec({ botId: 'b1' }), target];
    const out = rebindRecentList(list, 'old-sid', 'new-sid', '/wd', 'resume', 2000);

    const newRec = out.find((r) => r.sessionId === 'new-sid')!;
    // resume 目标已存在：标题字段必须保留（清空会永久丢 userTitle）
    expect(newRec.aiTitle).toBe('目标标题');
    expect(newRec.userTitle).toBe('用户起的名');
    expect(newRec.state).toBe('running');
    expect(newRec.lastOpenedAt).toBe(2000);
    // 目标记录原本没绑 bot，绑定从旧会话迁来
    expect(newRec.botId).toBe('b1');
    // 旧记录不再持有 botId
    expect(out.find((r) => r.sessionId === 'old-sid')!.botId).toBeUndefined();
    // 同一 bot 全列表只出现一次
    expect(out.filter((r) => r.botId === 'b1')).toHaveLength(1);
  });

  it('/resume：目标记录不存在时按新记录创建，继承旧绑定与 agent', () => {
    const list = [rec({ botId: 'b1', agent: 'codex' as any })];
    const out = rebindRecentList(list, 'old-sid', 'new-sid', '/wd', 'resume', 2000);
    const newRec = out.find((r) => r.sessionId === 'new-sid')!;
    expect(newRec.botId).toBe('b1');
    expect(newRec.agent).toBe('codex');
    expect(out.find((r) => r.sessionId === 'old-sid')!.botId).toBeUndefined();
  });

  it('旧记录不存在（adopt 等场景）也能建出新记录', () => {
    const out = rebindRecentList([], 'ghost', 'new-sid', '/wd', 'clear', 2000);
    const newRec = out.find((r) => r.sessionId === 'new-sid');
    expect(newRec).toBeDefined();
    expect(newRec!.botId).toBeUndefined();
    expect(newRec!.state).toBe('running');
  });
});

describe('validateSessionBotBind（主进程强制 bot↔session 1:1）', () => {
  const bindings = { b1: 'other-sid' }; // botId → sessionId

  it('拒绝绑定已绑到其他会话的 bot', () => {
    const r = validateSessionBotBind({ sessionId: 'sid-1', botId: 'b1', bindings, notifyBotId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('已绑定');
  });

  it('允许把 bot 重新绑回它已绑定的会话（幂等）', () => {
    const r = validateSessionBotBind({ sessionId: 'other-sid', botId: 'b1', bindings, notifyBotId: '' });
    expect(r.ok).toBe(true);
  });

  it('拒绝绑定任务通知机器人', () => {
    const r = validateSessionBotBind({ sessionId: 'sid-1', botId: 'b2', bindings, notifyBotId: 'b2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('任务通知');
  });

  it('解绑（botId 为空）恒通过', () => {
    expect(validateSessionBotBind({ sessionId: 'sid-1', botId: '', bindings, notifyBotId: 'b2' }).ok).toBe(true);
    expect(validateSessionBotBind({ sessionId: 'sid-1', botId: null, bindings, notifyBotId: 'b2' }).ok).toBe(true);
  });

  it('未绑过的 bot 可以绑定', () => {
    expect(validateSessionBotBind({ sessionId: 'sid-1', botId: 'b3', bindings, notifyBotId: '' }).ok).toBe(true);
  });
});
