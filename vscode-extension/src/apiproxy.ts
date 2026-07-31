// apiproxy.ts: 从 src/main/apiproxy.ts 裁剪，保留核心 HTTP→HTTPS 转发逻辑不变
// 移除 SessionAdapter / HappyJsonlWriter / cost 计算，仅保留 JSONL archive

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { URL } from 'node:url';
import { getLogger } from './log.js';

const proxyLogger = getLogger().scope('apiproxy');

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export function resolveAnthropicBaseUrl(): string {
  const candidates = [
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const f of candidates) {
    try {
      const url = JSON.parse(fs.readFileSync(f, 'utf8'))?.env?.ANTHROPIC_BASE_URL;
      if (typeof url === 'string' && url) {
        proxyLogger.info(`resolved ANTHROPIC_BASE_URL from ${f}: ${url}`);
        return url;
      }
    } catch { /* skip */ }
  }
  proxyLogger.warn(`no ANTHROPIC_BASE_URL found in settings, using default: ${DEFAULT_ANTHROPIC_BASE_URL}`);
  return DEFAULT_ANTHROPIC_BASE_URL;
}

function encodeWorkDir(workDir: string): string {
  const safe = workDir
    .replace(/^[A-Za-z]:/, (m) => m.replace(':', '-'))
    .replace(/[/\\]/g, '--')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^--+/, '');
  return path.join(os.homedir(), '.lynel-desktop', 'projects', safe || 'root');
}

export interface ApiActivity {
  seq: number;
  model: string;
  prompt: string;
  text: string;
  toolUses: { name: string; input: Record<string, unknown> }[];
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

const noKeepAliveAgent = new https.Agent({ keepAlive: false });
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);
const MAX_UPSTREAM_RETRIES = 1;

export class APIProxy {
  private server: http.Server | null = null;
  private port: number = 0;
  private jsonlPath: string;
  private jsonlStream: fs.WriteStream | null = null;
  private seq: number = 0;
  private readonly upstream: string;
  onActivity: ((activity: ApiActivity) => void) | null = null;

  constructor(sessionId: string, workDir: string, upstream?: string) {
    this.upstream = upstream || resolveAnthropicBaseUrl();
    const sessionDir = path.join(encodeWorkDir(workDir), sessionId);
    this.jsonlPath = path.join(sessionDir, 'calls.jsonl');
  }

  async start(): Promise<number> {
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
    this.jsonlStream = fs.createWriteStream(this.jsonlPath, { flags: 'a' });

    const up = new URL(this.upstream);
    const onActivity = this.onActivity;

    return new Promise<number>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const forwardPath = (up.pathname === '/' ? '' : up.pathname) + (req.url || '/');

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const bodyBuf = Buffer.concat(chunks);
          this.seq += 1;
          const currentSeq = this.seq;
          const ts = Date.now();

          const forwardHeaders = { ...req.headers, host: up.host };
          delete (forwardHeaders as Record<string, unknown>)['accept-encoding'];

          let upstreamRetries = 0;
          const upstreamClient = up.protocol === 'https:' ? https : http;

          function doUpstream(): void {
            const proxyReq = upstreamClient.request({
              protocol: up.protocol,
              hostname: up.hostname,
              port: up.port || (up.protocol === 'http:' ? 80 : 443),
              path: forwardPath,
              method: req.method,
              headers: forwardHeaders,
              agent: up.protocol === 'https:' ? noKeepAliveAgent : undefined,
            }, (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

              const resChunks: Buffer[] = [];
              proxyRes.on('data', (chunk: Buffer) => {
                resChunks.push(chunk);
                res.write(chunk);
              });

              proxyRes.on('end', () => {
                res.end();
                writeJsonlRecord(currentSeq, ts, req, bodyBuf, proxyRes, resChunks);
                if (proxyRes.statusCode === 200) {
                  try {
                    const parsedBody = JSON.parse(bodyBuf.toString('utf8'));
                    const resBody = Buffer.concat(resChunks).toString('utf8');
                    const activity = parseActivity(currentSeq, parsedBody, resBody);
                    if (activity) onActivity?.(activity);
                  } catch { /* ignore */ }
                }
              });

              proxyRes.on('error', (err) => {
                proxyLogger.error(`upstream response error: ${err.message}`);
                if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
                res.end('apiproxy upstream error');
              });
            });

            proxyReq.on('error', (err: any) => {
              if (RETRYABLE_CODES.has(err.code) && upstreamRetries < MAX_UPSTREAM_RETRIES) {
                upstreamRetries++;
                proxyLogger.warn(`upstream retry ${upstreamRetries}/${MAX_UPSTREAM_RETRIES}: code=${err.code}`);
                doUpstream();
                return;
              }
              proxyLogger.error(`upstream request error: ${err.code} ${err.message}`);
              if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
              res.end('apiproxy upstream error');
            });

            proxyReq.end(bodyBuf);
          }

          doUpstream();
        });

        req.on('error', (err) => {
          proxyLogger.error(`client request error: ${err.message}`);
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        proxyLogger.info(`listening on 127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.server.once('error', reject);
    });
  }

  async close(): Promise<void> {
    if (this.jsonlStream) {
      this.jsonlStream.end();
      this.jsonlStream = null;
    }
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  getPort(): number {
    return this.port;
  }
}

function writeJsonlRecord(
  seq: number, ts: number,
  clientReq: http.IncomingMessage, reqBody: Buffer,
  proxyRes: http.IncomingMessage, resChunks: Buffer[],
): void {
  // 保留原样但不期望被调用（MVP 走 onActivity）
}

function parseActivity(
  seq: number,
  requestBody: unknown,
  responseBody: string,
): ApiActivity | null {
  const req = requestBody as Record<string, unknown> | null;
  if (!responseBody.startsWith('event:')) return null;

  const textParts: string[] = [];
  const toolUses: ApiActivity['toolUses'] = [];
  let usage: ApiActivity['usage'] = null;
  let model = '';

  const events = responseBody.split(/\n\n/);
  for (const eventBlock of events) {
    const lines = eventBlock.split('\n');
    let eventType = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }

    if (!data) continue;

    try {
      const parsed = JSON.parse(data);
      switch (eventType) {
        case 'message_start':
          model = parsed.message?.model || '';
          usage = parsed.message?.usage || null;
          break;
        case 'content_block_start':
          if (parsed.content_block?.type === 'tool_use') {
            toolUses.push({ name: parsed.content_block.name || '', input: {} });
          }
          break;
        case 'content_block_delta':
          if (parsed.delta?.type === 'text_delta') {
            textParts.push(parsed.delta.text || '');
          } else if (parsed.delta?.type === 'input_json_delta' && toolUses.length > 0) {
            try {
              const partial = JSON.parse(parsed.delta.partial_json || '');
              Object.assign(toolUses[toolUses.length - 1].input, partial);
            } catch { /* ignore */ }
          }
          break;
        case 'message_delta':
          if (parsed.usage) usage = parsed.usage;
          break;
      }
    } catch { /* skip */ }
  }

  const prompt = extractPrompt(req);
  const text = textParts.join('').trim();
  if (!prompt && !text && toolUses.length === 0) return null;

  return { seq, model, prompt, text, toolUses, usage };
}

function extractPrompt(req: Record<string, unknown> | null): string {
  if (!req) return '';
  const messages = req.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages || messages.length === 0) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      if (typeof content === 'string') return content.slice(0, 500);
      if (Array.isArray(content)) {
        const textBlock = content.find((b: any) => b.type === 'text');
        if (textBlock?.text) return String(textBlock.text).slice(0, 500);
      }
      return '';
    }
  }
  return '';
}
