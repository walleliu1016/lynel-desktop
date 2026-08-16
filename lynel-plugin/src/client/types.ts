/**
 * lynel-plugin — client half, structural DSH contract types.
 *
 * The client bundle only ever `require()`s `react` / `react/jsx-runtime` at
 * runtime; every DSH surface below is described structurally so the plugin
 * builds standalone (no dependency on the DSH monorepo). Shapes mirror:
 *
 *  - `@deepseek-ai/dsh-host-apiproxy/api` — MuxFrame / SessionEvent wire types
 *  - `@deepseek-ai/dsh-session/types` — the session event log vocabulary
 *  - `@deepseek-ai/dsh-client-runtime` — PendingWait, ctx.slots / ctx.effect
 *  - `@deepseek-ai/dsh-user-questions/types` — AskUserQuestionItem / answer
 *
 * Where a field is not consumed by this plugin it is deliberately omitted.
 */

/* ── cordis client context (the faces this plugin uses) ──────────────────── */

export interface DshSlots {
  /**
   * Wait for a slot declaration to land on the ledger, then run the callback.
   * Returns an idempotent disposer; the effect belongs to the caller's fiber.
   */
  inject(key: string, callback: () => unknown): () => void;
  /** Register a component (and options) into a declared slot. */
  register(options: RegisterOptions, component: unknown): unknown;
}

export interface RegisterOptions {
  /** Target slot key. */
  name: string;
  /** Chain slots: routing selector, mandatory. */
  select?: (owner: any) => unknown;
  /** Chain slots: ascending order, lower tries first (negative = before default). */
  priority?: number;
  /** List slots: unique entry id. */
  id?: string;
  /** List slots: ascending render order. */
  order?: number;
  /** List slots: display label (settings nav text etc.). */
  label?: string | (() => string);
}

export interface DshApiEvents {
  /**
   * All-session aggregated mux stream (host supports multiple concurrent
   * consumers — the runtime owns its own; this plugin opens a second one).
   * Yields `{ rpcId, payload }` per frame.
   */
  mux(request: unknown, signal: AbortSignal): AsyncIterable<MuxEnvelope>;
}

export interface DshConnection {
  api: { events: DshApiEvents };
}

export interface DshCtx {
  connection: DshConnection;
  slots: DshSlots;
  /** Run a setup callback; the returned disposer runs on fiber unload. */
  effect(setup: () => void | (() => void), label?: string): void;
}

/* ── mux stream frames (`MuxFrame` in the events domain contract) ────────── */

export interface MuxEnvelope {
  rpcId: string;
  payload: MuxFrame;
}

export type MuxFrame =
  | {
      type: 'session/event';
      sessionId: string;
      event: SessionEvent;
      view?: unknown;
    }
  | {
      type: 'session/subscribed';
      sessionId: string;
      lastSeq: number;
    }
  | {
      type: 'question/requested';
      sessionId: string;
      questions: AskQuestion[];
    }
  | {
      type: 'question/resolved';
      sessionId: string;
      questionRpcId: string;
      outcome: 'answered' | 'cancelled';
    }
  | { type: 'stream/error'; error: unknown };

/* ── session log vocabulary (`SessionEvent` from `@deepseek-ai/dsh-session`) ─ */

/** One immutable entry in the session log (fields this plugin reads). */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  ignorable?: true;
}

/* ── question protocol (`@deepseek-ai/dsh-user-questions/types`) ─────────── */

export interface AskQuestionOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: AskQuestionOption[];
  multiSelect?: boolean;
  intent?: { kind: 'plan-review'; approve: string };
}

export interface AskAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface AskAnswer {
  answers: AskAnswerItem[];
}

/**
 * The pending question carrier dispatched into `conversation.composer`
 * (the browser half of `PendingWait<'question'>`).
 */
export interface QuestionWait {
  kind: 'question';
  key: string;
  sessionId: string;
  payload: { questions: AskQuestion[] };
  /**
   * Send a result for this wait: `{ok:true, value:{sessionId, answer}}` or
   * `{ok:false, error:{code:'cancelled', message, details:{}}}`.
   */
  respond(result: {
    ok: boolean;
    value?: { sessionId: string; answer: AskAnswer };
    error?: { code: string; message: string; details: Record<string, unknown> };
  }): Promise<{ accepted: boolean; reason?: string }>;
}

/* ── the plugin's own config face (GET /lynel/config) ────────────────────── */

export interface LynelPluginConfig {
  botFile: string;
  askEndpoint: string;
  envelopeEndpoint: string;
  askTimeoutMs: number;
  envelopeTimeoutMs: number;
  maxBodyBytes: number;
}

/** bot.json document (host half mirror). */
export interface LynelBotDoc {
  bots: Array<Record<string, unknown>>;
  sessions: Record<string, string>;
}

/** Session list state face (the `useSessions` global standard kit selector). */
export interface SessionSummaryLike {
  id: string;
  displayTitle: string;
}

export interface SessionListStateLike {
  byId: Record<string, SessionSummaryLike>;
}
