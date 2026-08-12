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
