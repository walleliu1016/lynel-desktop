import express, { Request, Response } from 'express';
import http from 'node:http';

export interface HookEvent {
  hook_event_name?: string;
  type?: string;
  session_id?: string;
  request?: any;
  tool?: string;
}

export type SendHandler = (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>;
export type EventHandler = (evt: HookEvent) => void;
export type PermissionHandler = (evt: HookEvent) => Promise<{ id: string; allowed: boolean }>;

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port = 0;
  private onSendHandler: SendHandler | null = null;
  private onEventHandler: EventHandler | null = null;
  private onPermissionHandler: PermissionHandler | null = null;
  private lastSeenMap = new Map<string, number>();

  constructor() {
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
    this.app.post('/api/send', (req, res) => this.handleSend(req, res));
  }

  onSend(handler: SendHandler): void {
    this.onSendHandler = handler;
  }

  onEvent(handler: EventHandler): void {
    this.onEventHandler = handler;
  }

  onPermissionRequest(handler: PermissionHandler): void {
    this.onPermissionHandler = handler;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(this.port);
      });
      this.server.once('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  getPort(): number {
    return this.port;
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/hook`;
  }

  lastSeen(sessionId: string): number {
    return this.lastSeenMap.get(sessionId) ?? 0;
  }

  private handleHook(req: Request, res: Response): void {
    const evt = req.body as HookEvent;
    const name = evt.hook_event_name ?? evt.type ?? 'unknown';
    const sid = evt.session_id ?? '';
    if (sid) this.lastSeenMap.set(sid, Date.now());

    if (name === 'PermissionRequest' && this.onPermissionHandler) {
      this.onPermissionHandler(evt).then((result) => {
        res.json({ id: result.id, decision: result.allowed ? 'allow' : 'deny' });
      });
      return;
    }

    if (this.onEventHandler) this.onEventHandler(evt);
    res.json({ ok: true });
  }

  private async handleSend(req: Request, res: Response): Promise<void> {
    const { session_id, prompt } = req.body;
    if (!session_id || typeof prompt !== 'string') {
      res.status(400).json({ ok: false, error: 'session_id and prompt required' });
      return;
    }
    if (!this.onSendHandler) {
      res.status(503).json({ ok: false, error: 'send handler not ready' });
      return;
    }
    const result = await this.onSendHandler(session_id, prompt);
    res.status(result.ok ? 200 : 500).json(result);
  }
}
