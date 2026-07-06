export interface ProxyStageEvent {
  seq: number;
  turn: number;
  sessionId: string;
  workDir: string;
  kind: 'prompt' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  payload: unknown;
  timestamp: number;
}

export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: ProxyStageEvent): Promise<void> | void;
  close?(): Promise<void> | void;
}
