// Anthropic Messages API FormatAdapter（Claude Code）
// 移植自 ccglass src/parse.js + src/formats/anthropic.js

import type {
  FormatAdapter,
  FormatView,
  FormatViewBlock,
  ReassembledResponse,
  ReassembledContentBlock,
  RequestParseResult,
  Cost,
  Usage,
} from './format.js';
import type { SessionUsage } from '../protocol/usage.js';
import { estimateTokens, costFromUsage } from '../cost/priceTable.js';

// ---- 通用文本渲染 -----------------------------------------------------------

function blockText(b: unknown): string {
  if (b == null) return '';
  if (typeof b === 'string') return b;
  const anyB = b as any;
  switch (anyB.type) {
    case 'text':
      return anyB.text || '';
    case 'thinking':
      return anyB.thinking || '';
    case 'tool_use':
      return `[tool_use ${anyB.name}] ${JSON.stringify(anyB.input ?? {})}`;
    case 'tool_result':
      return `[tool_result] ${typeof anyB.content === 'string' ? anyB.content : JSON.stringify(anyB.content)}`;
    case 'image':
      return '[image]';
    default:
      return anyB.text || JSON.stringify(b);
  }
}

// ---- Request 解析 -----------------------------------------------------------

function extractPromptText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n');
  }
  return undefined;
}

function extractToolResults(rawContent: unknown): RequestParseResult['toolResults'] {
  if (!Array.isArray(rawContent)) return [];
  return rawContent
    .filter((block: any) => block?.type === 'tool_result' && typeof block.tool_use_id === 'string')
    .map((block: any) => {
      const c = block.content;
      const summary = typeof c === 'string' ? c : JSON.stringify(c);
      return {
        tool_use_id: block.tool_use_id as string,
        is_error: block.is_error === true,
        content_summary: summary.length > 200 ? summary.slice(0, 200) + '…' : summary,
      };
    });
}

function parseRequestBody(body: unknown): RequestParseResult {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const lastMessage = Array.isArray(b.messages) ? (b.messages as any[]).at(-1) : undefined;
  const rawContent = lastMessage?.content;
  return {
    model: typeof b.model === 'string' ? b.model : undefined,
    lastUserText: extractPromptText(rawContent),
    toolResults: extractToolResults(rawContent),
  };
}

function parseHttpError(status: number, raw: string): string {
  if (!raw || !raw.trim()) return `HTTP ${status}`;
  try {
    const json = JSON.parse(raw.trimStart());
    if (json?.error?.message) return `HTTP ${status}: ${json.error.type ?? ''} - ${json.error.message}`;
    if (json?.message) return `HTTP ${status}: ${json.message}`;
  } catch {
    // fall through
  }
  return `HTTP ${status}: ${raw.slice(0, 200)}`;
}

// ---- Response 重组 ----------------------------------------------------------

type AccumulatorState = {
  blocks: ReassembledContentBlock[];
  usage: SessionUsage;
  stop_reason: string | null;
  model: string | null;
  error?: { type: string; message: string };
};

function blankState(): AccumulatorState {
  return {
    blocks: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: null,
    model: null,
  };
}

function startBlock(cb: any): ReassembledContentBlock {
  if (cb.type === 'tool_use') return { type: 'tool_use', name: cb.name || 'unknown', input: { ...(cb.input || {}) } };
  if (cb.type === 'thinking') return { type: 'thinking', thinking: cb.thinking || '' };
  if (cb.type === 'text') return { type: 'text', text: cb.text || '' };
  return { type: 'text', text: JSON.stringify(cb) };
}

function applyDelta(block: ReassembledContentBlock, delta: any): void {
  if (!block || !delta) return;
  if (block.type === 'text' && delta.type === 'text_delta' && typeof delta.text === 'string') {
    block.text += delta.text;
  } else if (block.type === 'thinking' && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    block.thinking += delta.thinking;
  } else if (block.type === 'tool_use' && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
    const raw = (block as any)._json || '';
    (block as any)._json = raw + delta.partial_json;
  }
}

function finalizeBlock(block: ReassembledContentBlock): ReassembledContentBlock {
  if (block.type === 'tool_use' && (block as any)._json !== undefined) {
    const raw = (block as any)._json;
    delete (block as any)._json;
    try {
      if (raw) block.input = JSON.parse(raw);
      else block.input = {};
    } catch {
      block.input = { _raw: raw };
    }
  }
  return block;
}

function applyEvent(state: AccumulatorState, ev: any): void {
  switch (ev.type) {
    case 'message_start':
      state.model = ev.message?.model ?? state.model;
      if (ev.message?.usage) {
        state.usage = { ...state.usage, ...ev.message.usage };
      }
      break;
    case 'content_block_start':
      state.blocks[ev.index] = startBlock(ev.content_block);
      break;
    case 'content_block_delta': {
      const block = state.blocks[ev.index];
      if (block) applyDelta(block, ev.delta);
      break;
    }
    case 'content_block_stop':
      // block 已完成，finalize 在最终输出时做
      break;
    case 'message_delta':
      if (ev.delta?.stop_reason) state.stop_reason = ev.delta.stop_reason;
      if (ev.usage) {
        state.usage = { ...state.usage, ...ev.usage };
      }
      break;
    case 'error':
      state.error = ev.error;
      break;
  }
}

function finalizeState(state: AccumulatorState): ReassembledResponse {
  return {
    streamed: true,
    model: state.model,
    stop_reason: state.stop_reason,
    usage: state.usage,
    content: state.blocks.filter(Boolean).map(finalizeBlock),
    error: state.error,
  };
}

function reassembleResponse(raw: string): ReassembledResponse | null {
  if (!raw) return null;
  const trimmed = raw.trimStart();

  // 非流式 JSON 响应
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json.type === 'error') {
        return {
          streamed: false,
          model: json.model ?? null,
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [],
          error: json.error,
        };
      }
      return {
        streamed: false,
        model: json.model ?? null,
        stop_reason: json.stop_reason ?? null,
        usage: {
          input_tokens: json.usage?.input_tokens ?? 0,
          output_tokens: json.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: json.usage?.cache_creation_input_tokens,
          cache_read_input_tokens: json.usage?.cache_read_input_tokens,
        },
        content: Array.isArray(json.content) ? json.content.map(startBlock).map(finalizeBlock) : [],
      };
    } catch {
      return { streamed: false, model: null, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 }, content: [] };
    }
  }

  const state = blankState();

  // AWS Bedrock eventstream：二进制帧转 UTF-8 后 base64 payload 可能残留
  if (!/^data:/m.test(raw) && /"bytes":"[A-Za-z0-9+/=]+"/.test(raw)) {
    for (const match of raw.matchAll(/"bytes":"([A-Za-z0-9+/=]+)"/g)) {
      try {
        const ev = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
        applyEvent(state, ev);
      } catch {
        continue;
      }
    }
    return finalizeState(state);
  }

  // 标准 SSE
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const ev = JSON.parse(payload);
      applyEvent(state, ev);
    } catch {
      continue;
    }
  }

  return finalizeState(state);
}

// ---- View / Blocks ---------------------------------------------------------

function messageText(b: any): string {
  if (b == null || typeof b === 'string') return String(b ?? '');
  if (b.type === 'tool_use') return JSON.stringify(b.input ?? {}, null, 2);
  if (b.type === 'tool_result') {
    const c = b.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(blockText).join('\n');
    return c == null ? '' : JSON.stringify(c, null, 2);
  }
  return b.text ?? (b.input ? JSON.stringify(b.input, null, 2) : JSON.stringify(b));
}

function view(body: unknown): FormatView {
  const b = (body || {}) as Record<string, unknown>;
  const system = Array.isArray(b.system)
    ? b.system.map((s: any, i: number) => ({
        kind: 'system' as const,
        label: `system[${i}]`,
        text: s?.text || '',
        cache: !!s?.cache_control,
      }))
    : [];
  const messages: FormatViewBlock[] = [];
  if (Array.isArray(b.messages)) {
    (b.messages as any[]).forEach((m: any, mi: number) => {
      const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      content.forEach((block: any, bi: number) => {
        messages.push({
          kind: 'message',
          label: `msg[${mi}].${m.role}[${bi}]`,
          type: block?.type || 'text',
          name: block?.name,
          text: messageText(block),
          cache: !!block?.cache_control,
        });
      });
    });
  }
  const tools = Array.isArray(b.tools)
    ? b.tools.map((t: any) => ({
        kind: 'tool' as const,
        label: `tool:${t.name}`,
        text: t.description || '',
        cache: false,
      }))
    : [];
  return { system, messages, tools };
}

function blocks(body: unknown): FormatViewBlock[] {
  const v = view(body);
  return [...v.system, ...v.messages, ...v.tools];
}

function estimateRequestTokens(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const b = body as Record<string, unknown>;
  let chars = '';
  if (Array.isArray(b.system)) {
    for (const s of b.system) chars += (s as any).text || '';
  }
  if (Array.isArray(b.messages)) {
    for (const m of b.messages) {
      const content = Array.isArray((m as any).content) ? (m as any).content : [{ text: (m as any).content }];
      for (const c of content) chars += (c as any).text || JSON.stringify((c as any).input || '') || '';
    }
  }
  if (Array.isArray(b.tools)) {
    for (const t of b.tools) {
      chars += ((t as any).description || '') + JSON.stringify((t as any).input_schema || {});
    }
  }
  return estimateTokens(chars);
}

// ---- Adapter 导出 ----------------------------------------------------------

export const anthropicAdapter: FormatAdapter = {
  name: 'anthropic',
  parseRequest: parseRequestBody,
  parseHttpError,
  reassembleResponse,
  view,
  blocks,
  estimateTokens: estimateRequestTokens,
  costFromUsage: (model: string, usage: Usage): Cost => costFromUsage(model, usage),
};
