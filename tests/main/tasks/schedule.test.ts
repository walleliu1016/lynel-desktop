// tests/main/tasks/schedule.test.ts
import { describe, it, expect } from 'vitest';
import {
  scheduleToCron, cronToSchedule, scheduleOf, computeNextRun, describeSchedule,
  isDue, isWindowClosed, ALL_DAYS, CATCH_UP_MS, QUEUE_TIMEOUT_MS, RUN_TIMEOUT_MS,
  type Schedule,
} from '../../../src/main/tasks/schedule.js';

/** 无生效区间的默认窗口，省掉每条用例都写一遍 */
const OPEN = { startAt: null, endAt: null };
const ALL = [...ALL_DAYS];

const daily = (hour: number, minute: number, days: number[] = ALL, w = OPEN): Schedule =>
  ({ type: 'daily', hour, minute, days: [...days], ...w });
const every = (
  n: number,
  unit: 'minute' | 'hour' | 'day' | 'month',
  days: number[] = ALL,
  hour = 0,
  minute = 0,
  dayOfMonth = 1,
  w = OPEN,
): Schedule => ({ type: 'interval', n, unit, days: [...days], hour, minute, dayOfMonth, ...w });
const raw = (expression: string, w = OPEN): Schedule => ({ type: 'cron', expression, ...w });

describe('scheduleToCron', () => {
  it('每天：全选星期归一成 *，让「每天都跑」保持最简表达式', () => {
    expect(scheduleToCron(daily(9, 0))).toBe('0 9 * * *');
    expect(scheduleToCron(daily(0, 30))).toBe('30 0 * * *');
    // 空数组与全选等价（表单「一天都没选」由渲染层拦，纯函数不当成非法）
    expect(scheduleToCron(daily(9, 0, []))).toBe('0 9 * * *');
  });

  it('每天 + 生效的天：星期排序去重后落到 dow', () => {
    expect(scheduleToCron(daily(9, 0, [1, 3, 5]))).toBe('0 9 * * 1,3,5');
    expect(scheduleToCron(daily(9, 30, [5, 1, 3]))).toBe('30 9 * * 1,3,5');
    expect(scheduleToCron(daily(9, 0, [1, 2, 3, 4, 5]))).toBe('0 9 * * 1,2,3,4,5');
    expect(scheduleToCron(daily(8, 0, [0, 6]))).toBe('0 8 * * 0,6');
  });

  it('按间隔·分钟：*/N * * * <dow>', () => {
    expect(scheduleToCron(every(15, 'minute'))).toBe('*/15 * * * *');
    expect(scheduleToCron(every(30, 'minute', [1, 2]))).toBe('*/30 * * * 1,2');
  });

  it('按间隔·小时：0 */N * * <dow>', () => {
    expect(scheduleToCron(every(6, 'hour'))).toBe('0 */6 * * *');
    expect(scheduleToCron(every(2, 'hour', [1, 2]))).toBe('0 */2 * * 1,2');
  });

  it('按间隔·天：M H */N * *（带小时分，日字段承担间隔）', () => {
    expect(scheduleToCron(every(2, 'day', ALL, 9, 0))).toBe('0 9 */2 * *');
    expect(scheduleToCron(every(3, 'day', ALL, 23, 59))).toBe('59 23 */3 * *');
  });

  it('按间隔·月：M H D */N *（几号 + 几点）', () => {
    expect(scheduleToCron(every(1, 'month', ALL, 10, 0, 1))).toBe('0 10 1 */1 *');
    expect(scheduleToCron(every(3, 'month', ALL, 8, 30, 15))).toBe('30 8 15 */3 *');
  });

  it('按间隔·天 / 月 + 限定星期直接抛错（cron 的 日/周 是 OR 语义，拼不出这个组合）', () => {
    expect(() => scheduleToCron(every(2, 'day', [1]))).toThrow(/不能同时限定星期/);
    expect(() => scheduleToCron(every(2, 'month', [1]))).toThrow(/不能同时限定星期/);
  });

  it('自定义 crontab 原样返回；空串抛错', () => {
    expect(scheduleToCron(raw('0 0 1 1 *'))).toBe('0 0 1 1 *');
    expect(() => scheduleToCron(raw('   '))).toThrow();
  });

  it('once 不走 cron，返回 null', () => {
    expect(scheduleToCron({ type: 'once', runAt: 1000 })).toBeNull();
  });

  it('参数越界抛错（表单层要拦，纯函数也要守住）', () => {
    expect(() => scheduleToCron(daily(24, 0))).toThrow();
    expect(() => scheduleToCron(daily(9, 60))).toThrow();
    expect(() => scheduleToCron(every(0, 'minute'))).toThrow();
    expect(() => scheduleToCron(every(60, 'minute'))).toThrow();
    expect(() => scheduleToCron(every(0, 'hour'))).toThrow();
    expect(() => scheduleToCron(every(24, 'hour'))).toThrow();
    expect(() => scheduleToCron(every(32, 'day', ALL, 9, 0))).toThrow();
    expect(() => scheduleToCron(every(2, 'day', ALL, 24, 0))).toThrow();
    expect(() => scheduleToCron(every(13, 'month', ALL, 9, 0, 1))).toThrow();
    expect(() => scheduleToCron(every(1, 'month', ALL, 9, 0, 32))).toThrow();
  });
});

describe('cronToSchedule', () => {
  const w = { startAt: 111, endAt: 222 };

  it('认识的模板精确反查，并带回生效区间', () => {
    expect(cronToSchedule('0 9 * * *')).toEqual({ type: 'daily', hour: 9, minute: 0, days: ALL, ...OPEN });
    expect(cronToSchedule('30 9 * * 1,3,5')).toEqual({ type: 'daily', hour: 9, minute: 30, days: [1, 3, 5], ...OPEN });
    expect(cronToSchedule('0 9 * * 1,2,3,4,5')).toEqual({ type: 'daily', hour: 9, minute: 0, days: [1, 2, 3, 4, 5], ...OPEN });
    expect(cronToSchedule('*/15 * * * 1,2')).toEqual({ type: 'interval', n: 15, unit: 'minute', days: [1, 2], hour: 0, minute: 0, dayOfMonth: 1, ...OPEN });
    expect(cronToSchedule('0 */6 * * 1,2')).toEqual({ type: 'interval', n: 6, unit: 'hour', days: [1, 2], hour: 0, minute: 0, dayOfMonth: 1, ...OPEN });
    expect(cronToSchedule('0 9 */2 * *')).toEqual({ type: 'interval', n: 2, unit: 'day', days: ALL, hour: 9, minute: 0, dayOfMonth: 1, ...OPEN });
    expect(cronToSchedule('0 10 1 */1 *')).toEqual({ type: 'interval', n: 1, unit: 'month', days: ALL, hour: 10, minute: 0, dayOfMonth: 1, ...OPEN });
    expect(cronToSchedule('0 9 * * *', w.startAt, w.endAt)).toEqual({ type: 'daily', hour: 9, minute: 0, days: ALL, ...w });
  });

  it('不认识的一律落 cron 并带回原表达式与区间', () => {
    expect(cronToSchedule('0 0 1 1 *')).toEqual({ type: 'cron', expression: '0 0 1 1 *', ...OPEN });
    // 范围与多值日字段都不猜（表单跳不回预设，但表达式原样保留）
    expect(cronToSchedule('0 9 * * 1-5')).toEqual({ type: 'cron', expression: '0 9 * * 1-5', ...OPEN });
    expect(cronToSchedule('0 9 1,15 * *')).toEqual({ type: 'cron', expression: '0 9 1,15 * *', ...OPEN });
    // 重复星期不能静默去重（去重后与主进程 describeSchedule 口径不一致）
    expect(cronToSchedule('0 9 * * 1,1').type).toBe('cron');
  });

  it('表达式两端的空白被归一化后再匹配', () => {
    expect(cronToSchedule('  0 9 * * *  ')).toEqual({ type: 'daily', hour: 9, minute: 0, days: ALL, ...OPEN });
  });
});

describe('schedule ↔ cron 往返', () => {
  const cases: Schedule[] = [
    daily(9, 0),
    daily(0, 0),
    daily(23, 59),
    daily(17, 0, [5]),
    daily(9, 30, [1, 3, 5]),
    daily(8, 0, [0, 6]),
    daily(9, 0, [1, 2, 3, 4, 5]),
    every(1, 'minute'),
    every(15, 'minute'),
    every(59, 'minute', [0, 6]),
    every(1, 'hour'),
    every(6, 'hour'),
    every(23, 'hour', [1, 2]),
    every(1, 'day', ALL, 9, 0),
    every(2, 'day', ALL, 9, 0),
    every(31, 'day', ALL, 23, 59),
    every(1, 'month', ALL, 10, 0, 1),
    every(3, 'month', ALL, 8, 30, 15),
    every(12, 'month', ALL, 0, 0, 28),
  ];

  it.each(cases)('cronToSchedule(scheduleToCron($type)) 回到原调度', (s) => {
    expect(cronToSchedule(scheduleToCron(s)!)).toEqual(s);
  });

  it('所有生成的表达式都是 croner 认可的合法表达式', async () => {
    const { Cron } = await import('croner');
    for (const s of cases) {
      const expr = scheduleToCron(s)!;
      expect(() => new Cron(expr), `非法表达式: ${expr}`).not.toThrow();
    }
  });
});

describe('computeNextRun', () => {
  it('每天：从给定时刻往后算下一次', () => {
    const from = new Date('2026-09-18T08:00:00').getTime();
    const next = computeNextRun(daily(9, 0), from)!;
    expect(new Date(next).getHours()).toBe(9);
    expect(new Date(next).getDate()).toBe(18);
  });

  it('每天：当天已过则顺延到明天', () => {
    const from = new Date('2026-09-18T10:00:00').getTime();
    const next = computeNextRun(daily(9, 0), from)!;
    expect(new Date(next).getDate()).toBe(19);
    expect(new Date(next).getHours()).toBe(9);
  });

  it('生效的天：只在选中的星期上触发', () => {
    // 2026-09-18 是周五
    const fri = new Date('2026-09-18T00:00:00').getTime();
    const next = computeNextRun(daily(9, 0, [1]), fri)!;
    expect(new Date(next).getDay()).toBe(1); // 周一
  });

  it('生效区间：下一次不早于 startAt', () => {
    const from = new Date('2026-09-18T00:00:00').getTime();
    const startAt = new Date('2026-09-25T00:00:00').getTime();
    const next = computeNextRun(daily(9, 0, ALL, { startAt, endAt: null }), from)!;
    expect(next).toBeGreaterThanOrEqual(startAt);
  });

  it('生效区间：区间已过 → null（调用方据此停用任务）', () => {
    const from = new Date('2026-09-18T00:00:00').getTime();
    const endAt = new Date('2026-09-10T00:00:00').getTime();
    expect(computeNextRun(daily(9, 0, ALL, { startAt: null, endAt }), from)).toBeNull();
  });

  it('生效区间：区间内正常排下一次', () => {
    const from = new Date('2026-09-18T00:00:00').getTime();
    const w = { startAt: null, endAt: new Date('2026-09-30T00:00:00').getTime() };
    const next = computeNextRun(daily(9, 0, ALL, w), from)!;
    expect(new Date(next).getTime()).toBeLessThanOrEqual(w.endAt!);
  });

  it('once：未来时间返回该时间戳，已过去返回 null', () => {
    expect(computeNextRun({ type: 'once', runAt: 5000 }, 1000)).toBe(5000);
    expect(computeNextRun({ type: 'once', runAt: 100 }, 5000)).toBeNull();
  });

  it('非法 cron 表达式返回 null，不抛异常（tick 每 30s 调一次，抛错会停摆整个调度器）', () => {
    expect(computeNextRun(raw('not a cron'), Date.now())).toBeNull();
    expect(computeNextRun(raw(''), Date.now())).toBeNull();
    expect(computeNextRun(daily(24, 0), Date.now())).toBeNull();
  });
});

describe('isWindowClosed', () => {
  it('endAt 已过 → true', () => {
    expect(isWindowClosed(daily(9, 0, ALL, { startAt: null, endAt: 100 }), 200)).toBe(true);
  });
  it('endAt 未到 / 没设 → false', () => {
    expect(isWindowClosed(daily(9, 0, ALL, { startAt: null, endAt: 300 }), 200)).toBe(false);
    expect(isWindowClosed(daily(9, 0), 200)).toBe(false);
  });
  it('once 不走这个判断（由 runAt 自己决定）', () => {
    expect(isWindowClosed({ type: 'once', runAt: 100 }, 200)).toBe(false);
  });
});

describe('scheduleOf（任务行 → 调度）', () => {
  const base = { scheduleType: 'cron', scheduleExpr: '0 9 * * 1,3,5', runAt: null, scheduleStartAt: null, scheduleEndAt: null };

  it('cron 行还原成 daily / interval，而不是一律当成自定义表达式', () => {
    expect(scheduleOf(base)).toEqual({ type: 'daily', hour: 9, minute: 0, days: [1, 3, 5], ...OPEN });
  });

  it('生效区间必须一起还原 —— 漏了这一处，表单编辑一次就把区间抹平', () => {
    expect(scheduleOf({ ...base, scheduleStartAt: 111, scheduleEndAt: 222 }))
      .toEqual({ type: 'daily', hour: 9, minute: 0, days: [1, 3, 5], startAt: 111, endAt: 222 });
  });

  it('once 行还原成 once', () => {
    expect(scheduleOf({ ...base, scheduleType: 'once', scheduleExpr: null, runAt: 777 }))
      .toEqual({ type: 'once', runAt: 777 });
  });

  it('表达式为空 / 缺列的老行不抛错', () => {
    expect(scheduleOf({ scheduleType: 'cron', scheduleExpr: null, runAt: null, scheduleStartAt: null, scheduleEndAt: null }))
      .toEqual({ type: 'cron', expression: '', ...OPEN });
  });
});

describe('describeSchedule', () => {
  it('命中模板的表达式给可读摘要', () => {
    expect(describeSchedule(raw('0 9 * * *'))).toBe('每天 09:00');
    expect(describeSchedule(raw('0 9 * * 1,2,3,4,5'))).toBe('工作日 09:00');
    expect(describeSchedule(raw('30 9 * * 1,3,5'))).toBe('周一、周三、周五 09:30');
    expect(describeSchedule(raw('0 9 * * 0,6'))).toBe('周末 09:00');
    expect(describeSchedule(raw('*/15 * * * *'))).toBe('每 15 分钟');
    expect(describeSchedule(raw('0 */6 * * *'))).toBe('每 6 小时 · 每天');
    expect(describeSchedule(raw('0 */6 * * 1,2'))).toBe('每 6 小时 · 周一、周二');
    expect(describeSchedule(raw('0 9 */2 * *'))).toBe('每 2 天 09:00');
    expect(describeSchedule(raw('0 10 1 */1 *'))).toBe('每 1 个月 1 号 10:00');
    expect(describeSchedule(raw('30 8 15 */3 *'))).toBe('每 3 个月 15 号 08:30');
  });

  it('自定义表达式回显表达式本身', () => {
    expect(describeSchedule(raw('0 0 1 1 *'))).toBe('0 0 1 1 *');
    expect(describeSchedule(raw('0 9 * * 1-5'))).toBe('0 9 * * 1-5');
  });

  it('生效区间以「（起 ~ 止）」后缀出现', () => {
    const w = { startAt: new Date('2026-09-21T00:00:00').getTime(), endAt: new Date('2026-12-31T00:00:00').getTime() };
    expect(describeSchedule(daily(9, 0, ALL, w))).toBe('每天 09:00（09-21 ~ 12-31）');
  });

  it('once 显示具体时间', () => {
    const at = new Date('2026-09-20T14:30:00').getTime();
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('09-20');
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('14:30');
  });
});

describe('常量', () => {
  it('补跑窗口 60 分钟、排队上限 30 分钟、单次超时 30 分钟', () => {
    expect(CATCH_UP_MS).toBe(60 * 60 * 1000);
    expect(QUEUE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(RUN_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe('isDue', () => {
  const now = 10_000_000;

  it('nextRunAt 为空 → not_due（调用方负责计算并落库，不触发）', () => {
    expect(isDue(null, now, CATCH_UP_MS)).toBe('not_due');
  });

  it('还没到点 → not_due', () => {
    expect(isDue(now + 1, now, CATCH_UP_MS)).toBe('not_due');
  });

  it('正好到点 → due', () => {
    expect(isDue(now, now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：59m59s 前到期 → due', () => {
    expect(isDue(now - (CATCH_UP_MS - 1000), now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：正好 60m0s 前到期 → due（闭区间）', () => {
    expect(isDue(now - CATCH_UP_MS, now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：60m0s+1ms 前到期 → missed', () => {
    expect(isDue(now - CATCH_UP_MS - 1, now, CATCH_UP_MS)).toBe('missed');
  });

  it('关了一整夜（10 小时前）→ missed', () => {
    expect(isDue(now - 10 * 60 * 60 * 1000, now, CATCH_UP_MS)).toBe('missed');
  });
});
