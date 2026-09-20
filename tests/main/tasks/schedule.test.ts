// tests/main/tasks/schedule.test.ts
import { describe, it, expect } from 'vitest';
import {
  presetToCron, cronToPreset, computeNextRun, describeSchedule,
  type Preset,
} from '../../../src/main/tasks/schedule.js';

describe('presetToCron', () => {
  it('每天 → M H * * *', () => {
    expect(presetToCron({ kind: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *');
    expect(presetToCron({ kind: 'daily', hour: 0, minute: 30 })).toBe('30 0 * * *');
  });

  it('每周 → M H * * 排序后的星期列表', () => {
    expect(presetToCron({ kind: 'weekly', hour: 17, minute: 0, weekdays: [5] })).toBe('0 17 * * 5');
    expect(presetToCron({ kind: 'weekly', hour: 9, minute: 30, weekdays: [5, 1, 3] })).toBe('30 9 * * 1,3,5');
    expect(presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] })).toBe('0 9 * * 1,2,3,4,5');
  });

  it('每月 → M H D * *', () => {
    expect(presetToCron({ kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 })).toBe('0 10 1 * *');
    expect(presetToCron({ kind: 'monthly', hour: 23, minute: 59, dayOfMonth: 31 })).toBe('59 23 31 * *');
  });

  it('每小时 → M * * * *', () => {
    expect(presetToCron({ kind: 'hourly', minute: 5 })).toBe('5 * * * *');
  });

  it('每 N 分钟 → */N * * * *', () => {
    expect(presetToCron({ kind: 'everyNMinutes', everyMinutes: 15 })).toBe('*/15 * * * *');
    expect(presetToCron({ kind: 'everyNMinutes', everyMinutes: 1 })).toBe('*/1 * * * *');
  });

  it('自定义直接返回表达式', () => {
    expect(presetToCron({ kind: 'custom', expression: '0 0 1 1 *' })).toBe('0 0 1 1 *');
  });

  it('参数越界抛错（表单层要拦，但纯函数也要守住）', () => {
    expect(() => presetToCron({ kind: 'daily', hour: 24, minute: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'daily', hour: 9, minute: 60 })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [] })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [7] })).toThrow();
    expect(() => presetToCron({ kind: 'monthly', hour: 9, minute: 0, dayOfMonth: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'monthly', hour: 9, minute: 0, dayOfMonth: 32 })).toThrow();
    expect(() => presetToCron({ kind: 'everyNMinutes', everyMinutes: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'everyNMinutes', everyMinutes: 60 })).toThrow();
    expect(() => presetToCron({ kind: 'custom', expression: '  ' })).toThrow();
  });
});

describe('cronToPreset', () => {
  it('认识的模板精确反查回预设', () => {
    expect(cronToPreset('0 9 * * *')).toEqual({ kind: 'daily', hour: 9, minute: 0 });
    expect(cronToPreset('30 9 * * 1,3,5')).toEqual({ kind: 'weekly', hour: 9, minute: 30, weekdays: [1, 3, 5] });
    expect(cronToPreset('0 10 1 * *')).toEqual({ kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 });
    expect(cronToPreset('5 * * * *')).toEqual({ kind: 'hourly', minute: 5 });
    expect(cronToPreset('*/15 * * * *')).toEqual({ kind: 'everyNMinutes', everyMinutes: 15 });
  });

  it('不认识的一律落 custom 并带回原表达式', () => {
    expect(cronToPreset('0 0 1 1 *')).toEqual({ kind: 'custom', expression: '0 0 1 1 *' });
    expect(cronToPreset('0 9 * * 1-5')).toEqual({ kind: 'custom', expression: '0 9 * * 1-5' });
    expect(cronToPreset('0 9 1,15 * *')).toEqual({ kind: 'custom', expression: '0 9 1,15 * *' });
  });

  it('表达式两端的空白被归一化后再匹配', () => {
    expect(cronToPreset('  0 9 * * *  ')).toEqual({ kind: 'daily', hour: 9, minute: 0 });
  });
});

describe('预设 ↔ cron 往返（覆盖全部模板）', () => {
  const cases: Preset[] = [
    { kind: 'daily', hour: 9, minute: 0 },
    { kind: 'daily', hour: 0, minute: 0 },
    { kind: 'daily', hour: 23, minute: 59 },
    { kind: 'weekly', hour: 17, minute: 0, weekdays: [5] },
    { kind: 'weekly', hour: 9, minute: 30, weekdays: [1, 3, 5] },
    { kind: 'weekly', hour: 8, minute: 0, weekdays: [0, 6] },
    { kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] },
    { kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 },
    { kind: 'monthly', hour: 23, minute: 59, dayOfMonth: 31 },
    { kind: 'monthly', hour: 0, minute: 0, dayOfMonth: 15 },
    { kind: 'hourly', minute: 0 },
    { kind: 'hourly', minute: 45 },
    { kind: 'everyNMinutes', everyMinutes: 1 },
    { kind: 'everyNMinutes', everyMinutes: 5 },
    { kind: 'everyNMinutes', everyMinutes: 59 },
  ];

  it.each(cases)('cronToPreset(presetToCron($kind)) 回到原预设', (preset) => {
    expect(cronToPreset(presetToCron(preset))).toEqual(preset);
  });

  it('所有生成的表达式都是 croner 认可的合法表达式', async () => {
    const { Cron } = await import('croner');
    for (const preset of cases) {
      const expr = presetToCron(preset);
      expect(() => new Cron(expr), `非法表达式: ${expr}`).not.toThrow();
    }
  });
});

describe('computeNextRun', () => {
  it('cron：从给定时刻往后算下一次', () => {
    const from = new Date('2026-09-18T08:00:00').getTime();
    const next = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, from)!;
    expect(new Date(next).getHours()).toBe(9);
    expect(new Date(next).getDate()).toBe(18);
  });

  it('cron：当天已过则顺延到明天', () => {
    const from = new Date('2026-09-18T10:00:00').getTime();
    const next = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, from)!;
    expect(new Date(next).getDate()).toBe(19);
    expect(new Date(next).getHours()).toBe(9);
  });

  it('once：未来时间返回该时间戳', () => {
    const from = 1000;
    expect(computeNextRun({ type: 'once', runAt: 5000 }, from)).toBe(5000);
  });

  it('once：已过去返回 null', () => {
    expect(computeNextRun({ type: 'once', runAt: 100 }, 5000)).toBeNull();
  });

  it('非法 cron 表达式返回 null，不抛异常', () => {
    expect(computeNextRun({ type: 'cron', expression: 'not a cron' }, Date.now())).toBeNull();
    expect(computeNextRun({ type: 'cron', expression: '' }, Date.now())).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('生成人类可读摘要', () => {
    expect(describeSchedule({ type: 'cron', expression: '0 9 * * *' })).toBe('每天 09:00');
    expect(describeSchedule({ type: 'cron', expression: '30 9 * * 1,3,5' })).toBe('每周一、三、五 09:30');
    expect(describeSchedule({ type: 'cron', expression: '0 10 1 * *' })).toBe('每月 1 号 10:00');
    expect(describeSchedule({ type: 'cron', expression: '5 * * * *' })).toBe('每小时第 5 分钟');
    expect(describeSchedule({ type: 'cron', expression: '*/15 * * * *' })).toBe('每 15 分钟');
  });

  it('自定义表达式回显表达式本身', () => {
    expect(describeSchedule({ type: 'cron', expression: '0 0 1 1 *' })).toBe('0 0 1 1 *');
  });

  it('once 显示具体时间', () => {
    const at = new Date('2026-09-20T14:30:00').getTime();
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('09-20');
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('14:30');
  });
});
