export type ProxyStageKind =
  | 'prompt' | 'text' | 'thinking' | 'tool_use' | 'tool_result'
  | 'error' | 'PermissionRequest' | 'PermissionResolved' | 'SessionEnd'
  | 'response_complete' | 'session_start' | 'session_idle';

export interface ProxyStageEvent {
  seq: number;
  turn: number;
  sessionId: string;
  workDir: string;
  kind: ProxyStageKind;
  payload: unknown;
  timestamp: number;
}

/** 创建 hook 来源的事件（无 seq/turn） */
export function makeHookEvent(
  kind: ProxyStageKind,
  sessionId: string,
  workDir: string,
  payload: unknown,
): ProxyStageEvent {
  return {
    seq: 0,
    turn: 0,
    sessionId,
    workDir,
    kind,
    payload,
    timestamp: Date.now(),
  };
}

export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: ProxyStageEvent): Promise<void> | void;
  close?(): Promise<void> | void;
}
