// src/main/tasks/streamParse.ts
// 纯函数：claude -p --output-format stream-json 的 NDJSON 行 → 归一化事件。
// 主进程与渲染进程是两个独立 bundle，不能互相 import，所以「原始行 → 结构化」
// 只在这里做一次；tasks:runEvents IPC 返回本文件的产物，渲染层只做 UI 折叠。
// 所有形状都按 2026-09-18 本机 claude 2.1.114 实测（见 spec §8.4 / fixture）设计。

export type NormalizedBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface InitInfo {
  model: string;
  cwd: string;
  toolCount: number;
  claudeCodeVersion: string;
  permissionMode: string;
  failedMcpServers: string[];
}

export interface ResultSummary {
  subtype: string;
  isError: boolean;
  resultText: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: string[];
  /** 只含 USAGE_KEYS 里的数值字段（C5：原始 usage 含嵌套对象与字符串） */
  usage: Record<string, number>;
}

export interface NormalizedEvent {
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr';
  subtype?: string;
  /** assistant / user 的消息分组键（C1：一个 block 一行，同一 id 跨多行） */
  messageId?: string;
  /** 非 null 表示来自子代理 */
  parentToolUseId?: string | null;
  blocks?: NormalizedBlock[];
  toolResult?: { toolUseId: string; content: string; isError: boolean };
  init?: InitInfo;
  hook?: { name: string; ok: boolean };
  result?: ResultSummary;
  /** 仅 stderr 事件 */
  text?: string;
}

export const USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
] as const;

export function normalizeToolResultContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // 单趟按原顺序拼接：块的位置关系是上游数据的一部分，归一化必须保序。
    const parts: string[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (block.type === 'image') parts.push('[图片]');
    }
    return parts.join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

export function pickUsage(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of USAGE_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** result.result 有时是双重编码的 JSON 字符串，解一层。 */
function decodeResultText(v: unknown): string {
  if (typeof v !== 'string') return v == null ? '' : JSON.stringify(v);
  const trimmed = v.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* 保持原样 */
    }
  }
  return v;
}

function parseAssistant(raw: Record<string, unknown>): NormalizedEvent {
  const msg = obj(raw.message) ?? {};
  const content = msg.content;
  const blocks: NormalizedBlock[] = [];
  if (typeof content === 'string') {
    if (content) blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const b of content) {
      const block = obj(b);
      if (!block) continue;
      if (block.type === 'thinking') {
        const text = str(block.thinking);
        if (text) blocks.push({ type: 'thinking', text }); // 空 thinking block 真实存在，必须过滤
      } else if (block.type === 'text') {
        const text = str(block.text);
        if (text) blocks.push({ type: 'text', text });
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: str(block.id),
          name: str(block.name, 'unknown'),
          input: obj(block.input) ?? {},
        });
      }
    }
  }
  return {
    type: 'assistant',
    messageId: str(msg.id),
    parentToolUseId: typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : null,
    blocks,
  };
}

function parseUser(raw: Record<string, unknown>): NormalizedEvent {
  const msg = obj(raw.message) ?? {};
  const content = msg.content;
  const ev: NormalizedEvent = {
    type: 'user',
    messageId: typeof msg.id === 'string' ? msg.id : undefined,
    parentToolUseId: typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : null,
  };
  if (Array.isArray(content)) {
    for (const b of content) {
      const block = obj(b);
      if (block?.type !== 'tool_result') continue;
      ev.toolResult = {
        toolUseId: str(block.tool_use_id),
        content: normalizeToolResultContent(block.content),
        isError: block.is_error === true,
      };
      break;
    }
  }
  return ev;
}

function parseSystem(raw: Record<string, unknown>): NormalizedEvent | null {
  const subtype = str(raw.subtype);
  if (subtype === 'init') {
    const tools = Array.isArray(raw.tools) ? raw.tools : [];
    const mcp = Array.isArray(raw.mcp_servers) ? raw.mcp_servers : [];
    const failedMcpServers: string[] = [];
    for (const s of mcp) {
      const server = obj(s);
      if (server && str(server.status) === 'failed') failedMcpServers.push(str(server.name));
    }
    return {
      type: 'system',
      subtype: 'init',
      init: {
        model: str(raw.model),
        cwd: str(raw.cwd),
        toolCount: tools.length,
        claudeCodeVersion: str(raw.claude_code_version),
        permissionMode: str(raw.permissionMode),
        failedMcpServers,
      },
    };
  }
  if (subtype === 'hook_started' || subtype === 'hook_response') {
    const outcome = str(raw.outcome);
    return {
      type: 'system',
      subtype,
      hook: {
        name: str(raw.hook_name, str(raw.hook_event, 'hook')),
        ok: subtype === 'hook_started' ? true : outcome === '' || outcome === 'success',
      },
    };
  }
  return null;
}

function parseResult(raw: Record<string, unknown>): NormalizedEvent {
  const denials = Array.isArray(raw.permission_denials) ? raw.permission_denials : [];
  return {
    type: 'result',
    result: {
      subtype: str(raw.subtype),
      isError: raw.is_error === true,
      resultText: decodeResultText(raw.result),
      numTurns: num(raw.num_turns),
      durationMs: num(raw.duration_ms),
      totalCostUsd: num(raw.total_cost_usd),
      stopReason: typeof raw.stop_reason === 'string' ? raw.stop_reason : null,
      terminalReason: typeof raw.terminal_reason === 'string' ? raw.terminal_reason : null,
      permissionDenials: denials
        .map((d) => str(obj(d)?.tool_name))
        .filter((n) => n !== ''),
      usage: pickUsage(raw.usage),
    },
  };
}

export function parseStreamLine(line: string): NormalizedEvent | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rec = obj(raw);
  if (!rec) return null;
  switch (rec.type) {
    case 'system':
      return parseSystem(rec);
    case 'assistant':
      return parseAssistant(rec);
    case 'user':
      return parseUser(rec);
    case 'result':
      return parseResult(rec);
    case 'stderr':
      return { type: 'stderr', text: str(rec.text, trimmed) };
    default:
      return null; // tool_progress / control_request / stream_event 等一律忽略
  }
}

/** 整段文本按行解析，跳过无效行。runner 用行缓冲逐行喂，测试用整段喂。 */
export function parseStreamText(text: string): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const line of text.split('\n')) {
    const ev = parseStreamLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

/** R2 实测：resume 目标缺失时 claude 会吐一个 error_during_execution 的 result，
 *  num_turns=0、total_cost_usd=0，且整个 run 没有任何 assistant 事件。
 *  注意：该 result 里的 session_id 是**新生成的随机 UUID**，调用方绝不能写回 tasks.session_id。 */
export function isResumeMissing(events: NormalizedEvent[]): boolean {
  const result = events.find((e) => e.type === 'result')?.result;
  if (!result) return false;
  if (events.some((e) => e.type === 'assistant')) return false;
  return result.subtype === 'error_during_execution' && result.isError && result.numTurns === 0;
}
