import type { OutputChannel, ProxyStageEvent } from './channel.js';

export interface StateChannelCallbacks {
  onStableState: (
    sessionId: string,
    state: 'idle' | 'running' | 'awaiting_permission' | 'done',
    persist?: boolean,
  ) => void;
  onActivity: (
    sessionId: string,
    activity: {
      phase: 'thinking' | 'working' | 'streaming' | 'idle' | 'awaiting_permission';
      tool?: string;
      toolInput?: string;
    },
  ) => void;
}

export class StateChannel implements OutputChannel {
  readonly id = 'state';
  readonly name = 'Session State';

  // 跟踪各 session 当前是否有待处理权限，防止 response_complete 覆盖 awaiting_permission
  private pendingPermission = new Set<string>();

  constructor(private callbacks: StateChannelCallbacks) {}

  isEnabled(): boolean {
    return true;
  }

  send(event: ProxyStageEvent): void {
    const { sessionId, kind, payload } = event;
    if (!sessionId) return;

    switch (kind) {
      case 'prompt':
        this.callbacks.onStableState(sessionId, 'running', true);
        this.callbacks.onActivity(sessionId, { phase: 'thinking' });
        break;
      case 'thinking':
        this.callbacks.onActivity(sessionId, { phase: 'thinking' });
        break;
      case 'text':
        this.callbacks.onActivity(sessionId, { phase: 'streaming' });
        break;
      case 'tool_use': {
        const p = (payload || {}) as Record<string, unknown>;
        const tool = String(p.name || '');
        const input = typeof p.input === 'object' && p.input !== null ? (p.input as Record<string, unknown>) : {};
        this.callbacks.onActivity(sessionId, {
          phase: 'working',
          tool,
          toolInput: String(input.command || input.file_path || input.pattern || input.url || input.query || ''),
        });
        break;
      }
      case 'tool_result':
        this.callbacks.onActivity(sessionId, { phase: 'thinking' });
        break;
      case 'response_complete':
      case 'session_idle':
      case 'SessionEnd': {
        // 如果有待处理的权限请求，不覆盖为 idle，保持 awaiting_permission
        if (this.pendingPermission.has(sessionId)) break;
        this.callbacks.onStableState(sessionId, 'idle', true);
        this.callbacks.onActivity(sessionId, { phase: 'idle' });
        break;
      }
      case 'PermissionRequest': {
        this.pendingPermission.add(sessionId);
        const p = (payload || {}) as Record<string, unknown>;
        const tool = String(p.toolName || '');
        const input = typeof p.toolInput === 'object' && p.toolInput !== null ? (p.toolInput as Record<string, unknown>) : {};
        this.callbacks.onStableState(sessionId, 'awaiting_permission', false);
        this.callbacks.onActivity(sessionId, {
          phase: 'awaiting_permission',
          tool,
          toolInput: String(input.command || input.file_path || input.pattern || input.url || input.query || ''),
        });
        break;
      }
      case 'PermissionResolved':
        this.pendingPermission.delete(sessionId);
        this.callbacks.onStableState(sessionId, 'running', true);
        this.callbacks.onActivity(sessionId, { phase: 'thinking' });
        break;
      default:
        break;
    }
  }
}
