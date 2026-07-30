import express, { Request, Response } from 'express';
import http from 'node:http';
import type { PermissionBroker } from './permission-broker.js';

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port: number = 0;
  private permissionBroker: PermissionBroker;

  constructor(permissionBroker: PermissionBroker) {
    this.permissionBroker = permissionBroker;
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  getPort(): number { return this.port; }

  private async handleHook(req: Request, res: Response): Promise<void> {
    const body = req.body;
    // Permission hook: 委托给 PermissionBroker
    if (body.type === 'permission' || body.hook_event_name === 'PermissionRequest') {
      const result = await this.permissionBroker.wait({
        id: body.session_id + '::' + (body.tool_name || 'unknown'),
        sessionId: body.session_id,
        workDir: body.work_dir || process.cwd(),
        toolName: body.tool_name || 'unknown',
        toolInput: body.tool_input || body.request || {},
      });
      res.json({
        decision: result.decision,
        answers: result.answers,
      });
      return;
    }
    // 其他 hook: 直接允许
    res.json({ allowed: true });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }
}
