// SessionEvent: happy 协议 9 种事件类型，Lynel 扩展 tool-call-end
// 4.2 节表格定义

export type SessionEvent =
  | { t: 'text'; text: string; thinking?: boolean }
  | { t: 'service'; text: string }
  | { t: 'file'; ref: string; name: string; size: number; mimeType?: string; image?: { width: number; height: number; thumbhash: string } }
  | { t: 'tool-call-start'; call: string; name: string; title: string; description: string; args: Record<string, unknown> }
  | { t: 'tool-call-end'; call: string; is_error?: boolean; error?: string; result?: string }
  | { t: 'turn-start' }
  | { t: 'turn-end'; status: 'completed' | 'failed' | 'cancelled' }
  | { t: 'start'; title?: string }
  | { t: 'stop' };

export type SessionEventType = SessionEvent['t'];

// 当前阶段已实现的事件
export const ACTIVE_EVENT_TYPES: SessionEventType[] = [
  'text',
  'service',
  'tool-call-start',
  'tool-call-end',
  'turn-start',
  'turn-end',
];

// 预留事件
export const RESERVED_EVENT_TYPES: SessionEventType[] = ['file', 'start', 'stop'];

// type guard：判断 envelope 事件是否可携带 usage 字段
export function canCarryUsage(ev: SessionEvent): boolean {
  return ev.t !== 'turn-start' && ev.t !== 'turn-end' && ev.t !== 'start' && ev.t !== 'stop';
}
