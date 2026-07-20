import { describe, it, expect } from 'vitest';
import { priceFor, costFromUsage, estimateTokens } from '../../../src/main/cost/priceTable.js';

describe('priceFor', () => {
  it('Opus 4.5+ 用新价', () => {
    const p = priceFor('claude-opus-4-5-20251101');
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  it('Opus 4.1 用旧价', () => {
    const p = priceFor('claude-opus-4-1');
    expect(p.input).toBe(15);
  });

  it('Sonnet 用 sonnet 价', () => {
    const p = priceFor('claude-sonnet-4-20250514');
    expect(p.input).toBe(3);
  });

  it('Haiku 4.5+ 用 haiku45 价', () => {
    const p = priceFor('claude-haiku-4-5-20251001');
    expect(p.input).toBe(1);
  });
});

describe('costFromUsage', () => {
  it('精确 USD', () => {
    const c = costFromUsage('claude-sonnet-4-20250514', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
    });
    expect(c.usd).toBeCloseTo(3 * 1 + 15 * 0.1, 5); // 3 + 1.5 = 4.5
  });

  it('cache hit rate', () => {
    const c = costFromUsage('claude-sonnet-4-20250514', {
      input_tokens: 500,
      output_tokens: 0,
      cache_read_input_tokens: 500,
    });
    expect(c.cacheHitRate).toBe(0.5);
  });

  it('空 usage 返回 0', () => {
    const c = costFromUsage('claude-sonnet-4-20250514', {});
    expect(c.usd).toBe(0);
    expect(c.cacheHitRate).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('空字符串', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('拉丁文', () => {
    const t = estimateTokens('hello world');
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(3);
  });

  it('CJK 字符', () => {
    const t = estimateTokens('你好世界');
    expect(t).toBeGreaterThan(0);
  });
});
