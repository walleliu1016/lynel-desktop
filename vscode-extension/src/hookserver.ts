import express, { Request, Response } from 'express';
import http from 'node:http';
import type { PermissionBroker } from './permission-broker.js';

export interface HookEvent {
  hook_event_name?: string;
  type?: string;
  session_id?: string;
  request?: any;
  tool?: string;
  tool_name?: string;
  tool_input?: any;
  work_dir?: string;
  [key: string]: any;
}

export type EventHandler = (evt: HookEvent) => void;
export type PermissionHandler = (evt: HookEvent) => Promise<{
  allowed: boolean;
  answers?: Record<string, string | string[]>;
}>;

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port: number = 0;
  private permissionBroker: PermissionBroker;
  private onEventHandler: EventHandler | null = null;
  private onPermissionHandler: PermissionHandler | null = null;

  constructor(permissionBroker: PermissionBroker) {
    this.permissionBroker = permissionBroker;
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
  }

  onEvent(handler: EventHandler): void { this.onEventHandler = handler; }
  onPermissionRequest(handler: PermissionHandler): void { this.onPermissionHandler = handler; }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this.port = addr.port;
        console.log(`[hookserver] listening on http://127.0.0.1:${this.port}/hook`);
        resolve(this.port);
      });
      this.server.once('error', reject);
    });
  }

  getPort(): number { return this.port; }

  private async handleHook(req: Request, res: Response): Promise<void> {
    const evt = req.body as HookEvent;
    const name = evt.hook_event_name ?? evt.type ?? 'unknown';
    const sid = evt.session_id ?? '';
    const toolName = evt.tool_name ?? '';

    console.log(`[hookserver] ← ${name}${toolName ? '/' + toolName : ''} sid=${sid.slice(0, 8)}`);

    // 通知事件处理器
    try { this.onEventHandler?.(evt); } catch { /* ok */ }

    // PermissionRequest: 委托给 PermissionBroker
    if (name === 'PermissionRequest') {
      try {
        const result = this.onPermissionHandler
          ? await this.onPermissionHandler(evt)
          : await this.permissionBroker.wait({
              id: sid + '::' + (toolName || 'unknown'),
              sessionId: sid,
              workDir: evt.work_dir || process.cwd(),
              toolName: toolName || 'unknown',
              toolInput: evt.tool_input || evt.request || {},
            }).then((r) => ({ allowed: r.decision === 'allow', answers: r.answers }));

        const isAsk = toolName === 'AskUserQuestion';
        const decision: any = { behavior: result.allowed ? 'allow' : 'deny' };
        if (isAsk && result.allowed && result.answers) {
          const toolInput = evt.tool_input || {};
          const originalQuestions = (toolInput as any).questions;
          const input: any = {};
          if (originalQuestions) input.questions = originalQuestions;
          input.answers = result.answers;
          decision.updatedInput = input;
        }
        res.json({
          hookSpecificOutput: { hookEventName: 'PermissionRequest', decision },
        });
      } catch (err) {
        console.error('[hookserver] PermissionRequest error:', err);
        res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: 'handler error' },
          },
        });
      }
      return;
    }

    // 其他 hook: 直接允许
    res.json({ allowed: true });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }
}
