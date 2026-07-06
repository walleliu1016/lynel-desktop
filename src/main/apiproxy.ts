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

export function resolveProxySession(token: string): { sessionId: string; workDir: string } | undefined {
  return proxyStore.get(token);
}

export function startProxy(
  workDir: string,
  token: string,
  dispatcher: ChannelDispatcher,
): Promise<Proxy> {
  proxyStore.set(token, { sessionId: token, workDir });
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Forward to upstream Anthropic API
      const target = new URL(req.url || '/', 'https://api.anthropic.com');
      const options: https.RequestOptions = {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.hostname },
      };

      let requestBody = '';
      req.on('data', (chunk) => { requestBody += chunk; });
      req.on('end', () => {
        try {
          const json = JSON.parse(requestBody);
          const prompt = json.messages?.[json.messages.length - 1]?.content;
          if (prompt) {
            const entry = resolveProxySession(token);
            emitStage(dispatcher, entry?.sessionId ?? token, workDir, 'prompt', { prompt }, 1);
          }
        } catch {
          // ignore non-json bodies
        }
      });

      const proxyReq = https.request(options, (proxyRes) => {
        let responseBody = '';
        proxyRes.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        proxyRes.on('end', () => {
          const lines = responseBody.split('\n').filter((l) => l.startsWith('data: '));
          for (const line of lines) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const entry = resolveProxySession(token);
              const sid = entry?.sessionId ?? token;
              const delta = parsed.delta;
              if (delta?.text) {
                emitStage(dispatcher, sid, workDir, 'text', { text: delta.text }, 1);
              }
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                emitStage(dispatcher, sid, workDir, 'tool_use', parsed.content_block, 1);
              }
            } catch {
              // ignore parse errors
            }
          }
        });

        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      req.pipe(proxyReq);
      proxyReq.on('error', (err) => {
        console.error('[apiproxy] upstream error:', err);
        res.statusCode = 502;
        res.end();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        setSessionID: (id: string) => {
          const entry = proxyStore.get(token);
          if (entry) {
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
  dispatcher.dispatch(event).catch((err) => console.error('[apiproxy] dispatch error:', err));
}
