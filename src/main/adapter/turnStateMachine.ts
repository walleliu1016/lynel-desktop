// Turn 状态机（5.3 节）

export interface ApiContentBlock {
  type: string;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content?: string | ApiContentBlock[];
}

export interface ApiRequest {
  model?: string;
  messages: ApiMessage[];
}

export type TurnState = {
  currentTurnId: string | null;
};

export function isTurnBoundary(request: ApiRequest): boolean {
  const last = request.messages.at(-1);
  if (!last || last.role !== 'user') return false;
  if (typeof last.content === 'string') return true;
  if (Array.isArray(last.content)) {
    return !last.content.some((b) => b.type === 'tool_result');
  }
  return false;
}

export function ensureTurn(state: TurnState, createId: () => string): string {
  if (state.currentTurnId) return state.currentTurnId;
  const id = createId();
  state.currentTurnId = id;
  return id;
}

export function closeTurn(
  state: TurnState,
  status: 'completed' | 'failed' | 'cancelled',
): { turnId: string | null; status: typeof status } | null {
  if (!state.currentTurnId) return null;
  const turnId = state.currentTurnId;
  state.currentTurnId = null;
  return { turnId, status };
}

export function forceCloseTurn(
  state: TurnState,
  status: 'completed' | 'failed' | 'cancelled',
): { turnId: string | null; status: typeof status } | null {
  return closeTurn(state, status);
}
