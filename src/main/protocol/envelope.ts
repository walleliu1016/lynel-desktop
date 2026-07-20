import { randomUUID } from 'node:crypto';
import type { SessionUsage } from './usage.js';
import type { SessionEvent } from './events.js';

export interface SessionEnvelope {
  id: string;
  time: number;
  role: 'user' | 'agent';
  sessionId?: string;
  turn?: string;
  subagent?: string;
  claudeUuid?: string;
  claudeMsgId?: string;
  usage?: SessionUsage;
  ev: SessionEvent;
}

export interface LynelEnvelope extends SessionEnvelope {
  seq: number;
  agent?: string;
}

export type CreateEnvelopeOptions = {
  id?: string;
  time?: number;
  sessionId?: string;
  turn?: string;
  subagent?: string;
  claudeUuid?: string;
  claudeMsgId?: string;
  usage?: SessionUsage;
  seq: number;
  agent?: string;
};

export function createEnvelope(
  role: 'user' | 'agent',
  ev: SessionEvent,
  opts: CreateEnvelopeOptions,
): LynelEnvelope {
  const env: LynelEnvelope = {
    id: opts.id ?? randomUUID(),
    time: opts.time ?? Date.now(),
    role,
    seq: opts.seq,
    ev,
  };
  if (opts.sessionId) env.sessionId = opts.sessionId;
  if (opts.turn) env.turn = opts.turn;
  if (opts.subagent) env.subagent = opts.subagent;
  if (opts.claudeUuid) env.claudeUuid = opts.claudeUuid;
  if (opts.claudeMsgId) env.claudeMsgId = opts.claudeMsgId;
  if (opts.usage) env.usage = opts.usage;
  if (opts.agent) env.agent = opts.agent;
  return env;
}

export function stripEnvelope(env: LynelEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = { id: env.id, time: env.time, role: env.role, seq: env.seq, ev: env.ev };
  if (env.sessionId !== undefined) out.sessionId = env.sessionId;
  if (env.turn !== undefined) out.turn = env.turn;
  if (env.subagent !== undefined) out.subagent = env.subagent;
  if (env.claudeUuid !== undefined) out.claudeUuid = env.claudeUuid;
  if (env.claudeMsgId !== undefined) out.claudeMsgId = env.claudeMsgId;
  if (env.usage !== undefined) out.usage = env.usage;
  if (env.agent !== undefined) out.agent = env.agent;
  return out;
}
