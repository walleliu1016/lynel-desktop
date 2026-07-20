// SessionAdapter: 把 Anthropic SSE + 请求 body 映射为 happy LynelEnvelope 流
// 对应 spec 5.2 映射表 + 5.5 错误感知

import { randomUUID } from 'node:crypto';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { createEnvelope } from '../protocol/envelope.js';
import type { SessionEvent } from '../protocol/events.js';
import { makeUsage, type SessionUsage } from '../protocol/usage.js';
import {
  type TurnState,
  type ApiRequest,
  ensureTurn,
  closeTurn,
  isTurnBoundary,
} from './turnStateMachine.js';
import { ToolTracker } from './toolLifecycle.js';
import { extractToolResults, extractUserText, type ParsedToolResult } from './requestParser.js';
import { attachUsageToLast } from './usageAttacher.js';

// Anthropic SSE 事件类型（3.2 节）
export type SseEvent =
  | { type: 'message_start'; message: { id: string; usage: { input_tokens: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text' | 'thinking' | 'tool_use'; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta' | 'thinking_delta' | 'input_json_delta'; text?: string; thinking?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

export interface SessionAdapterState {
  turn: TurnState;
  toolTracker: ToolTracker;
  // 累积当前响应中的 content blocks（index -> {type, data}）
  currentBlocks: Map<number, { type: 'text' | 'thinking'; data: string }>;
  currentMessageId: string | null;
  currentInputTokens: number;
  currentOutputTokens: number;
  stopReason: string | null;
  streamHadContent: boolean;
  seq: number;
  agent: string;
  // 当前 message 的累积 envelope 列表，供 ToolTracker 补全 args 和 usage attach
  currentMessageEnvelopes: LynelEnvelope[];
}

export class SessionAdapter {
  state: SessionAdapterState;

  constructor(agent = 'claude') {
    this.state = {
      turn: { currentTurnId: null },
      toolTracker: new ToolTracker(),
      currentBlocks: new Map(),
      currentMessageId: null,
      currentInputTokens: 0,
      currentOutputTokens: 0,
      stopReason: null,
      streamHadContent: false,
      seq: 0,
      agent,
      currentMessageEnvelopes: [],
    };
    this.state.toolTracker.setEnvelopeBuffer(this.state.currentMessageEnvelopes);
  }

  private nextSeq(): number {
    return ++this.state.seq;
  }

  private opts(turn?: string) {
    return { seq: this.nextSeq(), turn, agent: this.state.agent };
  }

  handleRequest(request: ApiRequest): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const last = request.messages.at(-1);

    // turn 边界：关闭上一 turn
    if (isTurnBoundary(request)) {
      const closed = closeTurn(this.state.turn, 'completed');
      if (closed?.turnId) {
        out.push(createEnvelope('agent', { t: 'turn-end', status: closed.status }, this.opts(closed.turnId)));
      }
    }

    // user 消息：text 或 tool_result
    if (last?.role === 'user') {
      const userText = extractUserText(last);
      if (userText) {
        out.push(createEnvelope('user', { t: 'text', text: userText }, this.opts()));
      }

      const toolResults = extractToolResults(last);
      if (toolResults.length) {
        // 确保 turn 存在（工具回填阶段）
        const turnId = ensureTurn(this.state.turn, () => randomUUID());
        for (const tr of toolResults) {
          out.push(createEnvelope(
            'agent',
            this.state.toolTracker.onToolResult(tr.tool_use_id, tr.is_error, tr.content_summary),
            this.opts(turnId),
          ));
        }
      }
    }

    return out;
  }

  handleSseEvent(event: SseEvent): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];

    switch (event.type) {
      case 'message_start': {
        this.state.currentMessageId = event.message.id;
        this.state.currentInputTokens = event.message.usage.input_tokens ?? 0;
        this.state.currentBlocks.clear();
        // 每个 message 开始时重置累积 envelope 列表（前一个 message 的 envelope 已 dispatch）
        this.state.currentMessageEnvelopes = [];
        this.state.toolTracker.setEnvelopeBuffer(this.state.currentMessageEnvelopes);
        // 懒创建 turn-start
        const turnId = ensureTurn(this.state.turn, () => randomUUID());
        const env = createEnvelope('agent', { t: 'turn-start' }, this.opts(turnId));
        this.pushEnv(out, env);
        break;
      }

      case 'content_block_start': {
        const cb = event.content_block;
        this.state.currentBlocks.set(event.index, { type: cb.type as 'text' | 'thinking', data: '' });
        if (cb.type === 'tool_use') {
          const call = cb.id ?? randomUUID();
          const env = createEnvelope('agent', {
            t: 'tool-call-start',
            call,
            name: cb.name ?? 'unknown',
            title: cb.name ?? 'tool call',
            description: '',
            args: cb.input ?? {},
          }, this.opts(this.state.turn.currentTurnId!));
          this.pushEnv(out, env);
          this.state.toolTracker.onToolUseStart(event.index, call, cb.name ?? 'unknown', this.state.currentMessageEnvelopes.length - 1);
        }
        break;
      }

      case 'content_block_delta': {
        const block = this.state.currentBlocks.get(event.index);
        const delta = event.delta;
        if (block) {
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            block.data += delta.text;
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            block.data += delta.thinking;
          }
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          this.state.toolTracker.onInputJsonDelta(event.index, delta.partial_json);
        }
        break;
      }

      case 'content_block_stop': {
        const block = this.state.currentBlocks.get(event.index);
        if (block) {
          this.state.streamHadContent = true;
          if (block.data) {
            const env = createEnvelope('agent', {
              t: 'text',
              text: block.data,
              ...(block.type === 'thinking' ? { thinking: true } : {}),
            }, this.opts(this.state.turn.currentTurnId!));
            this.pushEnv(out, env);
          }
          this.state.currentBlocks.delete(event.index);
        }
        const args = this.state.toolTracker.onToolUseStop(event.index);
        if (args) {
          this.state.streamHadContent = true;
        }
        break;
      }

      case 'message_delta': {
        this.state.currentOutputTokens = event.usage?.output_tokens ?? 0;
        this.state.stopReason = event.delta?.stop_reason ?? null;
        const usage = makeUsage({
          input_tokens: this.state.currentInputTokens,
          output_tokens: this.state.currentOutputTokens,
        });
        // 挂到累积 envelope 列表的最后一条可携带 envelope
        attachUsageToLast(this.state.currentMessageEnvelopes, 0, usage);
        break;
      }

      case 'error': {
        const err = event.error;
        const turnId = this.state.turn.currentTurnId;
        if (turnId) {
          this.pushEnv(out, createEnvelope('agent', { t: 'service', text: `**API Error**: ${err.type} - ${err.message}` }, this.opts(turnId)));
          const closed = closeTurn(this.state.turn, 'failed');
          if (closed?.turnId) {
            this.pushEnv(out, createEnvelope('agent', { t: 'turn-end', status: 'failed' }, this.opts(closed.turnId)));
          }
        }
        break;
      }

      case 'message_stop':
      default:
        break;
    }

    return out;
  }

  // 同时追加到本次返回列表和累积列表
  private pushEnv(out: LynelEnvelope[], env: LynelEnvelope): void {
    out.push(env);
    this.state.currentMessageEnvelopes.push(env);
  }

  handleHttpError(errMessage: string): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const turnId = ensureTurn(this.state.turn, () => randomUUID());
    out.push(createEnvelope('agent', { t: 'service', text: `**API Error**: ${errMessage}` }, this.opts(turnId)));
    const closed = closeTurn(this.state.turn, 'failed');
    if (closed?.turnId) {
      out.push(createEnvelope('agent', { t: 'turn-end', status: 'failed' }, this.opts(closed.turnId)));
    }
    return out;
  }

  handleNetworkError(message: string): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const turnId = ensureTurn(this.state.turn, () => randomUUID());
    out.push(createEnvelope('agent', { t: 'service', text: `**Network Error**: ${message}` }, this.opts(turnId)));
    const closed = closeTurn(this.state.turn, 'failed');
    if (closed?.turnId) {
      out.push(createEnvelope('agent', { t: 'turn-end', status: 'failed' }, this.opts(closed.turnId)));
    }
    return out;
  }

  forceCloseTurn(status: 'completed' | 'failed' | 'cancelled'): LynelEnvelope[] {
    const out: LynelEnvelope[] = [];
    const closed = closeTurn(this.state.turn, status);
    if (closed?.turnId) {
      out.push(createEnvelope('agent', { t: 'turn-end', status: closed.status }, this.opts(closed.turnId)));
    }
    return out;
  }

  streamHadContent(): boolean {
    return this.state.streamHadContent;
  }
}
