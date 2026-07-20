// StateChannel: 把 LynelEnvelope 映射为 session 状态/活动
// 同时消费 hookserver 的 HookEvent

import type { OutputChannel, HookChannel, HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';

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

export class StateChannel implements OutputChannel, HookChannel {
  readonly id = 'state';
  readonly name = 'Session State';

  private pendingPermission = new Set<string>();

  constructor(private callbacks: StateChannelCallbacks) {}

  isEnabled(): boolean {
    return true;
  }

  send(event: LynelEnvelope): void {
    if (!event.sessionId) return;
    const ev = event.ev;

    switch (ev.t) {
      case 'text': {
        if (event.role === 'user') {
          this.callbacks.onStableState(event.sessionId, 'running', true);
          this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        } else if (ev.thinking) {
          this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        } else {
          this.callbacks.onActivity(event.sessionId, { phase: 'streaming' });
        }
        break;
      }
      case 'tool-call-start': {
        const input = ev.args || {};
        const toolInput = String(
          (input as any).command ||
          (input as any).file_path ||
          (input as any).pattern ||
          (input as any).url ||
          (input as any).query ||
          ''
        );
        this.callbacks.onActivity(event.sessionId, {
          phase: 'working',
          tool: ev.name,
          toolInput,
        });
        break;
      }
      case 'tool-call-end': {
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
      case 'service': {
        this.callbacks.onActivity(event.sessionId, { phase: 'streaming' });
        break;
      }
      case 'turn-end': {
        if (this.pendingPermission.has(event.sessionId)) break;
        this.callbacks.onStableState(event.sessionId, 'idle', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'idle' });
        break;
      }
      case 'turn-start': {
        this.callbacks.onStableState(event.sessionId, 'running', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
      case 'file':
      case 'start':
      case 'stop':
      default:
        break;
    }
  }

  sendHook(event: HookEventLike): void {
    if (!event.sessionId) return;
    switch (event.kind) {
      case 'SessionStart': {
        this.callbacks.onStableState(event.sessionId, 'running', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
      case 'SessionEnd':
      case 'Stop': {
        if (this.pendingPermission.has(event.sessionId)) break;
        this.callbacks.onStableState(event.sessionId, 'idle', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'idle' });
        break;
      }
      case 'UserPromptSubmit': {
        this.callbacks.onStableState(event.sessionId, 'running', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
      case 'PreToolUse': {
        const tool = (event.payload.toolName as string) || '';
        const input = (event.payload.toolInput as Record<string, unknown>) || {};
        const toolInput = String(
          (input as any).command ||
          (input as any).file_path ||
          (input as any).pattern ||
          (input as any).url ||
          (input as any).query ||
          ''
        );
        this.callbacks.onActivity(event.sessionId, {
          phase: 'working',
          tool,
          toolInput,
        });
        break;
      }
      case 'PostToolUse': {
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
      case 'PermissionRequest': {
        this.pendingPermission.add(event.sessionId);
        const tool = (event.payload.toolName as string) || '';
        const input = (event.payload.toolInput as Record<string, unknown>) || {};
        const toolInput = String(
          (input as any).command ||
          (input as any).file_path ||
          (input as any).pattern ||
          (input as any).url ||
          (input as any).query ||
          ''
        );
        this.callbacks.onStableState(event.sessionId, 'awaiting_permission', false);
        this.callbacks.onActivity(event.sessionId, {
          phase: 'awaiting_permission',
          tool,
          toolInput,
        });
        break;
      }
      case 'PermissionResolved': {
        this.pendingPermission.delete(event.sessionId);
        this.callbacks.onStableState(event.sessionId, 'running', true);
        this.callbacks.onActivity(event.sessionId, { phase: 'thinking' });
        break;
      }
    }
  }
}
