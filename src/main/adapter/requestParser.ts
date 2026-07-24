// RequestParser: 从请求 body 提取 user text 和 tool_result（5.3 节）
import type { ApiMessage, ApiContentBlock } from './turnStateMachine.js';

export interface ParsedToolResult {
  tool_use_id: string;
  is_error: boolean;
  content_summary: string;
  content: string;
}

// Claude Code TUI 会把上下文/模式横幅等非用户输入塞进 user 消息的 text 块：
//   - <system-reminder>...</system-reminder>：自动注入的上下文（工作目录、env、token 用量等）
//   - [SUGGESTION MODE: ...] / [AUTO MODE: ...] / [EXECUTE MODE: ...] 等顶栏横幅
// 这些都不是用户实际输入，需要在源头剔除，否则会被作为 user 消息推到企微/SSE/Trace。
// 返回清理后的文本；若清完为空则返回 null（调用方应当放弃该 envelope，不构造空消息）。
const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/g
const TUI_MODE_PREFIX_RE = /^\s*\[[A-Z][A-Z _-]*MODE\s*[^\]]*\]\s*\n?/

export function cleanUserText(raw: string): string | null {
  if (!raw) return null
  let text = raw.replace(SYSTEM_REMINDER_RE, '')
  text = text.replace(TUI_MODE_PREFIX_RE, '')
  text = text.trim()
  return text || null
}

export function extractUserText(message: ApiMessage | undefined): string | null {
  if (!message || message.role !== 'user') return null;
  let raw: string | null = null
  if (typeof message.content === 'string') {
    raw = message.content;
  } else if (Array.isArray(message.content)) {
    const texts = message.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    raw = texts.length ? texts.join('\n') : null;
  }
  return raw == null ? null : cleanUserText(raw)
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
