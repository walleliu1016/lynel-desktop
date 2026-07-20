// OutputChannel: 消费 LynelEnvelope（来自 apiproxy）
// HookChannel: 消费 HookEvent（来自 hookserver）
// 两个通道独立，hook 审批不混入 apiproxy

import type { LynelEnvelope } from '../protocol/envelope.js';

export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: LynelEnvelope): Promise<void> | void;
  close?(): Promise<void> | void;
  updateConfig?(cfg: unknown): void;
}

// 来自 hookserver 的事件，不走 apiproxy
export interface HookEventLike {
  kind: 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'Stop'
      | 'PermissionRequest' | 'PermissionResolved' | 'PreToolUse' | 'PostToolUse';
  sessionId: string;
  workDir: string;
  payload: Record<string, unknown>;
}

export interface HookChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  sendHook(event: HookEventLike): Promise<void> | void;
  close?(): Promise<void> | void;
}
