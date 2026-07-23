// blobs.ts: content-addressed blob store
// 把 request body 中重复的大块内容（system / tools / 每个 history message）
// 单独写到 <sessionDir>/blobs/<ab>/<sha256>.json，主 manifest 只存 sha256 引用。
// 跨请求去重：同一 session 内多次请求共享同一份 system/tools/历史消息。
//
// 设计借鉴 ccglass/src/blobs.js，保持同构以便后续跨项目复用。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Anthropic 用 messages，OpenAI Responses 用 input
const HISTORY_KEYS = ['messages', 'input'];

// 进程内 blob 缓存：同 session 内 system/tools/历史消息大量跨请求共享，
// 避免 listRequests 遍历 N 个 manifest 时反复 readFileSync 同一 blob。
// LRU 上限避免无限增长；Blob 内容不可变（sha256 寻址），缓存命中即安全。
const BLOB_CACHE_MAX = 512;
const blobCache = new Map<string, unknown>();

function cacheGet(ref: string): unknown | undefined {
  const v = blobCache.get(ref);
  if (v !== undefined && blobCache.size > 1) {
    blobCache.delete(ref);
    blobCache.set(ref, v);
  }
  return v;
}

function cacheSet(ref: string, value: unknown): void {
  if (blobCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    if (oldest !== undefined) blobCache.delete(oldest);
  }
  blobCache.set(ref, value);
}

// 测试用：清空缓存
export function _clearBlobCacheForTests(): void {
  blobCache.clear();
}

export interface BlobRef {
  ref: string;
  hex: string;
  json: string;
}

export function blobRef(value: unknown): BlobRef {
  // 注意：JSON.stringify 对 key 顺序敏感，调用方需保证插入顺序稳定才能命中去重。
  const json = JSON.stringify(value);
  const hex = createHash('sha256').update(json).digest('hex');
  return { ref: `sha256:${hex}`, hex, json };
}

export function blobPath(root: string, ref: string): string {
  const hex = ref.startsWith('sha256:') ? ref.slice('sha256:'.length) : ref;
  return path.join(root, 'blobs', hex.slice(0, 2), `${hex}.json`);
}

export function writeBlob(root: string, value: unknown): string {
  const { ref, json } = blobRef(value);
  const file = blobPath(root, ref);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
  }
  return ref;
}

export function readBlob(root: string, ref: string): unknown {
  const cached = cacheGet(ref);
  if (cached !== undefined) return cached;
  const raw = fs.readFileSync(blobPath(root, ref), 'utf8');
  const value = JSON.parse(raw);
  cacheSet(ref, value);
  return value;
}

function safeBlob(root: string, ref: string): unknown {
  try {
    return readBlob(root, ref);
  } catch {
    return { __missing_blob: ref };
  }
}

// 运行时记录结构：sessionId/sessionDir 是运行时字段，
// 序列化到 manifest 时映射为 session 字段（不带 Dir 后缀）。
// 泛型允许调用方为 trace/reassembled/cost 提供具体类型，默认 unknown 保持通用。
export interface RawRecord<TReassembled = unknown, TCost = unknown, TTrace = unknown> {
  id: string;
  sessionId: string;
  sessionDir: string;
  seq: number;
  ts: number;
  startedAt: number;
  firstByteAt: number | null;
  finishedAt: number;
  format: string;
  model: string | null;
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
  trace: TTrace;
  reassembled: TReassembled;
  cost: TCost;
  error: boolean;
}

export interface PackManifest {
  v: 2;
  id: string;
  session: string;
  seq: number;
  ts: number;
  startedAt: number;
  firstByteAt: number | null;
  finishedAt: number;
  format: string;
  model: string | null;
  request: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    meta: Record<string, unknown>;
    historyKey: string | null;
    system: string | null;
    tools: string | null;
    messages: string[];
  } | {
    rawBody: unknown;
  } & Record<string, unknown>;
  response: unknown;
  trace: unknown;
  reassembled: unknown;
  cost: unknown;
  error: boolean;
}

// 把 request.body 中重复的大字段拆成 blob 引用。
// meta 保留所有标量字段（model、temperature、stream、…）。
// 非 JSON 对象的 body（字符串/null/数组）走 rawBody 旁路，原样保存。
export function packRecord<TReassembled = unknown, TCost = unknown, TTrace = unknown>(
  root: string,
  rec: RawRecord<TReassembled, TCost, TTrace>,
): PackManifest {
  const reqEnvelope = { ...(rec.request || {}) } as Record<string, unknown>;
  const body = reqEnvelope.body;
  delete reqEnvelope.body;

  const base: PackManifest = {
    v: 2,
    id: rec.id,
    session: rec.sessionId,
    seq: rec.seq,
    ts: rec.ts,
    startedAt: rec.startedAt,
    firstByteAt: rec.firstByteAt,
    finishedAt: rec.finishedAt,
    format: rec.format,
    model: rec.model,
    request: {
      method: rec.request.method,
      url: rec.request.url,
      headers: rec.request.headers,
      meta: {},
      historyKey: null,
      system: null,
      tools: null,
      messages: [],
    } as PackManifest['request'],
    response: rec.response ?? null,
    trace: rec.trace ?? null,
    reassembled: rec.reassembled ?? null,
    cost: rec.cost ?? null,
    error: rec.error ?? false,
  };

  const isObjBody = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isObjBody) {
    base.request = { ...reqEnvelope, rawBody: body ?? null } as PackManifest['request'];
    return base;
  }

  const bodyObj = body as Record<string, unknown>;
  const historyKey = HISTORY_KEYS.find((k) => Array.isArray(bodyObj[k])) ?? null;
  const meta: Record<string, unknown> = { ...bodyObj };
  delete meta.system;
  delete meta.tools;
  for (const k of HISTORY_KEYS) delete meta[k];

  const system = bodyObj.system != null ? writeBlob(root, bodyObj.system) : null;
  const tools = Array.isArray(bodyObj.tools) ? writeBlob(root, bodyObj.tools) : null;
  const messages = historyKey
    ? (bodyObj[historyKey] as unknown[]).map((m) => writeBlob(root, m))
    : [];

  base.request = {
    ...reqEnvelope,
    meta,
    historyKey,
    system,
    tools,
    messages,
  } as PackManifest['request'];

  return base;
}

// 从 v2 manifest 还原原始 record。重组后的 body key 顺序与原始不一定一致
// （meta 标量在前，system/tools/messages 在后），但 deepEqual 安全。
// 返回值 sessionDir 设为 root 调用方传入的 blob root 路径。
export function unpackRecord<TReassembled = unknown, TCost = unknown, TTrace = unknown>(
  root: string,
  manifest: PackManifest,
): RawRecord<TReassembled, TCost, TTrace> {
  const r = (manifest.request || {}) as Record<string, unknown>;
  const common = {
    id: manifest.id,
    sessionId: manifest.session,
    sessionDir: root,
    seq: manifest.seq,
    ts: manifest.ts,
    startedAt: manifest.startedAt,
    firstByteAt: manifest.firstByteAt,
    finishedAt: manifest.finishedAt,
    format: manifest.format,
    model: manifest.model,
    response: manifest.response as RawRecord<TReassembled, TCost, TTrace>['response'],
    trace: manifest.trace as TTrace,
    reassembled: manifest.reassembled as TReassembled,
    cost: manifest.cost as TCost,
    error: manifest.error,
  };

  if ('rawBody' in r) {
    const { rawBody, ...envelope } = r;
    return {
      ...common,
      request: {
        method: envelope.method as string,
        url: envelope.url as string,
        headers: envelope.headers as Record<string, string | string[] | undefined>,
        body: rawBody,
      },
    };
  }

  const { meta, historyKey, system, tools, messages, ...envelope } = r as Record<string, unknown>;
  const body: Record<string, unknown> = { ...((meta as Record<string, unknown>) || {}) };
  if (system != null) body.system = safeBlob(root, system as string);
  if (tools != null) body.tools = safeBlob(root, tools as string);
  if (historyKey) {
    body[historyKey as string] = (messages as string[] || []).map((ref) => safeBlob(root, ref));
  }

  return {
    ...common,
    request: {
      method: envelope.method as string,
      url: envelope.url as string,
      headers: envelope.headers as Record<string, string | string[] | undefined>,
      body,
    },
  };
}

// 收集 manifest 引用的所有 blob ref（system/tools/messages）。
// 用于 mark-and-sweep GC：未被任何 manifest 引用的 blob 可删除。
export function collectRefs(manifest: PackManifest, used: Set<string>): void {
  const r = (manifest.request || {}) as Record<string, unknown>;
  if (typeof r.system === 'string') used.add(r.system);
  if (typeof r.tools === 'string') used.add(r.tools);
  if (Array.isArray(r.messages)) {
    for (const ref of r.messages) {
      if (typeof ref === 'string') used.add(ref);
    }
  }
}

// Mark-and-sweep GC：扫描所有 v2 manifest，删除未被引用的 blob。
// 假定单写者：与 active capture 并发执行可能误删刚写入但 manifest 尚未 flush 的 blob
// （harmless，下次写入会重新生成）。
export function gcBlobs(root: string, listManifests: (root: string) => PackManifest[]): void {
  const used = new Set<string>();
  for (const m of listManifests(root)) {
    if (m && m.v === 2) collectRefs(m, used);
  }
  const blobsDir = path.join(root, 'blobs');
  if (!fs.existsSync(blobsDir)) return;
  for (const shard of fs.readdirSync(blobsDir)) {
    const shardDir = path.join(blobsDir, shard);
    let blobFiles: string[];
    try {
      blobFiles = fs.readdirSync(shardDir);
    } catch {
      continue;
    }
    for (const bf of blobFiles) {
      if (!bf.endsWith('.json')) continue;
      const ref = `sha256:${bf.replace(/\.json$/, '')}`;
      if (!used.has(ref)) fs.rmSync(path.join(shardDir, bf), { force: true });
    }
  }
}
