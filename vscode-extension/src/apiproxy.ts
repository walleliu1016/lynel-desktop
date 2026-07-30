// apiproxy.ts: 简化版 HTTP→HTTPS 代理，拦截 Claude API 流量并写 JSONL archive
// 裁剪自 src/main/apiproxy.ts，移除 SessionAdapter / channel dispatcher / SSE 解析 / cost 计算

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { URL } from 'node:url';

function encodeWorkDir(workDir: string): string {
  const safe = workDir
    .replace(/^[A-Za-z]:/, (m) => m.replace(':', '-'))
    .replace(/[/\\]/g, '--')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^--+/, '');
  return path.join(os.homedir(), '.lynel-desktop', 'projects', safe || 'root');
}

const noKeepAliveAgent = new https.Agent({ keepAlive: false });

export class APIProxy {
  private server: http.Server | null = null;
  private port: number = 0;
  private jsonlPath: string;
  private jsonlStream: fs.WriteStream | null = null;
  private seq: number = 0;
  private readonly upstream = 'https://api.anthropic.com';

  constructor(sessionId: string, workDir: string) {
    const sessionDir = path.join(encodeWorkDir(workDir), sessionId);
    this.jsonlPath = path.join(sessionDir, 'calls.jsonl');
  }

  async start(): Promise<number> {
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
    this.jsonlStream = fs.createWriteStream(this.jsonlPath, { flags: 'a' });

    return new Promise<number>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        console.log(`[apiproxy] listening on 127.0.0.1:${this.port}`);
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

  private handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const chunks: Buffer[] = [];
    clientReq.on('data', (chunk: Buffer) => chunks.push(chunk));
    clientReq.on('end', () => {
      const reqBody = Buffer.concat(chunks);
      this.seq += 1;
      const currentSeq = this.seq;
      const ts = Date.now();

      const up = new URL(this.upstream);
      const forwardPath =
        (up.pathname === '/' ? '' : up.pathname) + (clientReq.url || '/');

      // 覆盖 Host 为上游域名，删除 accept-encoding 以避免压缩
      const forwardHeaders: Record<string, string | string[] | undefined> = {
        ...(clientReq.headers as Record<string, string | string[] | undefined>),
        host: up.host,
      };
      delete forwardHeaders['accept-encoding'];

      const upstreamClient = up.protocol === 'https:' ? https : http;

      const proxyReq = upstreamClient.request(
        {
          protocol: up.protocol,
          hostname: up.hostname,
          port: up.port || (up.protocol === 'https:' ? 443 : 80),
          path: forwardPath,
          method: clientReq.method,
          headers: forwardHeaders,
          agent: up.protocol === 'https:' ? noKeepAliveAgent : undefined,
        },
        (proxyRes) => {
          clientRes.writeHead(
            proxyRes.statusCode || 200,
            proxyRes.headers as http.OutgoingHttpHeaders,
          );

          const resChunks: Buffer[] = [];

          proxyRes.on('data', (chunk: Buffer) => {
            resChunks.push(chunk);
            clientRes.write(chunk);
          });

          proxyRes.on('end', () => {
            clientRes.end();
            this.writeRecord(currentSeq, ts, clientReq, reqBody, proxyRes, resChunks);
          });

          proxyRes.on('error', (err: Error) => {
            console.error(`[apiproxy] upstream response error: ${err.message}`);
            if (!clientRes.headersSent) {
              clientRes.writeHead(502);
              clientRes.end('Proxy upstream error');
            } else {
              clientRes.end();
            }
          });
        },
      );

      proxyReq.on('error', (err: NodeJS.ErrnoException) => {
        console.error(`[apiproxy] upstream request error: ${err.message}`);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Upstream connection error');
        }
      });

      proxyReq.end(reqBody);
    });

    clientReq.on('error', (err: Error) => {
      console.error(`[apiproxy] client request error: ${err.message}`);
    });
  }

  private writeRecord(
    seq: number,
    ts: number,
    clientReq: http.IncomingMessage,
    reqBody: Buffer,
    proxyRes: http.IncomingMessage,
    resChunks: Buffer[],
  ): void {
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(reqBody.toString('utf8'));
    } catch {
      parsedBody = reqBody.toString('utf8');
    }

    const record = {
      seq,
      ts,
      request: {
        method: clientReq.method || 'GET',
        url: clientReq.url || '/',
        headers: clientReq.headers,
        body: parsedBody,
      },
      response: {
        status: proxyRes.statusCode || 0,
        headers: proxyRes.headers,
        body: Buffer.concat(resChunks).toString('utf8'),
      },
    };

    try {
      this.jsonlStream?.write(JSON.stringify(record) + '\n');
    } catch (err) {
      console.error(`[apiproxy] JSONL 写入失败: ${err}`);
    }
  }
}
