import type { SessionMeta } from './jsonl.js';
import type { AgentKind } from './agents/index.js';

export interface RecentSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle: string;
  firstPrompt: string;
  userTitle?: string;
  lastOpenedAt: number;
  state: string;
  botId?: string;
  agent?: AgentKind;   // agent 类型，缺省 claude
  /** 用户在 claude 终端里主动执行了 /exit（或其他退出命令）。
   *  claude CLI 内部会把这种 session 标记为终止，即使 jsonl 完整存在，
   *  后续 `claude --resume <sid>` 也会被它自己拒绝。
   *  openTerminal 检测到该标志就走 PtyMode.New + 同 sid 重新拉起，
   *  避免触发 "No conversation found" 错误。spawn 成功后立刻清掉，
   *  保证新 session 的下一次 reconnect 走正常的 Resume 路径。 */
  terminated?: boolean;
}

/** 把 recents 里最新的 agent 字段合并到 jsonl SessionMeta 上（纯函数，便于单测）。 */
export function mergeRecentAgentField(raw: SessionMeta[], recents: RecentSessionRecord[]): SessionMeta[] {
  const map = new Map(recents.map((r) => [r.sessionId, r]));
  return raw.map((s) => {
    const r = map.get(s.id);
    if (!r) return s;
    const merged: SessionMeta = { ...s };
    if (r.agent) merged.agent = r.agent;
    return merged;
  });
}

/** /clear、/resume 触发 session rebind 后，把 recents 列表从旧 id 变换到新 id（纯函数）。
 *  返回新列表：旧记录标 done 并**让出 botId**（否则同一 bot 两条记录，
 *  listBotBindings 后写赢、sessionBotMap 先写赢，UI 与路由顺序相反互相打架）；
 *  新记录继承绑定。resume 复用目标现有记录时保留其标题字段（清空会永久丢 userTitle）。 */
export function rebindRecentList(
  list: RecentSessionRecord[],
  oldId: string,
  newId: string,
  workDir: string,
  mode: 'clear' | 'resume',
  now: number = Date.now(),
): RecentSessionRecord[] {
  const oldRec = list.find((r) => r.sessionId === oldId);
  const botId = oldRec?.botId;
  const agent = oldRec?.agent;
  if (oldRec) {
    oldRec.state = 'done';
    // 让出 botId：绑定整体迁到新记录，旧记录留着就是同 bot 双记录
    delete oldRec.botId;
  }
  const rest = list.filter((r) => r.sessionId !== newId);
  const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;

  let newRec: RecentSessionRecord;
  if (mode === 'resume') {
    const existing = list.find((r) => r.sessionId === newId);
    newRec = existing
      ? {
          ...existing,
          workdir: workDir,
          project: existing.project || project,
          lastOpenedAt: now,
          state: 'running',
          // 绑定跟着 PTY 走（旧会话的 bot 迁来）；旧会话没绑则保留目标原有的
          botId: botId ?? existing.botId,
          agent: agent ?? existing.agent,
        }
      : {
          sessionId: newId,
          workdir: workDir,
          project,
          aiTitle: '',
          firstPrompt: '',
          lastOpenedAt: now,
          state: 'running',
          botId,
          agent,
        };
  } else {
    // /clear：全新对话，标题不继承（继承会被 mergeRecentTitles 永久锁死在后续所有 /clear 会话上）
    newRec = {
      sessionId: newId,
      workdir: workDir,
      project: oldRec?.project || project,
      aiTitle: '',
      firstPrompt: '',
      lastOpenedAt: now,
      state: 'running',
      botId,
      agent,
    };
  }
  return [newRec, ...rest];
}

export type BindValidation = { ok: true } | { ok: false; error: string };

/** 绑定会话前的主进程校验（纯函数）。渲染层只是把已占用的 bot 置灰，
 *  依赖异步加载的列表，存在过期窗口 —— 双绑后 listBotBindings（后写赢）与
 *  sessionBotMap（先写赢）顺序相反，UI 与路由会互相打架，必须在主进程兜住。
 *  `bindings` 为 botId → sessionId 映射（来自 recents）。 */
export function validateSessionBotBind(p: {
  sessionId: string;
  botId: string | null | undefined;
  bindings: Record<string, string>;
  notifyBotId: string;
}): BindValidation {
  if (!p.botId) return { ok: true }; // 解绑恒通过
  if (p.notifyBotId && p.botId === p.notifyBotId) {
    return { ok: false, error: '这个机器人已用于任务通知，不能再绑定会话' };
  }
  const bound = p.bindings[p.botId];
  if (bound && bound !== p.sessionId) {
    return { ok: false, error: '这个机器人已绑定其他会话，请先解绑' };
  }
  return { ok: true };
}
