import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express, { Request, Response } from 'express';
import http from 'node:http';
import { SSEChannel } from './channels/sse-channel.js';
import { getLogger } from './log.js';

const hookLogPath = path.join(os.homedir(), '.lynel-desktop', 'hooks.log');
function appendHookLog(line: string) {
  try { fs.appendFileSync(hookLogPath, line + '\n'); } catch {}
}

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
// PermissionRequest handler：rawResponse 存在时整段 hook 响应体原样返回 Claude
// （用于 cloud 透传场景）；否则按 allowed/answers 拼装 Claude 标准 decision 格式
export type PermissionHandler = (evt: HookEvent) => Promise<{
  id: string;
  allowed: boolean;
  answers?: Record<string, string | string[]>;
  rawResponse?: unknown;
}>;

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

  start(port = 17527): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, '127.0.0.1', () => {
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
    const toolName = evt.tool_name ?? '';
    const log = getLogger().scope('hookserver');

    // 完整 JSON 写文件，控制台只打关键关联字段
    const summary = toolName ? `${name}/${toolName}` : name;
    const toolUseId = (evt as any).tool_use_id || '';
    appendHookLog(`[${new Date().toISOString()}] ${name} tool_use_id=${toolUseId} sid=${sid} | ${JSON.stringify(evt)}`);
    log.info(`[hook-raw] ${summary} tool_use_id=${toolUseId} sid=${sid.slice(0, 8)}`);

    if (sid) this.lastSeenMap.set(sid, Date.now());

    // 记录所有进入的 hook
    log.info(`[hook] ← ${summary} sid=${sid.slice(0, 8)}`);

    // PreToolUse 类的 hook：把 tool_input 整个打出来，方便查看 ExitPlanMode/AskUserQuestion 这类
    // 用户决策类工具的入参 schema（plan 文本 / questions 结构等）。
    if (name === 'PreToolUse' || name === 'PermissionRequest') {
      log.info(`[hook-input] ${summary} sid=${sid.slice(0, 8)} tool_input=${JSON.stringify((evt as any).tool_input ?? null)}`);
    }

    // 监听连接状态
    let resClosed = false;
    req.on('close', () => {
      log.info(`[hook] connection closed sid=${sid.slice(0, 8)} event=${summary} headersSent=${res.headersSent}`);
    });
    req.on('error', (err) => {
      log.info(`[hook] request error sid=${sid.slice(0, 8)}: ${err.message}`);
    });
    res.on('close', () => {
      resClosed = true;
      log.info(`[hook] response closed sid=${sid.slice(0, 8)} event=${summary}`);
    });
    res.on('error', (err) => {
      resClosed = true;
      log.info(`[hook] response error sid=${sid.slice(0, 8)}: ${err.message}`);
    });
    res.on('finish', () => {
      log.info(`[hook] response finished sid=${sid.slice(0, 8)} event=${summary} status=${res.statusCode}`);
    });

    // 安全写响应，避免 EPIPE
    const safeJson = (body: any) => {
      if (resClosed || res.headersSent || res.destroyed) return;
      try { res.json(body); } catch { /* 连接已断开 */ }
    };

    if (name === 'PermissionRequest' && this.onPermissionHandler) {
      log.info(`[PermissionRequest] → broker sid=${sid.slice(0, 8)} tool=${toolName}`);
      this.onPermissionHandler(evt).then((result) => {
        try {
          // cloud 透传：原样返回 cloud 响应（Claude 期望的格式由 cloud 保证）
          if ((result as any).rawResponse !== undefined) {
            safeJson((result as any).rawResponse);
            log.info(`[PermissionRequest] → rawResponse (cloud passthrough) sid=${sid.slice(0, 8)}`);
            return;
          }
          const allowed = result.allowed;
          const isAsk = toolName === 'AskUserQuestion';
          const decision: any = { behavior: allowed ? 'allow' : 'deny' };
          if (isAsk && allowed && result.answers) {
            const toolInput = evt.tool_input || {};
            const originalQuestions = (toolInput as any).questions;
            const input: any = {};
            if (originalQuestions) input.questions = originalQuestions;
            input.answers = result.answers;
            decision.updatedInput = input;
            log.info(`[PermissionRequest] AskUserQuestion answers=${JSON.stringify(result.answers)}`);
          }
          const body = {
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision,
            },
          };
          safeJson(body);
          log.info(`[PermissionRequest] → response ${allowed ? 'allow' : 'deny'}${isAsk ? ' (AskUserQuestion)' : ''} sid=${sid.slice(0, 8)}`);
        } catch {
          log.info(`[PermissionRequest] response failed, client already disconnected sid=${sid.slice(0, 8)}`);
        }
      }).catch((err) => {
        log.error(`[PermissionRequest] handler error sid=${sid.slice(0, 8)}: ${err?.message || err}`);
        safeJson({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision: {
                behavior: 'deny',
                message: 'handler error',
              },
            },
          });
      });
      return;
    }

    // 非阻塞 hook：直接响应
    if (this.onEventHandler) this.onEventHandler(evt);
    safeJson({ ok: true });
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
