import type { LynelEnvelope } from '../protocol/envelope.js';

export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: LynelEnvelope): Promise<void> | void;
  close?(): Promise<void> | void;
  updateConfig?(cfg: unknown): void;
}

export interface HookEventLike {
  kind: 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'Stop'
      | 'PermissionRequest' | 'PermissionResolved' | 'PreToolUse' | 'PostToolUse';
  sessionId: string;
  workDir: string;
  payload: Record<string, unknown>;
  rawBody?: Record<string, unknown>;
}

export interface HookChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  sendHook(event: HookEventLike): Promise<void> | void;
  close?(): Promise<void> | void;
}
