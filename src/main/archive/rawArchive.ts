// rawArchive: 写 ccglass 风格的 raw exchange 到 <sid>/raw/<seq>.json
// v2 格式：request.body 中的 system / tools / messages 拆成 content-addressed blob，
//         主 manifest 只存 sha256 引用，跨请求去重。
// v1 兼容：读取时检测 v 字段，v1 直接返回原对象（只读，不再回写）。
import fs from 'node:fs';
import path from 'node:path';
import type { SessionUsage } from '../protocol/usage.js';
import {
  packRecord,
  unpackRecord,
  type RawRecord,
  type PackManifest,
} from './blobs.js';

export interface RawExchangeTrace {
  totalMs: number;
  ttftMs: number;
  genMs: number;
  inTps: number | null;
  outTps: number | null;
}

export interface RawExchangeReassembled {
  model: string | null;
  stop_reason: string | null;
  usage: SessionUsage;
  content: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown> }>;
  error?: unknown;
}

export interface RawExchangeCost {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  totalInput: number;
  cacheHitRate: number;
  usd: number;
}

export type RawExchange = RawRecord<RawExchangeReassembled | null, RawExchangeCost, RawExchangeTrace>;

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
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    raw: string;
  };
  trace: RawExchangeTrace;
  reassembled: RawExchangeReassembled | null;
  cost: RawExchangeCost;
  error: boolean;
}

const HEADERS_TO_MASK = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie']);

function maskHeaderValue(v: string): string {
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

// blob root = sessionDir，blob 文件落到 <sessionDir>/blobs/
function blobRoot(sessionDir: string): string {
  return sessionDir;
}

export function writeRawExchange(input: RawExchangeInput): string {
  const dir = path.join(input.sessionDir, 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = rawArchivePath(input.sessionDir, input.seq);

  // mask headers 后再 pack，避免敏感信息进入 blob
  const masked: RawRecord = {
    id: `${input.sessionId}/${pad(input.seq)}`,
    sessionId: input.sessionId,
    sessionDir: input.sessionDir,
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

  const manifest = packRecord(blobRoot(input.sessionDir), masked);
  // response 在 packRecord 里整体存到 manifest.response（不进 blob，含 status/headers/raw）
  const record: PackManifest = manifest;

  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, filePath);
  return filePath;
}

// 读取并还原。v2 manifest 走 unpackRecord 重组 body；v1 旧文件原样返回。
export function readRawExchange(sessionDir: string, seq: number): RawExchange | null {
  const filePath = rawArchivePath(sessionDir, seq);
  if (!fs.existsSync(filePath)) return null;
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (raw && raw.v === 2) {
    try {
      return unpackRecord(blobRoot(sessionDir), raw as PackManifest) as RawExchange;
    } catch {
      return null;
    }
  }
  // v1 旧格式：原样返回，兼容历史数据
  return raw as RawExchange;
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
