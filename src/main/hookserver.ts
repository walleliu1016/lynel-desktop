import express, { Request, Response } from 'express';
import http from 'node:http';
import { SSEChannel } from './channels/sse-channel.js';
import { getLogger } from './log.js';

export interface HookEvent {
  hook_event_name?: string;
  type?: string;
  session_id?: string;
  request?: any;
  tool?: string;
  tool_name?: string;
  tool_input?: any;
}

export type SendHandler = (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>;
export type EventHandler = (evt: HookEvent) => void;
export type PermissionHandler = (evt: HookEvent) => Promise<{ id: string; allowed: boolean; answers?: Record<string, string | string[]> }>;

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port = 0;
  private onSendHandler: SendHandler | null = null;
  private onEventHandler: EventHandler | null = null;
  private onPermissionHandler: PermissionHandler | null = null;
  private lastSeenMap = new Map<string, number>();
  private sseChannel?: SSEChannel;

  constructor(sseChannel?: SSEChannel) {
    this.sseChannel = sseChannel;
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
    this.app.post('/api/send', (req, res) => this.handleSend(req, res));
    this.app.get('/api/sessions/:id/calls/stream', (req, res) => {
      if (this.sseChannel) this.sseChannel.subscribe(req.params.id, res);
    });
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
      const server = this.app.listen(17527, '127.0.0.1', () => {
        const addr = server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        getLogger().info(`[hookserver] listening on http://127.0.0.1:${this.port}/hook`);
        resolve(this.port);
      });
      this.server = server;
      server.once('error', (err) => {
        getLogger().error(`[hookserver] failed to start: ${err.message}`);
        reject(err);
      });
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
      const log = getLogger().scope('hookserver');
      req.on('close', () => {
        log.info(`[PermissionRequest] client closed connection before response (sid=${sid.slice(0, 8)})`);
      });
      this.onPermissionHandler(evt).then((result) => {
        try {
          const allowed = result.allowed;
          const isAsk = evt.tool_name === 'AskUserQuestion';
          const decision: any = { behavior: allowed ? 'allow' : 'deny' };
          if (isAsk && allowed && result.answers) {
            const toolInput = evt.tool_input || {};
            const originalQuestions = (toolInput as any).questions;
            const input: any = {};
            if (originalQuestions) input.questions = originalQuestions;
            input.answers = result.answers;
            decision.updatedInput = input;
          }
          res.json({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision,
            },
          });
          log.info(`[PermissionRequest] responded ${allowed ? 'allow' : 'deny'}${isAsk ? ' (AskUserQuestion)' : ''} (sid=${sid.slice(0, 8)})`);
        } catch {
          log.info(`[PermissionRequest] response failed, client already disconnected (sid=${sid.slice(0, 8)})`);
        }
      }).catch((err) => {
        log.error(`[PermissionRequest] handler error (sid=${sid.slice(0, 8)}): ${err?.message || err}`);
        try {
          res.json({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision: {
                behavior: 'deny',
                message: 'handler error',
              },
            },
          });
        } catch {}
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
