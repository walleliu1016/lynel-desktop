import { OutputChannel, ProxyStageEvent } from './channel.js';
import { Response } from 'express';

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

  send(event: ProxyStageEvent): void {
    const list = this.clients.get(event.sessionId) ?? [];
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of list) {
      res.write(data);
    }
  }
}
