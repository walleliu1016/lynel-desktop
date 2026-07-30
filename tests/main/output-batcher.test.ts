import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputBatcher } from '../../src/main/output-batcher.js';

describe('OutputBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口期内的多个 chunk 合并为一次 flush', () => {
    const flushed: Array<[string, string]> = [];
    const b = new OutputBatcher((id, data) => flushed.push([id, data]), 16);

    b.push('s1', 'a');
    b.push('s1', 'b');
    b.push('s1', 'c');
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(16);
    expect(flushed).toEqual([['s1', 'abc']]);
  });

  it('不同 session 独立合帧', () => {
    const flushed: Array<[string, string]> = [];
    const b = new OutputBatcher((id, data) => flushed.push([id, data]), 16);

    b.push('s1', 'a');
    b.push('s2', 'x');
    vi.advanceTimersByTime(16);
    expect(flushed).toEqual([
      ['s1', 'a'],
      ['s2', 'x'],
    ]);
  });

  it('flush(id) 立即发出残余数据且 timer 不再重复触发', () => {
    const flushed: Array<[string, string]> = [];
    const b = new OutputBatcher((id, data) => flushed.push([id, data]), 16);

    b.push('s1', 'a');
    b.flush('s1');
    expect(flushed).toEqual([['s1', 'a']]);

    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(1);
  });

  it('flush 后新 chunk 重新开窗口', () => {
    const flushed: Array<[string, string]> = [];
    const b = new OutputBatcher((id, data) => flushed.push([id, data]), 16);

    b.push('s1', 'a');
    vi.advanceTimersByTime(16);
    b.push('s1', 'b');
    vi.advanceTimersByTime(16);
    expect(flushed).toEqual([
      ['s1', 'a'],
      ['s1', 'b'],
    ]);
  });

  it('clear(id) 丢弃残余数据并清 timer', () => {
    const flushed: Array<[string, string]> = [];
    const b = new OutputBatcher((id, data) => flushed.push([id, data]), 16);

    b.push('s1', 'a');
    b.clear('s1');
    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(0);
  });

  it('对未知 id flush/clear 不抛异常', () => {
    const b = new OutputBatcher(() => {}, 16);
    expect(() => {
      b.flush('nope');
      b.clear('nope');
    }).not.toThrow();
  });
});
