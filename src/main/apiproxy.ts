import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { ChannelDispatcher } from './channels/registry.js';
import { ProxyStageEvent } from './channels/channel.js';

export interface Proxy {
  port: number;
  setSessionID(id: string): void;
  close(): void;
}

let seqCounter = 0;
function nextSeq(): number {
  return ++seqCounter;
}

export function newCallID(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const proxyStore = new Map<string, { sessionId: string; workDir: string }>();

interface ResponseBuffer {
  text: string;
  sessionId: string;
  sse: string;
}
const responseBuffers = new Map<string, ResponseBuffer>();

export function resolveProxySession(token: string): { sessionId: string; workDir: string } | undefined {
  return proxyStore.get(token);
}

function getResponseBuffer(token: string, sessionId: string): ResponseBuffer {
  const existing = responseBuffers.get(token);
  if (existing) {
    existing.sessionId = sessionId;
    return existing;
  }
  const buffer: ResponseBuffer = { text: '', sessionId, sse: '' };
  responseBuffers.set(token, buffer);
  return buffer;
}

function appendResponseText(token: string, text: string): void {
  const entry = resolveProxySession(token);
  const sid = entry?.sessionId ?? token;
  const existing = responseBuffers.get(token);
  if (existing) {
    existing.text += text;
    existing.sessionId = sid;
  } else {
    responseBuffers.set(token, { text, sessionId: sid, sse: '' });
  }
}

function flushResponseBuffer(token: string): ResponseBuffer | undefined {
  const buffer = responseBuffers.get(token);
  if (!buffer) return undefined;
  responseBuffers.delete(token);
  return buffer;
}

function processSSEData(
  data: string,
  token: string,
  sid: string,
  dispatcher: ChannelDispatcher,
  workDir: string,
): void {
  if (data === '[DONE]') return;
  try {
    const parsed = JSON.parse(data);
    const delta = parsed.delta;
    if (delta?.text) {
      appendResponseText(token, delta.text);
      emitStage(dispatcher, sid, workDir, 'text', { text: delta.text }, 1);
    }
    if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
      emitStage(dispatcher, sid, workDir, 'tool_use', parsed.content_block, 1);
    }
  } catch {
    // ignore parse errors
  }
}

function extractPromptText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block.text)
      .join('\n');
  }
  return undefined;
}

// Claude Code 压缩恢复时注入的系统上下文，不应作为"用户输入"转发到通道
function isSystemInjectedPrompt(text: string): boolean {
  // 压缩恢复注入的 recap 提示词
  if (/The user stepped away and is coming back/i.test(text)) return true;
  if (/Recap in under \d+ words/i.test(text)) return true;
  if (/Skip root-cause narrative/i.test(text)) return true;
  // CLAUDE.md 自动生成提示
  if (/^We created CLAUDE\.md for/i.test(text)) return true;
  return false;
}

// 上一次发出的 prompt，用于去重（同一段系统上下文会在多次 API 请求中重复出现）
const lastPromptPerSession = new Map<string, string>();

function extractResponseText(parsed: any): string {
  const parts: string[] = [];
  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
}

export function startProxy(
  workDir: string,
  token: string,
  dispatcher: ChannelDispatcher,
  upstream = 'https://api.anthropic.com',
): Promise<Proxy> {
  proxyStore.set(token, { sessionId: token, workDir });
  const up = new URL(upstream);
  const upstreamClient = up.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const forwardPath = (up.pathname === '/' ? '' : up.pathname) + (req.url || '/');
      console.log(`[apiproxy] ${req.method} ${forwardPath} (token=${token.slice(0, 8)}...) upstream=${upstream}`);

      const forwardHeaders = { ...req.headers, host: up.host };
      delete forwardHeaders['accept-encoding'];
      const options: http.RequestOptions = {
        protocol: up.protocol,
        hostname: up.hostname,
        port: up.port || (up.protocol === 'http:' ? 80 : 443),
        path: forwardPath,
        method: req.method,
        headers: forwardHeaders,
      };

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => { chunks.push(chunk); });
      req.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        try {
          const json = JSON.parse(bodyBuf.toString('utf8'));
          const rawContent = json.messages?.[json.messages.length - 1]?.content;
          const prompt = extractPromptText(rawContent);
          if (prompt) {
            responseBuffers.delete(token);
            const entry = resolveProxySession(token);
            const sid = entry?.sessionId ?? token;
            if (isSystemInjectedPrompt(prompt)) {
              console.log(`[apiproxy] skip system prompt (sid=${sid.slice(0, 8)}...): ${prompt.slice(0, 80)}...`);
            } else if (lastPromptPerSession.get(sid) === prompt) {
              console.log(`[apiproxy] skip duplicate prompt (sid=${sid.slice(0, 8)}...): ${prompt.slice(0, 80)}...`);
            } else {
              lastPromptPerSession.set(sid, prompt);
              console.log(`[apiproxy] prompt detected (sid=${sid.slice(0, 8)}...): ${prompt.slice(0, 80)}...`);
              emitStage(dispatcher, sid, workDir, 'prompt', { prompt }, 1);
            }
          }
        } catch (err) {
          console.log('[apiproxy] request body is not JSON or missing messages:', err);
        }
        proxyReq.end(bodyBuf);
      });

      const proxyReq = upstreamClient.request(options, (proxyRes) => {
        const isStream = proxyRes.headers['content-type']?.includes('text/event-stream');
        console.log(`[apiproxy] upstream response ${proxyRes.statusCode} content-type=${proxyRes.headers['content-type'] ?? 'none'} (token=${token.slice(0, 8)}...)`);
        let responseBody = '';
        proxyRes.on('data', (chunk: Buffer) => {
          if (!isStream) {
            responseBody += chunk.toString();
            return;
          }
          // 流式响应增量解析 SSE，避免在响应末尾一次性处理大量数据阻塞事件循环
          const entry = resolveProxySession(token);
          const sid = entry?.sessionId ?? token;
          const buffer = getResponseBuffer(token, sid);
          buffer.sse += chunk.toString();
          const lines = buffer.sse.split('\n');
          buffer.sse = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              processSSEData(trimmed.slice(6), token, sid, dispatcher, workDir);
            }
          }
        });
        proxyRes.on('end', () => {
          const entry = resolveProxySession(token);
          const sid = entry?.sessionId ?? token;

          if (!isStream) {
            try {
              const parsed = JSON.parse(responseBody);
              const text = extractResponseText(parsed);
              if (text) {
                console.log(`[apiproxy] non-streaming response (sid=${sid.slice(0, 8)}...): ${text.slice(0, 80)}...`);
                emitStage(dispatcher, sid, workDir, 'response_complete', { text }, 1);
              }
              for (const block of parsed.content || []) {
                if (block?.type === 'tool_use') {
                  emitStage(dispatcher, sid, workDir, 'tool_use', block, 1);
                }
              }
            } catch (err) {
              console.log('[apiproxy] non-streaming response is not JSON:', err);
            }
            return;
          }

          // 处理末尾未完成的 SSE 行
          const buffer = getResponseBuffer(token, sid);
          if (buffer.sse.trim()) {
            const trimmed = buffer.sse.trim();
            if (trimmed.startsWith('data: ')) {
              processSSEData(trimmed.slice(6), token, sid, dispatcher, workDir);
            }
          }

          const flushed = flushResponseBuffer(token);
          if (flushed) {
            console.log(`[apiproxy] response_complete (stream end, sid=${flushed.sessionId.slice(0, 8)}...): ${flushed.text.slice(0, 80)}...`);
            emitStage(dispatcher, flushed.sessionId, workDir, 'response_complete', { text: flushed.text }, 1);
          }
        });

        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[apiproxy] upstream error:', err);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('apiproxy upstream error');
      });

      req.on('error', (err) => {
        console.error('[apiproxy] client request error:', err);
        proxyReq.destroy();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      console.log(`[apiproxy] listening on 127.0.0.1:${port} (token=${token.slice(0, 8)}...)`);
      resolve({
        port,
        setSessionID: (id: string) => {
          const entry = proxyStore.get(token);
          if (entry) {
            console.log(`[apiproxy] migrate token=${token.slice(0, 8)}... to sid=${id.slice(0, 8)}...`);
            proxyStore.set(token, { ...entry, sessionId: id });
          }
        },
        close: () => server.close(),
      });
    });

    server.once('error', reject);
  });
}

export function emitStage(
  dispatcher: ChannelDispatcher,
  sessionId: string,
  workDir: string,
  kind: ProxyStageEvent['kind'],
  payload: unknown,
  turn = 1,
): void {
  const event: ProxyStageEvent = {
    seq: nextSeq(),
    turn,
    sessionId,
    workDir,
    kind,
    payload,
    timestamp: Date.now(),
  };
  console.log(`[apiproxy] emit ${kind} (sid=${sessionId.slice(0, 8)}...)`);
  dispatcher.dispatch(event).catch((err) => console.error('[apiproxy] dispatch error:', err));
}
