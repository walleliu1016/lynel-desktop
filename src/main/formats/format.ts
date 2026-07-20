// FormatAdapter 接口：多 agent 扩展预留（4.4 节）
// 每个 agent（claude/codex/pi）实现自己的 adapter

import type { SessionUsage } from '../protocol/usage.js';

export interface ReassembledResponse {
  streamed: boolean;
  model: string | null;
  stop_reason: string | null;
  usage: SessionUsage;
  content: ReassembledContentBlock[];
  error?: { type: string; message: string };
}

export type ReassembledContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface FormatViewBlock {
  kind: 'system' | 'message' | 'tool';
  label: string;
  type?: string;
  name?: string;
  text: string;
  cache?: boolean;
}

export interface FormatView {
  system: FormatViewBlock[];
  messages: FormatViewBlock[];
  tools: FormatViewBlock[];
}

export interface RequestParseResult {
  model?: string;
  lastUserText?: string;
  toolResults?: Array<{ tool_use_id: string; is_error: boolean; content_summary: string }>;
}

export interface Cost {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  totalInput: number;
  cacheHitRate: number;
  usd: number;
}

export interface FormatAdapter {
  readonly name: string;

  // 解析请求 body，提取关键信息
  parseRequest(body: unknown): RequestParseResult;

  // 把原始 SSE/JSON 响应体重组成最终消息
  reassembleResponse(raw: string): ReassembledResponse | null;

  // 从 HTTP 错误响应体提取可读错误
  parseHttpError(status: number, raw: string): string;

  // 渲染 dashboard 视图
  view(body: unknown): FormatView;
  blocks(body: unknown): FormatViewBlock[];

  // 估算与成本
  estimateTokens(body: unknown): number;
  costFromUsage(model: string, usage: Usage): Cost;
}
