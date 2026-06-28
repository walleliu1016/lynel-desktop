export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'done' | 'ended'

// 是不是用户主动结束的（/exit / /quit，jsonl 末尾有标记，stream-json attach
// 会被 claude 立即拒绝）。区别于 'done'（claude 进程正常退出/崩溃）。
// UI 不允许在 ended 状态下发消息。
export const isSessionEnded = (s: SessionState | undefined) => s === 'ended' || s === 'done'

export interface SessionMeta {
  id: string
  workdir: string
  mtime: number
  msg_count: number
  first_prompt: string
  ai_title: string
  size: number
}

export interface ChatMessage {
  id: string
  msgId?: string // Claude 消息 uuid，用于流式事件去重
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool?: { name: string; args: unknown }
  ts: number
}
