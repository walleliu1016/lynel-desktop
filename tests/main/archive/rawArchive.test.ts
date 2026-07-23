import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  writeRawExchange,
  readRawExchange,
  listRawExchanges,
  type RawExchangeInput,
} from '../../../src/main/archive/rawArchive.js';
import { _clearBlobCacheForTests, blobPath } from '../../../src/main/archive/blobs.js';

function makeInput(overrides: Partial<RawExchangeInput> = {}): RawExchangeInput {
  return {
    sessionId: 's1',
    sessionDir: '',
    seq: 1,
    ts: 1000,
    startedAt: 1050,
    firstByteAt: 2000,
    finishedAt: 2100,
    model: 'claude-sonnet-4-20250514',
    format: 'anthropic',
    request: {
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'sk-ant-1234567890abcdef' },
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: 'You are helpful.' }],
        tools: [{ name: 'bash', description: 'run shell', input_schema: {} }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ],
      },
    },
    response: {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      raw: 'data: ...',
    },
    trace: { totalMs: 1050, ttftMs: 950, genMs: 100, inTps: 10, outTps: 5 },
    reassembled: {
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: 'hi' }],
    },
    cost: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, totalInput: 100, cacheHitRate: 0, usd: 0.001 },
    error: false,
    ...overrides,
  };
}

describe('rawArchive', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-archive-'));
    _clearBlobCacheForTests();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    _clearBlobCacheForTests();
  });

  it('write + read raw exchange（v2 manifest）', () => {
    writeRawExchange({ ...makeInput(), sessionDir: tmp });
    const r = readRawExchange(tmp, 1);
    expect(r).not.toBeNull();
    expect(r!.seq).toBe(1);
    expect(r!.error).toBe(false);
    expect(r!.trace.totalMs).toBe(1050);
    // x-api-key 被 mask
    expect(r!.request.headers['x-api-key']).toContain('REDACTED');
    // body 完整还原
    expect(r!.request.body).toMatchObject({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
  });

  it('blob 文件实际生成在 <sessionDir>/blobs/', () => {
    writeRawExchange({ ...makeInput(), sessionDir: tmp });
    // manifest 文件
    expect(fs.existsSync(path.join(tmp, 'raw', '0001.json'))).toBe(true);
    // blob 目录存在
    expect(fs.existsSync(path.join(tmp, 'blobs'))).toBe(true);
    // 至少有 system / tools / message 三个 blob
    const blobFiles: string[] = [];
    for (const shard of fs.readdirSync(path.join(tmp, 'blobs'))) {
      const shardDir = path.join(tmp, 'blobs', shard);
      if (fs.statSync(shardDir).isDirectory()) {
        blobFiles.push(...fs.readdirSync(shardDir));
      }
    }
    expect(blobFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('跨请求去重：相同 system/tools/message 共享同一 blob', () => {
    // 第一次写
    writeRawExchange({ ...makeInput(), sessionDir: tmp, seq: 1 });
    // 第二次写：body 完全相同，只改 seq
    writeRawExchange({ ...makeInput(), sessionDir: tmp, seq: 2 });

    // blobs 目录下文件数应等于第一次的 blob 数（去重命中）
    const blobFiles = new Set<string>();
    const blobsDir = path.join(tmp, 'blobs');
    for (const shard of fs.readdirSync(blobsDir)) {
      const shardDir = path.join(blobsDir, shard);
      if (fs.statSync(shardDir).isDirectory()) {
        for (const f of fs.readdirSync(shardDir)) {
          blobFiles.add(f);
        }
      }
    }
    // 原始 body 产生 3 个 blob：system + tools + 1 个 message
    expect(blobFiles.size).toBe(3);

    // 两次读取都应还原出完整 body
    const r1 = readRawExchange(tmp, 1);
    const r2 = readRawExchange(tmp, 2);
    expect(r1!.request.body).toEqual(r2!.request.body);
  });

  it('不同 system/tools 产生不同 blob', () => {
    writeRawExchange({ ...makeInput(), sessionDir: tmp, seq: 1 });
    writeRawExchange({
      ...makeInput(),
      sessionDir: tmp,
      seq: 2,
      request: {
        method: 'POST',
        url: '/v1/messages',
        headers: {},
        body: {
          model: 'claude-sonnet-4-20250514',
          system: [{ type: 'text', text: 'Different system.' }],
          tools: [{ name: 'bash', description: 'run shell', input_schema: {} }],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      },
    });

    const blobFiles = new Set<string>();
    const blobsDir = path.join(tmp, 'blobs');
    for (const shard of fs.readdirSync(blobsDir)) {
      const shardDir = path.join(blobsDir, shard);
      if (fs.statSync(shardDir).isDirectory()) {
        for (const f of fs.readdirSync(shardDir)) {
          blobFiles.add(f);
        }
      }
    }
    // 不同 system → 新 blob；tools 和 message 相同 → 复用
    // 预期：1(system_v1) + 1(system_v2) + 1(tools) + 1(message) = 4
    expect(blobFiles.size).toBe(4);
  });

  it('error=true 标记失败', () => {
    writeRawExchange({
      ...makeInput(),
      sessionDir: tmp,
      error: true,
      response: { status: 500, headers: {}, raw: '' },
      reassembled: null,
    });
    const r = readRawExchange(tmp, 1);
    expect(r!.error).toBe(true);
  });

  it('listRawExchanges 排序', () => {
    writeRawExchange({ ...makeInput(), sessionDir: tmp, seq: 3 });
    writeRawExchange({ ...makeInput(), sessionDir: tmp, seq: 1 });
    expect(listRawExchanges(tmp)).toEqual([1, 3]);
  });

  it('非 JSON 对象 body 走 rawBody 旁路', () => {
    writeRawExchange({
      ...makeInput(),
      sessionDir: tmp,
      request: {
        method: 'GET',
        url: '/health',
        headers: {},
        body: 'plain-string-body',
      },
    });
    const r = readRawExchange(tmp, 1);
    expect(r!.request.body).toBe('plain-string-body');
    // 不应创建任何 blob
    expect(fs.existsSync(path.join(tmp, 'blobs'))).toBe(false);
  });

  it('v1 旧格式（无 v 字段）兼容读取', () => {
    // 手写一个 v1 格式的文件
    const v1Record = {
      id: 's1/0001',
      session: 's1',
      seq: 1,
      ts: 1000,
      startedAt: 1050,
      firstByteAt: 2000,
      finishedAt: 2100,
      format: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      request: {
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': 'sk-ant-1234567890abcdef' },
        body: { model: 'claude-sonnet-4-20250514', messages: [] },
      },
      response: { status: 200, headers: {}, raw: 'data: ...' },
      trace: { totalMs: 1050, ttftMs: 950, genMs: 100, inTps: 10, outTps: 5 },
      reassembled: null,
      cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
      error: false,
    };
    fs.mkdirSync(path.join(tmp, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'raw', '0001.json'), JSON.stringify(v1Record, null, 2));

    const r = readRawExchange(tmp, 1);
    expect(r).not.toBeNull();
    // v1 直接原样返回，未经 blob 重组
    expect(r!.request.body).toEqual({ model: 'claude-sonnet-4-20250514', messages: [] });
    // v1 未经 mask（已是历史数据），保留原值
    expect(r!.request.headers['x-api-key']).toBe('sk-ant-1234567890abcdef');
  });

  it('blob 缓存命中：第二次 readRawExchange 不再访问磁盘', () => {
    writeRawExchange({ ...makeInput(), sessionDir: tmp });
    // 第一次读会填充缓存
    const r1 = readRawExchange(tmp, 1);
    expect(r1).not.toBeNull();

    // 临时移除 blob 文件，缓存命中应仍能读出
    const blobsDir = path.join(tmp, 'blobs');
    // 先拿到 system blob 的 ref
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'raw', '0001.json'), 'utf8'));
    const systemRef = manifest.request.system;
    const systemPath = blobPath(tmp, systemRef);
    expect(fs.existsSync(systemPath)).toBe(true);
    fs.rmSync(systemPath);

    // 缓存命中：system 仍能读出
    const r2 = readRawExchange(tmp, 1);
    expect(r2!.request.body.system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
  });
});
