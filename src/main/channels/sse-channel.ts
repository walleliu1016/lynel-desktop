// SSEChannel: 把 LynelEnvelope 推送给 SSE 订阅者（App / 外部）

import type { Response } from 'express';
import type { OutputChannel } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';

export class SSEChannel implements OutputChannel {
  readonly id = 'sse';
  readonly name = 'HTTP SSE';
  private enabled = true;
  private clients = new Map<string, Response[]>();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  subscribe(sessionId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const list = this.clients.get(sessionId) ?? [];
    list.push(res);
    this.clients.set(sessionId, list);
    res.on('close', () => this.unsubscribe(sessionId, res));
  }

  private unsubscribe(sessionId: string, res: Response): void {
    const list = this.clients.get(sessionId) ?? [];
    this.clients.set(sessionId, list.filter((r) => r !== res));
  }

  send(event: LynelEnvelope): void {
    if (!event.sessionId) return;
    const list = this.clients.get(event.sessionId) ?? [];
    if (!list.length) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of list) {
      try {
        res.write(data);
      } catch (err) {
        console.error('[sse-channel] write failed:', err);
      }
    }
  }

  close(): void {
    for (const list of this.clients.values()) {
      for (const res of list) {
        try {
          res.end();
        } catch { /* ignore */ }
      }
    }
    this.clients.clear();
  }
}
