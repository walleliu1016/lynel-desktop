import { describe, it, expect } from 'vitest';
import { latencyMs, requestTiming, recordModel } from '../../../src/main/trace/timing.js';

describe('latencyMs', () => {
  it('计算 finishedAt - startedAt', () => {
    expect(latencyMs({ startedAt: 100, finishedAt: 350 })).toBe(250);
  });

  it('缺 finishedAt 返回 null', () => {
    expect(latencyMs({ startedAt: 100 })).toBe(null);
  });

  it('用 ts 兜底', () => {
    expect(latencyMs({ ts: 100, finishedAt: 350 })).toBe(250);
  });
});

describe('requestTiming', () => {
  it('完整计算', () => {
    const t = requestTiming({
      startedAt: 1000,
      firstByteAt: 2000,
      finishedAt: 3000,
      input_tokens: 100,
      output_tokens: 50,
    });
    expect(t?.totalMs).toBe(2000);
    expect(t?.ttftMs).toBe(1000);
    expect(t?.genMs).toBe(1000);
    expect(t?.inTps).toBeCloseTo(100);
    expect(t?.outTps).toBeCloseTo(50);
  });

  it('无 firstByte 用 finishedAt 兜底', () => {
    const t = requestTiming({ startedAt: 100, finishedAt: 500 });
    expect(t?.ttftMs).toBe(400);
    expect(t?.genMs).toBe(0);
  });

  it('无 token 吞吐返回 null', () => {
    const t = requestTiming({ startedAt: 100, firstByteAt: 200, finishedAt: 300 });
    expect(t?.inTps).toBe(null);
    expect(t?.outTps).toBe(null);
  });
});

describe('recordModel', () => {
  it('优先 body.model', () => {
    expect(recordModel({ model: 'sonnet-4' }, { model: 'haiku' })).toBe('sonnet-4');
  });

  it('body 没有则用 reassembled', () => {
    expect(recordModel({}, { model: 'haiku' })).toBe('haiku');
  });

  it('都没有则 null', () => {
    expect(recordModel({}, null)).toBe(null);
  });
});
