// OpenAI FormatAdapter（Codex / opencode）
// 同时支持 Responses API（/v1/responses，Codex 用）与 Chat Completions（/v1/chat/completions，opencode 用）。
// 移植自 ccglass src/formats/openai.js，返回类型对齐 FormatAdapter 接口。

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
import { estimateTokens } from '../cost/priceTable.js';
import { cleanUserText } from '../adapter/requestParser.js';

// ---- 通用文本渲染 -----------------------------------------------------------

function flatten(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) =>
        typeof p === 'string'
          ? p
          : p?.text ?? p?.input_text ?? p?.output_text ?? (p?.type ? `[${p.type}]` : JSON.stringify(p)),
      )
      .join('');
  }
  return JSON.stringify(content);
}

// tool call 参数是 JSON 字符串；可解析时 pretty-print
function prettyArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args !== 'string') return JSON.stringify(args, null, 2);
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

function toolView(t: any) {
  const f = t.function || t;
  return { name: f.name, description: f.description || '', schema: f.parameters || f.input_schema || {} };
}

function isResponses(body: any = {}) {
  return body.input !== undefined || body.instructions !== undefined;
}

function summarize(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

// ---- Request 解析 -----------------------------------------------------------

function lastUserTextFromInput(input: unknown): string | undefined {
  if (typeof input === 'string') return cleanUserText(input) ?? undefined;
  if (!Array.isArray(input)) return undefined;
  for (let i = input.length - 1; i >= 0; i--) {
    const item: any = input[i];
    if (item == null) continue;
    if (typeof item === 'string') return cleanUserText(item) ?? undefined;
    // 最近一条 user 消息；跳过 function_call / function_call_output / reasoning
    if (item.type === 'message' && item.role === 'user') {
      const cleaned = cleanUserText(flatten(item.content));
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function lastUserTextFromMessages(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (m?.role !== 'user') continue;
    const cleaned = cleanUserText(flatten(m.content));
    if (cleaned) return cleaned;
  }
  return undefined;
}

function toolResultsFromInput(input: unknown): RequestParseResult['toolResults'] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item: any) => item?.type === 'function_call_output' && typeof item.call_id === 'string')
    .map((item: any) => ({
      tool_use_id: item.call_id as string,
      is_error: item.is_error === true,
      content_summary: summarize(typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? {})),
    }));
}

function toolResultsFromMessages(messages: any[]): RequestParseResult['toolResults'] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m: any) => m?.role === 'tool' && typeof m.tool_call_id === 'string')
    .map((m: any) => ({
      tool_use_id: m.tool_call_id as string,
      is_error: m.is_error === true,
      content_summary: summarize(flatten(m.content)),
    }));
}

function parseRequestBody(body: unknown): RequestParseResult {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const model = typeof b.model === 'string' ? b.model : undefined;
  if (isResponses(b)) {
    return {
      model,
      lastUserText: lastUserTextFromInput(b.input),
      toolResults: toolResultsFromInput(b.input),
    };
  }
  const messages = Array.isArray(b.messages) ? b.messages : [];
  return {
    model,
    lastUserText: lastUserTextFromMessages(messages),
    toolResults: toolResultsFromMessages(messages),
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

// 归一化 usage：Responses 的 input_tokens/output_tokens 与 Chat 的 prompt_tokens/completion_tokens 统一成 SessionUsage
function normUsage(u: any = {}): SessionUsage {
  const out: SessionUsage = {
    input_tokens: u.input_tokens ?? u.prompt_tokens ?? 0,
    output_tokens: u.output_tokens ?? u.completion_tokens ?? 0,
  };
  const cached =
    u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  if (cached) out.cache_read_input_tokens = cached;
  return out;
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : { _raw: String(raw) };
  } catch {
    return { _raw: String(raw ?? '') };
  }
}

function parseToolArgsPretty(raw: unknown): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return { _raw: String(raw ?? '') };
  }
}

function emptyReassembled(error?: { type: string; message: string }): ReassembledResponse {
  return {
    streamed: false,
    model: null,
    stop_reason: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [],
    error,
  };
}

function normalizeFinal(json: any): ReassembledResponse {
  // Responses API 非流式（output 数组 / object === "response"）
  if (json.output || json.object === 'response') {
    const content: ReassembledContentBlock[] = [];
    for (const item of json.output || []) {
      if (item.type === 'reasoning') {
        const summaryText = Array.isArray(item.summary) ? item.summary.map((s: any) => s.text ?? '').join('') : '';
        if (summaryText) content.push({ type: 'thinking', thinking: summaryText });
      } else if (item.type === 'message') {
        for (const c of item.content || []) {
          if (c.text || c.output_text) content.push({ type: 'text', text: c.text ?? c.output_text });
        }
      } else if (item.type === 'function_call') {
        content.push({ type: 'tool_use', name: item.name, input: parseToolArgsPretty(item.arguments) });
      }
    }
    return {
      streamed: false,
      model: json.model ?? null,
      stop_reason: json.status ?? null,
      usage: normUsage(json.usage),
      content,
    };
  }
  // Chat Completions 非流式
  if (json.choices) {
    const msg = json.choices[0]?.message || {};
    const content: ReassembledContentBlock[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const tc of msg.tool_calls || []) {
      content.push({ type: 'tool_use', name: tc.function?.name, input: parseToolArgsPretty(tc.function?.arguments) });
    }
    return {
      streamed: false,
      model: json.model ?? null,
      stop_reason: json.choices[0]?.finish_reason ?? null,
      usage: normUsage(json.usage),
      content,
    };
  }
  if (json.error) return emptyReassembled(json.error);
  if (json.type === 'error' && json.error) return emptyReassembled(json.error);
  return emptyReassembled();
}

function reassembleResponse(raw: string): ReassembledResponse | null {
  if (!raw) return null;
  const trimmed = raw.trimStart();

  // 非流式 JSON 响应
  if (trimmed.startsWith('{')) {
    try {
      return normalizeFinal(JSON.parse(trimmed));
    } catch {
      return emptyReassembled();
    }
  }

  let model: string | null = null;
  let stop_reason: string | null = null;
  let usage: any = {};
  let text = '';
  let reasoningText = '';
  const toolCalls: Record<string, { name: string; args: string }> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev: any;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }

    // Responses API 事件
    if (typeof ev.type === 'string' && ev.type.startsWith('response.')) {
      if (ev.type === 'response.output_text.delta') {
        text += ev.delta || '';
      } else if (ev.type === 'response.reasoning_summary_text.delta') {
        reasoningText += ev.delta || '';
      } else if (ev.type === 'response.output_text.done') {
        // text 已完成，delta 已累积
      } else if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') {
        const k = ev.output_index ?? ev.item.id ?? Object.keys(toolCalls).length;
        toolCalls[k] = { name: ev.item.name, args: '' };
      } else if (ev.type === 'response.function_call_arguments.delta') {
        const k = ev.output_index ?? ev.item_id ?? Object.keys(toolCalls).pop();
        if (toolCalls[k]) toolCalls[k].args += ev.delta || '';
      } else if (ev.type === 'response.completed' || ev.type === 'response.done') {
        model = ev.response?.model ?? model;
        stop_reason = ev.response?.status ?? stop_reason;
        if (ev.response?.usage) usage = ev.response.usage;
      } else if (ev.type === 'response.created') {
        model = ev.response?.model ?? model;
      }
      continue;
    }

    // Chat Completions chunks
    if (ev.choices) {
      model = ev.model ?? model;
      for (const ch of ev.choices) {
        if (ch.delta?.content) text += ch.delta.content;
        if (ch.finish_reason) stop_reason = ch.finish_reason;
        for (const tc of ch.delta?.tool_calls || []) {
          const k = tc.index ?? tc.id ?? 0;
          toolCalls[k] = toolCalls[k] || { name: '', args: '' };
          if (tc.function?.name) toolCalls[k].name = tc.function.name;
          if (tc.function?.arguments) toolCalls[k].args += tc.function.arguments;
        }
      }
    }
    if (ev.usage) usage = ev.usage;
  }

  const content: ReassembledContentBlock[] = [];
  if (reasoningText) content.push({ type: 'thinking', thinking: reasoningText });
  if (text) content.push({ type: 'text', text });
  for (const tc of Object.values(toolCalls)) {
    content.push({ type: 'tool_use', name: tc.name, input: parseToolArgs(tc.args) });
  }
  return { streamed: true, model, stop_reason, usage: normUsage(usage), content };
}

// ---- View / Blocks ---------------------------------------------------------

function view(body: unknown): FormatView {
  const b = (body || {}) as any;
  const tools = (b.tools || []).map(toolView);
  const toolBlocks: FormatViewBlock[] = tools.map((t: any) => ({
    kind: 'tool',
    label: `tool:${t.name}`,
    text: t.description || '',
    cache: false,
  }));

  if (isResponses(b)) {
    const system: FormatViewBlock[] = b.instructions
      ? [{ kind: 'system', label: 'instructions', text: String(b.instructions), cache: false }]
      : [];
    const input = Array.isArray(b.input) ? b.input : b.input != null ? [b.input] : [];
    const messages: FormatViewBlock[] = input.map((item: any, i: number) => {
      if (typeof item === 'string') {
        return { kind: 'message', label: `input[${i}]`, type: 'message', text: item, cache: false };
      }
      if (item.type === 'function_call') {
        return {
          kind: 'message',
          label: `input[${i}].function_call`,
          type: 'tool_use',
          name: item.name,
          text: prettyArgs(item.arguments),
          cache: false,
        };
      }
      if (item.type === 'function_call_output') {
        return {
          kind: 'message',
          label: `input[${i}].function_call_output`,
          type: 'tool_result',
          text: typeof item.output === 'string' ? item.output : JSON.stringify(item.output, null, 2),
          cache: false,
        };
      }
      if (item.type === 'reasoning') {
        const summaryText = Array.isArray(item.summary) ? item.summary.map((s: any) => s.text ?? '').join('') : flatten(item.content);
        return {
          kind: 'message',
          label: `input[${i}].reasoning`,
          type: 'reasoning',
          text: summaryText || JSON.stringify(item),
          cache: false,
        };
      }
      return {
        kind: 'message',
        label: `input[${i}].${item.role || item.type || 'item'}`,
        type: item.type || 'message',
        text: flatten(item.content) || JSON.stringify(item),
        cache: false,
      };
    });
    return { system, messages, tools: toolBlocks };
  }

  // Chat Completions
  const all: any[] = b.messages || [];
  const system: FormatViewBlock[] = all
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'system' || m.role === 'developer')
    .map(({ m, i }) => ({ kind: 'system', label: `system[${i}].${m.role}`, text: flatten(m.content), cache: false }));
  const messages: FormatViewBlock[] = all
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role !== 'system' && m.role !== 'developer')
    .flatMap(({ m, i }) => {
      // tool 结果：按 id 回填到 assistant tool_call
      if (m.role === 'tool') {
        return [
          {
            kind: 'message',
            label: `msg[${i}].tool`,
            type: 'tool_result',
            text: flatten(m.content),
            cache: false,
          },
        ];
      }
      // assistant 一轮可能带多个 tool_call，各展开一个 block
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const out: FormatViewBlock[] = [];
        const said = flatten(m.content);
        if (said) out.push({ kind: 'message', label: `msg[${i}].${m.role}`, type: 'message', text: said, cache: false });
        m.tool_calls.forEach((tc: any, ti: number) => {
          const f = tc.function || {};
          out.push({
            kind: 'message',
            label: `msg[${i}].${m.role}.tool_call[${ti}]`,
            type: 'tool_use',
            name: f.name,
            text: prettyArgs(f.arguments),
            cache: false,
          });
        });
        return out;
      }
      return [{ kind: 'message', label: `msg[${i}].${m.role}`, type: 'message', text: flatten(m.content), cache: false }];
    });
  return { system, messages, tools: toolBlocks };
}

function blocks(body: unknown): FormatViewBlock[] {
  const v = view(body);
  return [...v.system, ...v.messages, ...v.tools];
}

// ---- 估算与成本 ------------------------------------------------------------

function estimateRequestTokens(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const b = body as any;
  let s = String(b.instructions || '');
  const items = isResponses(b) ? b.input : b.messages;
  for (const it of items || []) s += typeof it === 'string' ? it : flatten(it.content);
  for (const t of b.tools || []) {
    const f = t.function || t;
    s += (f.description || '') + JSON.stringify(f.parameters || {});
  }
  return estimateTokens(s);
}

// Approximate OpenAI 定价，USD per 1M tokens（input / cached / output）
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5': { input: 1.25, cached: 0.125, output: 10 },
  codex: { input: 1.25, cached: 0.125, output: 10 },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
  'gpt-4.1': { input: 2.0, cached: 0.5, output: 8 },
  o3: { input: 2.0, cached: 0.5, output: 8 },
  mini: { input: 0.4, cached: 0.1, output: 1.6 },
};
function priceFor(model: string) {
  const m = model.toLowerCase();
  if (m.includes('codex')) return PRICES.codex;
  if (m.includes('mini')) return PRICES.mini;
  if (m.includes('gpt-5')) return PRICES['gpt-5'];
  if (m.includes('4o')) return PRICES['gpt-4o'];
  if (m.includes('4.1')) return PRICES['gpt-4.1'];
  if (m.includes('o3')) return PRICES.o3;
  return PRICES['gpt-5'];
}

function costFromUsage(model: string, usage: Usage): Cost {
  const p = priceFor(model);
  const cached = usage.cache_read_input_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached); // uncached 部分
  const output = usage.output_tokens ?? 0;
  const usd = (input * p.input + cached * p.cached + output * p.output) / 1e6;
  const totalInput = usage.input_tokens ?? 0;
  return {
    input: usage.input_tokens ?? 0,
    output,
    cacheWrite: 0,
    cacheRead: cached,
    totalInput,
    cacheHitRate: totalInput ? cached / totalInput : 0,
    usd,
  };
}

// ---- Adapter 导出 ----------------------------------------------------------

export const openaiAdapter: FormatAdapter = {
  name: 'openai',
  parseRequest: parseRequestBody,
  parseHttpError,
  reassembleResponse,
  view,
  blocks,
  estimateTokens: estimateRequestTokens,
  costFromUsage,
};
