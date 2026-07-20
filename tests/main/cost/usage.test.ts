import { describe, it, expect } from 'vitest';
import { summarizeUsage, type RawExchange } from '../../../src/main/cost/usage.js';

function mk(over: Partial<RawExchange>): RawExchange {
  return {
    session: 's1',
    seq: 1,
    ts: 1000,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 1000, output_tokens: 100 },
    request: { body: { model: 'claude-sonnet-4-20250514' } },
    response: { status: 200 },
    ...over,
  };
}

describe('summarizeUsage', () => {
  it('空记录', () => {
    const s = summarizeUsage([]);
    expect(s.requestCount).toBe(0);
    expect(s.unmeasured).toBe(0);
  });

  it('汇总 totals + bySession + byModel', () => {
    const records: RawExchange[] = [
      mk({ session: 's1', seq: 1, ts: 1000 }),
      mk({ session: 's1', seq: 2, ts: 2000 }),
      mk({ session: 's2', seq: 1, ts: 3000 }),
    ];
    const s = summarizeUsage(records);
    expect(s.requestCount).toBe(3);
    expect(s.sessionCount).toBe(2);
    expect(s.bySession.length).toBe(2);
    expect(s.byModel.length).toBe(1);
    expect(s.totals.input).toBe(3000);
    expect(s.totals.output).toBe(300);
  });

  it('无 usage 计入 unmeasured', () => {
    const records: RawExchange[] = [
      mk({ seq: 1 }),
      { session: 's1', seq: 2, ts: 2000, model: 'x' } as any, // no usage
    ];
    const s = summarizeUsage(records);
    expect(s.unmeasured).toBe(1);
    expect(s.requestCount).toBe(1);
  });

  it('range from/to', () => {
    const records: RawExchange[] = [mk({ ts: 5000 }), mk({ ts: 1000 })];
    const s = summarizeUsage(records);
    expect(s.range.from).toBe(new Date(1000).toISOString());
    expect(s.range.to).toBe(new Date(5000).toISOString());
  });
});
