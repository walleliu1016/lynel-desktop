// RequestParser: 从请求 body 提取 user text 和 tool_result（5.3 节）
import type { ApiMessage, ApiContentBlock } from './turnStateMachine.js';

export interface ParsedToolResult {
  tool_use_id: string;
  is_error: boolean;
  content_summary: string;
  content: string;
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
    .map((b) => {
      const content = extractToolResultContent(b);
      return {
        tool_use_id: b.tool_use_id!,
        is_error: b.is_error === true,
        content_summary: summarizeToolResultContent(content),
        content,
      };
    });
}

// 提取 tool_result 的完整 content：
// - string content：直接返回
// - 数组 content（Anthropic 结构化）：拼接所有 text 块
// - 其他对象：JSON 序列化
function extractToolResultContent(block: ApiContentBlock): string {
  const c = (block as { content?: unknown }).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts = c
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof (item as any).text === 'string') {
          return (item as any).text as string;
        }
        return null;
      })
      .filter((s): s is string => !!s);
    return parts.join('\n');
  }
  if (c && typeof c === 'object') return JSON.stringify(c, null, 2);
  return '';
}

function summarizeToolResultContent(content: string): string {
  return content.length > 200 ? content.slice(0, 200) + '…' : content;
}
