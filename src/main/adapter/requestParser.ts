// RequestParser: 从请求 body 提取 user text 和 tool_result（5.3 节）
import type { ApiMessage, ApiContentBlock } from './turnStateMachine.js';

export interface ParsedToolResult {
  tool_use_id: string;
  is_error: boolean;
  content_summary: string;
}

export function extractUserText(message: ApiMessage | undefined): string | null {
  if (!message || message.role !== 'user') return null;
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const texts = message.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    if (texts.length) return texts.join('\n');
    return null;
  }
  return null;
}

export function extractToolResults(message: ApiMessage | undefined): ParsedToolResult[] {
  if (!message || message.role !== 'user') return [];
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string')
    .map((b) => ({
      tool_use_id: b.tool_use_id!,
      is_error: b.is_error === true,
      content_summary: summarizeToolResultContent(b),
    }));
}

function summarizeToolResultContent(block: ApiContentBlock): string {
  const c = (block as { content?: unknown }).content;
  if (typeof c === 'string') {
    return c.length > 200 ? c.slice(0, 200) + '…' : c;
  }
  return '';
}
