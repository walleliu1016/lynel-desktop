// apiproxy.ts: 反向代理拦截 Claude API 流量
// 实时通过 SessionAdapter 生成 LynelEnvelope，响应结束后写 raw archive + happy jsonl

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { SessionAdapter, type SseEvent } from './adapter/sessionAdapter.js';
import { anthropicAdapter } from './formats/anthropic.js';
import type { FormatAdapter } from './formats/format.js';
import { type LynelEnvelope } from './protocol/envelope.js';
import { requestTiming, recordModel } from './trace/timing.js';
import { costFromUsage, type CostBreakdown } from './cost/priceTable.js';
import { HappyJsonlWriter } from './archive/happyJsonl.js';
import { writeRawExchange, listRawExchanges, type RawExchangeInput } from './archive/rawArchive.js';

export interface Proxy {
  port: number;
  setSessionID(id: string): void;
  close(): void;
}

// 旧 ProxyStageEvent 已被 LynelEnvelope 替代

interface SessionState {
  workDir: string;
  sessionDir: string;
  adapter: SessionAdapter;
  jsonl: HappyJsonlWriter;
  // 每个 HTTP roundtrip 自增（与 envelope seq 独立）
  roundtripSeq: number;
  // 响应阶段累积
  rawChunks: Buffer[];
  sseCarry: string;
  startedAt: number;
  firstByteAt: number | null;
  reqBody: Buffer | null;
  reqHeaders: Record<string, string>;
  resStatus: number;
  resHeaders: Record<string, string | string[] | undefined>;
  format: FormatAdapter;
}

const sessionStates = new Map<string, SessionState>();

export function resolveProxySession(token: string): { sessionId: string; workDir: string } | undefined {
  const s = sessionStates.get(token);
  if (!s) return undefined;
  return { sessionId: token, workDir: s.workDir };
}

export function newCallID(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sessionDirFromWorkDir(workDir: string): string {
  const safe = workDir
    .replace(/^[A-Za-z]:/, (m) => m.replace(':', '-'))
    .replace(/[/\\]/g, '--')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^--+/, '');
  return path.join(os.homedir(), '.lynel-desktop', 'projects', safe || 'root');
}

function dispatchEnvelopes(
  token: string,
  envelopes: LynelEnvelope[],
  emit: (env: LynelEnvelope) => void,
): void {
  for (const env of envelopes) {
    env.sessionId = token;
    const s = sessionStates.get(token);
    if (s) s.jsonl.append(env);
    emit(env);
  }
}

function parseSseChunk(text: string): { events: SseEvent[]; leftover: string } {
  const lines = text.split('\n');
  const leftover = lines.pop() ?? '';
  const events: SseEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data) as SseEvent);
    } catch {
      // 忽略半行/无法解析的
    }
  }
  return { events, leftover };
}

export function startProxy(
  workDir: string,
  token: string,
  emit: (env: LynelEnvelope) => void,
  format?: FormatAdapter,
  upstream = 'https://api.anthropic.com',
): Promise<Proxy> {
  const up = new URL(upstream);
  const upstreamClient = up.protocol === 'http:' ? http : https;
  const sessionDir = path.join(sessionDirFromWorkDir(workDir), token);
  const jsonl = new HappyJsonlWriter(sessionDir);
  jsonl.open();

  const existingSeqs = listRawExchanges(sessionDir)
  const initialSeq = existingSeqs.length > 0 ? Math.max(...existingSeqs) : 0

  const state: SessionState = {
    workDir,
    sessionDir,
    adapter: new SessionAdapter(),
    jsonl,
    roundtripSeq: initialSeq,
    rawChunks: [],
    sseCarry: '',
    startedAt: 0,
    firstByteAt: null,
    reqBody: null,
    reqHeaders: {},
    resStatus: 0,
    resHeaders: {},
    format: format ?? anthropicAdapter,
  };
  sessionStates.set(token, state);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const forwardPath = (up.pathname === '/' ? '' : up.pathname) + (req.url || '/');

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        const s = sessionStates.get(token);
        if (!s) return;
        s.reqBody = bodyBuf;
        s.reqHeaders = req.headers as Record<string, string>;
        s.startedAt = Date.now();
        s.firstByteAt = null;
        s.rawChunks = [];
        s.sseCarry = '';
        s.roundtripSeq += 1;

        // handleRequest
        try {
          const json = JSON.parse(bodyBuf.toString('utf8'));
          const envelopes = s.adapter.handleRequest(json);
          dispatchEnvelopes(token, envelopes, emit);
        } catch {
          // 非 JSON 请求体（如 GET）忽略
        }

        const forwardHeaders = { ...req.headers, host: up.host };
        delete (forwardHeaders as Record<string, unknown>)['accept-encoding'];
        const proxyReq = upstreamClient.request({
          protocol: up.protocol,
          hostname: up.hostname,
          port: up.port || (up.protocol === 'http:' ? 80 : 443),
          path: forwardPath,
          method: req.method,
          headers: forwardHeaders,
        }, (proxyRes) => {
          s.resStatus = proxyRes.statusCode || 0;
          s.resHeaders = proxyRes.headers as Record<string, string | string[] | undefined>;
          const contentType = (proxyRes.headers['content-type'] || '').toString();
          const isStream = contentType.includes('text/event-stream');

          res.writeHead(s.resStatus, proxyRes.headers);

          if (isStream) {
            proxyRes.on('data', (chunk: Buffer) => {
              if (s.firstByteAt == null) s.firstByteAt = Date.now();
              s.rawChunks.push(chunk);
              res.write(chunk);
              const combined = s.sseCarry + chunk.toString('utf8');
              const { events, leftover } = parseSseChunk(combined);
              s.sseCarry = leftover;
              const allEnvs: LynelEnvelope[] = [];
              for (const ev of events) {
                allEnvs.push(...s.adapter.handleSseEvent(ev));
              }
              dispatchEnvelopes(token, allEnvs, emit);
            });
          } else {
            proxyRes.on('data', (chunk: Buffer) => {
              if (s.firstByteAt == null) s.firstByteAt = Date.now();
              s.rawChunks.push(chunk);
              res.write(chunk);
            });
          }

          proxyRes.on('end', () => {
            res.end();
            // 处理 SSE 流末尾未完成行
            if (isStream && s.sseCarry.trim()) {
              const trimmed = s.sseCarry.trim();
              if (trimmed.startsWith('data:')) {
                try {
                  const ev = JSON.parse(trimmed.slice(5).trim()) as SseEvent;
                  const envs = s.adapter.handleSseEvent(ev);
                  dispatchEnvelopes(token, envs, emit);
                } catch { /* ignore */ }
              }
              s.sseCarry = '';
            }
            // HTTP 错误状态码（4xx/5xx）：生成 error envelope 推送到 channel
            if (s.resStatus >= 400) {
              // 跳过非 JSON 请求体导致的错误（如 GET 连接检查），仅记录日志
              const hadJsonBody = s.reqBody && s.reqBody.length > 0;
              if (!hadJsonBody) {
                console.log(`[apiproxy] skipped 4xx for non-JSON request: ${req.method} ${forwardPath} status=${s.resStatus}`);
              } else {
                const rawErr = Buffer.concat(s.rawChunks).toString('utf8');
                const errMsg = s.format.parseHttpError(s.resStatus, rawErr);
                const errEnvs = s.adapter.handleHttpError(errMsg);
                dispatchEnvelopes(token, errEnvs, emit);
              }
            }
            finalizeExchange(token, isStream);
          });

          proxyRes.on('error', (err: any) => {
            console.error(`[apiproxy] upstream response error: upstream=${up.href} path=${forwardPath} code=${err.code} syscall=${err.syscall} message=${err.message}`);
            if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
            res.end('apiproxy upstream error');
            const errEnvs = s.adapter.handleNetworkError(err.message);
            dispatchEnvelopes(token, errEnvs, emit);
            finalizeExchange(token, isStream, true);
          });
        });

        proxyReq.on('error', (err: any) => {
          console.error(`[apiproxy] upstream request error: upstream=${up.href} path=${forwardPath} code=${err.code} syscall=${err.syscall} hostname=${err.hostname} port=${err.port} message=${err.message}`);
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('apiproxy upstream error');
          const errEnvs = s.adapter.handleNetworkError(err.message);
          dispatchEnvelopes(token, errEnvs, emit);
          finalizeExchange(token, false, true);
        });

        proxyReq.end(bodyBuf);
      });

      req.on('error', (err) => {
        console.error('[apiproxy] client request error:', err);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      console.log(`[apiproxy] listening on 127.0.0.1:${port} upstream=${up.href} token=${token.slice(0, 8)}...`);
      resolve({
        port,
        setSessionID: () => { /* token 即 session id，无需迁移 */ },
        close: () => {
          server.close();
          const s = sessionStates.get(token);
          if (s) {
            s.jsonl.close();
            sessionStates.delete(token);
          }
        },
      });
    });

    server.once('error', reject);
  });
}

function finalizeExchange(token: string, isStream: boolean, networkError = false): void {
  const s = sessionStates.get(token);
  if (!s) return;
  const finishedAt = Date.now();
  const raw = Buffer.concat(s.rawChunks).toString('utf8');
  const errorFlag = networkError || s.resStatus >= 400;

  let reassembled: RawExchangeInput['reassembled'] = null;
  let model: string | null = null;
  const usage = { input_tokens: 0, output_tokens: 0 };
  let cost: CostBreakdown = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 };

  if (isStream) {
    const r = s.format.reassembleResponse(raw);
    if (r) {
      reassembled = {
        model: r.model,
        stop_reason: r.stop_reason,
        usage: r.usage,
        content: r.content,
      };
      model = r.model;
      usage.input_tokens = r.usage.input_tokens;
      usage.output_tokens = r.usage.output_tokens;
    }
  }

  if (!model && s.reqBody) {
    try {
      const body = JSON.parse(s.reqBody.toString('utf8'));
      model = recordModel(body, null);
    } catch { /* ignore */ }
  }

  if (model) {
    cost = costFromUsage(model, usage);
  }

  const trace = requestTiming({
    startedAt: s.startedAt,
    firstByteAt: s.firstByteAt,
    finishedAt,
    ...usage,
  }) ?? { totalMs: 0, ttftMs: 0, genMs: 0, inTps: null, outTps: null };

  let parsedBody: unknown = null;
  try {
    parsedBody = s.reqBody ? JSON.parse(s.reqBody.toString('utf8')) : null;
  } catch { /* ignore */ }

  writeRawExchange({
    sessionId: token,
    sessionDir: s.sessionDir,
    seq: s.roundtripSeq,
    ts: s.startedAt,
    startedAt: s.startedAt,
    firstByteAt: s.firstByteAt,
    finishedAt,
    model,
    format: s.format.name,
    request: {
      method: 'POST',
      url: '/v1/messages',
      headers: s.reqHeaders,
      body: parsedBody,
    },
    response: {
      status: s.resStatus,
      headers: s.resHeaders,
      raw,
    },
    trace,
    reassembled,
    cost,
    error: errorFlag,
  });
}
