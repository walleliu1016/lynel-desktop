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
  // 来自 Claude /hook 端点的原始 body（未加工）。仅由 hookserver 派发的 hook 携带，
  // PermissionResolved 等 broker 内部合成事件无此字段。
  rawBody?: Record<string, unknown>;
}

export interface HookChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  sendHook(event: HookEventLike): Promise<void> | void;
  close?(): Promise<void> | void;
}
