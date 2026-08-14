// OpenAiSessionAdapter: 把 OpenAI Responses API / Chat Completions 的 SSE + 请求 body 映射为 LynelEnvelope 流。
// 供 codex（/responses）、opencode/omp（/chat/completions）使用，解决这些 agent 无企微推送/无 trace 的问题。
// 复用 openaiAdapter.parseRequest 提取用户文本与 tool_result；流式期间缓冲 text/thinking/tool 参数，
// 在响应完成（response.completed / finish_reason）时一次性 flush 为 envelope。

import { randomUUID } from 'node:crypto';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { createEnvelope } from '../protocol/envelope.js';
import { ensureTurn, closeTurn, type TurnState } from './turnStateMachine.js';
import { openaiAdapter } from '../formats/openai.js';

interface PendingToolCall {
  call: string;
  name: string;
  args: string;
  envelope: LynelEnvelope; // tool-call-start 占位；flush 时补全 args 后 dispatch
}

interface OpenAiAdapterState {
  turn: TurnState;
  seq: number;
  agent: string;
  // 当前响应流缓冲
  text: string;
  thinking: string;
  toolCalls: Map<number, PendingToolCall>;
  turnStartEmitted: boolean;
  streamHadContent: boolean;
}

function isResponsesEvent(ev: any): boolean {
  return typeof ev?.type === 'string' && ev.type.startsWith('response.');
}
function isChatChunk(ev: any): boolean {
  return Array.isArray(ev?.choices);
}

function prettyArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : { _raw: String(raw) };
  } catch {
    return { _raw: String(raw) };
  }
}

// 判断当前请求是否为「工具回填轮」：Responses 的 input 以 function_call_output 结尾，
// 或 Chat Completions 的 messages 以 role=tool 结尾。此类请求只应回填 tool-call-end，不产生新 user 文本。
function isToolRound(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  const input = body.input;
  if (Array.isArray(input)) {
    const last = input[input.length - 1];
    return !!last && typeof last === 'object' && last.type === 'function_call_output';
  }
  const messages = body.messages;
  if (Array.isArray(messages)) {
    return messages[messages.length - 1]?.role === 'tool';
  }
  return false;
}

export class OpenAiSessionAdapter {
  state: OpenAiAdapterState;

  constructor(agent = 'codex') {
    this.state = {
      turn: { currentTurnId: null },
      seq: 0,
      agent,
      text: '',
      thinking: '',
      toolCalls: new Map(),
      turnStartEmitted: false,
      streamHadContent: false,
    };
  }

  private nextSeq(): number {
    return ++this.state.seq;
  }

  private opts(turn?: string) {
    return { seq: this.nextSeq(), turn, agent: this.state.agent };
  }

  private resetStream(): void {
    this.state.text = '';
    this.state.thinking = '';
    this.state.toolCalls.clear();
  }

  // 确保 turn 存在并发射 turn-start（每个 turn 仅首次）
  private beginTurn(out: LynelEnvelope[]): string {
    if (!this.state.turnStartEmitted) {
      const turnId = ensureTurn(this.state.turn, () => randomUUID());
      out.push(createEnvelope('agent', { t: 'turn-start' }, this.opts(turnId)));
      this.state.turnStartEmitted = true;
    }
    return this.state.turn.currentTurnId!;
  }

  // flush 缓冲 + 关闭 turn
  private endTurn(out: LynelEnvelope[], status: 'completed' | 'failed' | 'cancelled'): void {
    this.flushStream(out);
    this.state.turnStartEmitted = false;
    const closed = closeTurn(this.state.turn, status);
    if (closed?.turnId) {
      out.push(createEnvelope('agent', { t: 'turn-end', status }, this.opts(closed.turnId)));
    }
  }

  // 把缓冲的 thinking/text/tool-call 按序 flush 为 envelope
  private flushStream(out: LynelEnvelope[]): void {
    const turnId = this.state.turn.currentTurnId;
    if (this.state.thinking) {
      out.push(createEnvelope('agent', { t: 'text', text: this.state.thinking, thinking: true }, this.opts(turnId ?? undefined)));
      this.state.streamHadContent = true;
      this.state.thinking = '';
    }
    if (this.state.text) {
      out.push(createEnvelope('agent', { t: 'text', text: this.state.text }, this.opts(turnId ?? undefined)));
      this.state.streamHadContent = true;
      this.state.text = '';
    }
    for (const tc of this.state.toolCalls.values()) {
      (tc.envelope.ev as { args: Record<string, unknown> }).args = prettyArgs(tc.args);
      out.push(tc.envelope);
      this.state.streamHadContent = true;
    }
    this.state.toolCalls.clear();
  }

  handleRequest(request: unknown): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    // 新一轮 HTTP roundtrip，清掉可能残留的流缓冲
    this.resetStream();
    const parsed = openaiAdapter.parseRequest(request);
    if (isToolRound(request)) {
      // 工具回填轮：只回填 tool-call-end
      const turnId = ensureTurn(this.state.turn, () => randomUUID());
      for (const tr of parsed.toolResults ?? []) {
        out.push(createEnvelope(
          'agent',
          {
            t: 'tool-call-end',
            call: tr.tool_use_id,
            ...(tr.is_error ? { is_error: true, error: tr.content_summary } : {}),
            ...(tr.content_summary ? { result: tr.content_summary } : {}),
          },
          this.opts(turnId),
        ));
      }
      return out;
    }
    if (parsed.lastUserText) {
      // 新用户轮次：先关闭上一 turn
      const closed = closeTurn(this.state.turn, 'completed');
      this.state.turnStartEmitted = false;
      if (closed?.turnId) {
        out.push(createEnvelope('agent', { t: 'turn-end', status: 'completed' }, this.opts(closed.turnId)));
      }
      const turnId = ensureTurn(this.state.turn, () => randomUUID());
      out.push(createEnvelope('user', { t: 'text', text: parsed.lastUserText }, this.opts(turnId)));
    }
    return out;
  }

  handleSseEvent(event: any): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];

    if (isResponsesEvent(event)) {
      switch (event.type) {
        case 'response.created':
          this.resetStream();
          this.beginTurn(out);
          break;
        case 'response.output_text.delta':
          if (typeof event.delta === 'string') this.state.text += event.delta;
          break;
        case 'response.reasoning_summary_text.delta':
          if (typeof event.delta === 'string') this.state.thinking += event.delta;
          break;
        case 'response.output_item.added': {
          const item = event.item;
          if (item?.type === 'function_call') {
            const call = item.id ?? randomUUID();
            const name = item.name ?? 'unknown';
            this.state.toolCalls.set(event.output_index ?? this.state.toolCalls.size, {
              call,
              name,
              args: item.arguments ?? '',
              envelope: createEnvelope(
                'agent',
                { t: 'tool-call-start', call, name, title: name, description: '', args: {} },
                this.opts(this.state.turn.currentTurnId ?? undefined),
              ),
            });
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const tc = this.state.toolCalls.get(event.output_index);
          if (tc) tc.args += event.delta ?? '';
          break;
        }
        case 'response.completed':
        case 'response.done':
          if (!this.state.turn.currentTurnId) this.beginTurn(out); // 兜底：个别 provider 不发 created
          this.endTurn(out, 'completed');
          break;
        case 'response.failed':
          this.endTurn(out, 'failed');
          break;
        case 'error': {
          const msg = event.error?.message ?? event.message ?? 'unknown error';
          this.beginTurn(out);
          out.push(createEnvelope('agent', { t: 'service', text: `**API Error**: ${msg}` }, this.opts(this.state.turn.currentTurnId ?? undefined)));
          this.endTurn(out, 'failed');
          break;
        }
      }
      return out;
    }

    if (isChatChunk(event)) {
      const first = event.choices?.[0];
      if (!first) return out;
      // Chat Completions 无 created 事件，首个 chunk 即视为 turn 开始
      if (!this.state.turn.currentTurnId) this.beginTurn(out);
      if (first.delta?.content) this.state.text += first.delta.content;
      if (Array.isArray(first.delta?.tool_calls)) {
        for (const tc of first.delta.tool_calls) {
          const idx = tc.index ?? tc.id ?? this.state.toolCalls.size;
          if (!this.state.toolCalls.has(idx)) {
            const call = tc.id ?? randomUUID();
            const name = tc.function?.name ?? 'unknown';
            this.state.toolCalls.set(idx, {
              call,
              name,
              args: '',
              envelope: createEnvelope(
                'agent',
                { t: 'tool-call-start', call, name, title: name, description: '', args: {} },
                this.opts(this.state.turn.currentTurnId ?? undefined),
              ),
            });
          } else {
            const existing = this.state.toolCalls.get(idx)!;
            if (tc.function?.name) {
              existing.name = tc.function.name;
              (existing.envelope.ev as { name: string; title: string }).name = existing.name;
              (existing.envelope.ev as { name: string; title: string }).title = existing.name;
            }
          }
          if (tc.function?.arguments) this.state.toolCalls.get(idx)!.args += tc.function.arguments;
        }
      }
      if (first.finish_reason) {
        this.endTurn(out, 'completed');
      }
      return out;
    }

    return out;
  }

  handleHttpError(errMessage: string): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const turnId = ensureTurn(this.state.turn, () => randomUUID());
    if (!this.state.turnStartEmitted) out.push(createEnvelope('agent', { t: 'turn-start' }, this.opts(turnId)));
    this.state.turnStartEmitted = true;
    out.push(createEnvelope('agent', { t: 'service', text: `**API Error**: ${errMessage}` }, this.opts(turnId)));
    this.endTurn(out, 'failed');
    return out;
  }

  handleNetworkError(message: string): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const turnId = ensureTurn(this.state.turn, () => randomUUID());
    if (!this.state.turnStartEmitted) out.push(createEnvelope('agent', { t: 'turn-start' }, this.opts(turnId)));
    this.state.turnStartEmitted = true;
    out.push(createEnvelope('agent', { t: 'service', text: `**Network Error**: ${message}` }, this.opts(turnId)));
    this.endTurn(out, 'failed');
    return out;
  }

  forceCloseTurn(status: 'completed' | 'failed' | 'cancelled'): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    this.endTurn(out, status);
    return out;
  }

  streamHadContent(): boolean {
    return this.state.streamHadContent;
  }
}
