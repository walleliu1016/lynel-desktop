export type SessionState =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'streaming'
  | 'running_tool'
  | 'awaiting_permission'
  | 'done'
  | 'ended'

// 是不是用户主动结束的（/exit / /quit，jsonl 末尾有标记，stream-json attach
// 会被 claude 立即拒绝）。区别于 'done'（claude 进程正常退出/崩溃）。
// UI 不允许在 ended 状态下发消息。
export const isSessionEnded = (s: SessionState | undefined) => s === 'ended' || s === 'done'

export interface SessionMeta {
  id: string
  workdir: string
  project: string
  mtime: number
  msg_count: number
  first_prompt: string
  ai_title: string
  size: number
  lastEvent?: { type: string; summary: string }
  user_title?: string
  title_source?: 'user' | 'ai' | 'first_prompt'
  bot_id?: string
}

export type TitleSource = 'user' | 'ai' | 'first_prompt'

import type { ContentBlock } from './blocks'

export interface ChatMessage {
  id: string
  msgId?: string // Claude 消息 uuid，用于流式事件去重
  // JSONL 原始 role（'user' / 'assistant' / 'tool'）。UI 渲染用的 displayRole
  // 会在 HomeView 里根据 blocks 内容二次判断（比如 user + 全 tool_result → 'tool-reply'）。
  role: 'user' | 'assistant' | 'tool'
  blocks: ContentBlock[] // 结构化 content blocks（见 ./blocks.ts）
  ts: number
  optimistic?: boolean // 乐观插入的本地消息，等待真实事件替换
}

