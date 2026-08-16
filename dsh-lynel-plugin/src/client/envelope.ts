/**
 * dsh-lynel-plugin — LynelEnvelope mapping + forwarding.
 *
 * Maps the DSH session log (`SessionEvent` stream) onto the LynelEnvelope
 * event vocabulary (docs/envelope-format.md) and pushes every envelope to the
 * Lynel backend through the host proxy (`POST /lynel/proxy/envelope`).
 *
 * Mapping table:
 *   turn/start          → ev.t = 'turn-start'
 *   turn/end            → ev.t = 'turn-end', status from reason.kind
 *   user/message        → role user,  ev.t = 'text'
 *   assistant/message   → role agent, ev.t = 'text' (+ usage when present)
 *   tool/call           → role agent, ev.t = 'tool-call-start'
 *   tool/result         → role agent, ev.t = 'tool-call-end'
 *   assistant/chunk     → skipped by default (the message event carries the
 *                         assembled text); enable with includeChunks
 *   log-only events     → skipped by default (todo/write, request/header,
 *                         step/start…); enable with includeLogEvents
 *   session/subscribed  → ev.t = 'start' (reserved) once per session
 */

import type { SessionEvent } from './types';

/** SessionUsage as defined by the LynelEnvelope format. */
export interface LynelSessionUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  context_window?: number;
  service_tier?: string;
}

export type LynelEvent =
  | { t: 'text'; text: string; thinking?: boolean }
  | { t: 'service'; text: string }
  | { t: 'file'; ref: string; name: string; size: number; mimeType?: string; image?: string }
  | { t: 'tool-call-start'; call: string; name: string; title?: string; description?: string; args: unknown }
  | { t: 'tool-call-end'; call: string; is_error?: boolean; error?: string }
  | { t: 'turn-start' }
  | { t: 'turn-end'; status: 'completed' | 'failed' | 'cancelled' }
  | { t: 'start'; title?: string }
  | { t: 'stop' };

/** The LynelEnvelope wire format (docs/envelope-format.md). */
export interface LynelEnvelope {
  id: string;
  time: number;
  seq: number;
  role: 'user' | 'agent';
  sessionId?: string;
  turn?: string;
  subagent?: string;
  agent?: string;
  claudeUuid?: string;
  claudeMsgId?: string;
  usage?: LynelSessionUsage;
  ev: LynelEvent;
}

/** Forwarder knobs (defaults live here; not yet wired to config). */
export interface ForwardOptions {
  /** Emit one 'text' envelope per assistant/chunk delta. Default false. */
  includeChunks?: boolean;
  /** Emit 'service' envelopes for log-only events. Default false. */
  includeLogEvents?: boolean;
  /** Agent label stamped on envelopes. Default 'dsh'. */
  agent?: string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function readTurn(data: Record<string, unknown>): string | undefined {
  const turn = data['turn'];
  return typeof turn === 'number' ? String(turn) : typeof turn === 'string' ? turn : undefined;
}

/** Extract plain text from a `Message.content` block array (text blocks only). */
function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') parts.push(record['text']);
  }
  return parts.join('');
}

/** Map DSH TokenUsage (camelCase) onto Lynel SessionUsage (snake_case). */
function toUsage(usage: unknown): LynelSessionUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const input = record['inputTokens'];
  const output = record['outputTokens'];
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  const result: LynelSessionUsage = {
    input_tokens: typeof input === 'number' ? input : 0,
    output_tokens: typeof output === 'number' ? output : 0,
  };
  if (typeof record['cacheReadTokens'] === 'number') result.cache_read_input_tokens = record['cacheReadTokens'];
  if (typeof record['cacheWriteTokens'] === 'number') result.cache_creation_input_tokens = record['cacheWriteTokens'];
  return result;
}

/** Map `TurnEndReasonMap` kinds onto the three Lynel turn-end statuses. */
function turnEndStatus(reason: unknown): 'completed' | 'failed' | 'cancelled' {
  if (typeof reason === 'object' && reason !== null) {
    const kind = (reason as Record<string, unknown>)['kind'];
    if (kind === 'error' || kind === 'interrupted') return 'failed';
    if (kind === 'aborted' || kind === 'blocked') return 'cancelled';
  }
  return 'completed';
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ── mapping ─────────────────────────────────────────────────────────────── */

/** Map one DSH session event onto a LynelEnvelope; null = skip. */
export function toEnvelope(sessionId: string, event: SessionEvent, seq: number, options: ForwardOptions = {}): LynelEnvelope | null {
  const base = {
    id: uuid(),
    time: event.time,
    seq,
    sessionId,
    turn: readTurn(event.data),
    agent: options.agent ?? 'dsh',
  };
  const data = event.data;

  switch (event.type) {
    case 'turn/start':
      return { ...base, role: 'agent', ev: { t: 'turn-start' } };

    case 'turn/end':
      return { ...base, role: 'agent', ev: { t: 'turn-end', status: turnEndStatus(data['reason']) } };

    case 'user/message':
      return { ...base, role: 'user', ev: { t: 'text', text: contentToText(data['content']) } };

    case 'assistant/message':
      return {
        ...base,
        role: 'agent',
        ev: { t: 'text', text: contentToText(data['message']?.['content']) },
        usage: toUsage(data['usage']),
      };

    case 'assistant/chunk':
      if (!options.includeChunks) return null;
      {
        const chunk = data['chunk'] as Record<string, unknown> | undefined;
        const delta = chunk?.['delta'];
        const text = typeof delta === 'string' ? delta : (delta as Record<string, unknown> | undefined)?.['text'];
        return { ...base, role: 'agent', ev: { t: 'text', text: typeof text === 'string' ? text : '' } };
      }

    case 'tool/call':
      return {
        ...base,
        role: 'agent',
        ev: {
          t: 'tool-call-start',
          call: String(data['callId']),
          name: String(data['name']),
          title: String(data['name']),
          args: safeJsonParse(data['arguments']),
        },
      };

    case 'tool/result':
      {
        const message = data['message'] as Record<string, unknown> | undefined;
        const content = message?.['content'];
        const firstBlock = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
        // DSH carries the call id on the ToolResultBlock (`toolCallId`);
        // fall back to older shapes (`callId` on block / on event data).
        const callId =
          (typeof firstBlock?.['toolCallId'] === 'string' ? firstBlock['toolCallId'] : undefined) ??
          (typeof firstBlock?.['callId'] === 'string' ? firstBlock['callId'] : undefined) ??
          (typeof data['callId'] === 'string' ? data['callId'] : '');
        return {
          ...base,
          role: 'agent',
          ev: {
            t: 'tool-call-end',
            call: callId,
            is_error: data['error'] !== undefined || firstBlock?.['isError'] === true,
            ...(data['error'] !== undefined
              ? { error: JSON.stringify(data['error']) }
              : {}),
          },
        };
      }

    case 'todo/write':
    case 'request/header':
    case 'request/context':
    case 'session/end-seed':
    case 'step/start':
    case 'step/end':
      return options.includeLogEvents
        ? { ...base, role: 'agent', ev: { t: 'service', text: event.type } }
        : null;

    default:
      // Unknown/plugin-merged event types: forward as a service notice only
      // when marked ignorable-safe; otherwise drop (never corrupt the sink).
      return event.ignorable === true
        ? { ...base, role: 'agent', ev: { t: 'service', text: event.type } }
        : null;
  }
}

function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* ── forwarding ──────────────────────────────────────────────────────────── */

const ENVELOPE_PROXY = '/lynel/proxy/envelope';

/** Fire-and-forget push with one retry; failures are counted, never thrown. */
let droppedEnvelopes = 0;
let warnedOnce = false;

async function postEnvelope(env: LynelEnvelope): Promise<void> {
  const body = JSON.stringify(env);
  const attempt = async (): Promise<boolean> => {
    try {
      const res = await fetch(ENVELOPE_PROXY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      });
      return res.ok || res.status === 202;
    } catch {
      return false;
    }
  };
  if (await attempt()) return;
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (await attempt()) return;
  droppedEnvelopes += 1;
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn(`[dsh-lynel-plugin] envelope endpoint unreachable; ${droppedEnvelopes} envelope(s) dropped so far`);
  }
}

/**
 * Open the mux stream and forward every session event as an envelope.
 * Returns the disposer (aborts the stream + stops the loop).
 */
export function startEnvelopeForwarder(
  ctx: { connection: DshConnectionLike },
  options: ForwardOptions = {},
): () => void {
  const controller = new AbortController();
  let seq = 0;
  const startedSessions = new Set<string>();

  void (async () => {
    try {
      const stream = ctx.connection.api.events.mux({}, controller.signal);
      for await (const { payload } of stream) {
        if (payload.type === 'session/event') {
          const env = toEnvelope(payload.sessionId, payload.event, ++seq, options);
          if (env !== null) void postEnvelope(env);
        } else if (payload.type === 'session/subscribed') {
          if (!startedSessions.has(payload.sessionId)) {
            startedSessions.add(payload.sessionId);
            void postEnvelope({
              id: uuid(),
              time: Date.now(),
              seq: ++seq,
              role: 'agent',
              sessionId: payload.sessionId,
              agent: options.agent ?? 'dsh',
              ev: { t: 'start' },
            });
          }
        }
      }
    } catch {
      /* stream closed / aborted — disposer path */
    }
  })();

  return () => controller.abort();
}

/** Structural connection face (the `ctx.connection` of the DSH runtime). */
interface DshConnectionLike {
  api: {
    events: {
      mux(
        request: unknown,
        signal: AbortSignal,
      ): AsyncIterable<{
        rpcId: string;
        payload: { type: string; sessionId?: string; event?: SessionEvent; lastSeq?: number };
      }>;
    };
  };
}
