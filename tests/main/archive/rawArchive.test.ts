import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeRawExchange, readRawExchange, listRawExchanges } from '../../../src/main/archive/rawArchive.js';

describe('rawArchive', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-archive-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('write + read raw exchange', () => {
    writeRawExchange({
      sessionId: 's1',
      sessionDir: tmp,
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
        body: { model: 'claude-sonnet-4-20250514' },
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
    });
    const r = readRawExchange(tmp, 1);
    expect(r).not.toBeNull();
    expect(r.seq).toBe(1);
    expect(r.error).toBe(false);
    expect(r.trace.totalMs).toBe(1050);
    // x-api-key 被 mask
    expect(r.request.headers['x-api-key']).toContain('REDACTED');
  });

  it('error=true 标记失败', () => {
    writeRawExchange({
      sessionId: 's1',
      sessionDir: tmp,
      seq: 1,
      ts: 0, startedAt: 0, firstByteAt: null, finishedAt: 100,
      model: null, format: 'anthropic',
      request: { method: 'POST', url: '/v1/messages', headers: {}, body: {} },
      response: { status: 500, headers: {}, raw: '' },
      trace: { totalMs: 100, ttftMs: 0, genMs: 0, inTps: null, outTps: null },
      reassembled: null,
      cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
      error: true,
    });
    const r = readRawExchange(tmp, 1);
    expect(r.error).toBe(true);
  });

  it('listRawExchanges 排序', () => {
    writeRawExchange({
      sessionId: 's', sessionDir: tmp, seq: 3, ts: 0, startedAt: 0, firstByteAt: null, finishedAt: 0,
      model: null, format: 'a', request: { method: 'GET', url: '/', headers: {}, body: {} },
      response: { status: 200, headers: {}, raw: '' },
      trace: { totalMs: 0, ttftMs: 0, genMs: 0, inTps: null, outTps: null },
      reassembled: null, cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
      error: false,
    });
    writeRawExchange({
      sessionId: 's', sessionDir: tmp, seq: 1, ts: 0, startedAt: 0, firstByteAt: null, finishedAt: 0,
      model: null, format: 'a', request: { method: 'GET', url: '/', headers: {}, body: {} },
      response: { status: 200, headers: {}, raw: '' },
      trace: { totalMs: 0, ttftMs: 0, genMs: 0, inTps: null, outTps: null },
      reassembled: null, cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
      error: false,
    });
    expect(listRawExchanges(tmp)).toEqual([1, 3]);
  });
});
