// rawArchive: 写 ccglass 风格的 raw exchange 到 <sid>/raw/<seq>.json
// 包含完整 request/response + trace + reassembled + cost + error 标记
import fs from 'node:fs';
import path from 'node:path';
import type { SessionUsage } from '../protocol/usage.js';

export interface RawExchangeInput {
  sessionId: string;
  sessionDir: string;
  seq: number;
  ts: number;
  startedAt: number;
  firstByteAt: number | null;
  finishedAt: number;
  model: string | null;
  format: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    raw: string;
  };
  trace: {
    totalMs: number;
    ttftMs: number;
    genMs: number;
    inTps: number | null;
    outTps: number | null;
  };
  reassembled: {
    model: string | null;
    stop_reason: string | null;
    usage: SessionUsage;
    content: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown> }>;
  } | null;
  cost: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    totalInput: number;
    cacheHitRate: number;
    usd: number;
  };
  error: boolean;
}

const HEADERS_TO_MASK = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie']);

function maskHeaderValue(v: string): string {
  // Bearer xxx...xxx → 保留前后 6 字符
  return v.replace(/(Bearer\s+\S{6})\S+(\S{4})/g, '$1…REDACTED…$2')
          .replace(/(sk-ant-[\w-]{6})\S+(\S{4})/g, '$1…REDACTED…$2');
}

function maskHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (HEADERS_TO_MASK.has(k.toLowerCase()) && typeof v === 'string') {
      out[k] = maskHeaderValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

export function rawArchivePath(sessionDir: string, seq: number): string {
  return path.join(sessionDir, 'raw', `${pad(seq)}.json`);
}

export function writeRawExchange(input: RawExchangeInput): string {
  const dir = path.join(input.sessionDir, 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = rawArchivePath(input.sessionDir, input.seq);
  const record = {
    id: `${input.sessionId}/${pad(input.seq)}`,
    session: input.sessionId,
    seq: input.seq,
    ts: input.ts,
    startedAt: input.startedAt,
    firstByteAt: input.firstByteAt ?? input.finishedAt,
    finishedAt: input.finishedAt,
    format: input.format,
    model: input.model,
    request: {
      ...input.request,
      headers: maskHeaders(input.request.headers),
    },
    response: {
      status: input.response.status,
      headers: maskHeaders(input.response.headers),
      raw: input.response.raw,
    },
    trace: input.trace,
    reassembled: input.reassembled,
    cost: input.cost,
    error: input.error,
  };
  // 原子写入
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, filePath);
  return filePath;
}

export function readRawExchange(sessionDir: string, seq: number): any | null {
  const filePath = rawArchivePath(sessionDir, seq);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listRawExchanges(sessionDir: string): number[] {
  const dir = path.join(sessionDir, 'raw');
  if (!fs.existsSync(dir)) return [];
  const out: number[] = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d+)\.json$/);
    if (m) out.push(parseInt(m[1], 10));
  }
  return out.sort((a, b) => a - b);
}
