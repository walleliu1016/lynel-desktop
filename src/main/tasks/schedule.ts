// src/main/tasks/schedule.ts
// 纯函数：调度计算。不碰 DB、不碰时钟（时间一律由调用方传入）。
//
// 执行频率共 3 种模式 + 自定义 crontab，全部落到一个 cron 表达式 + 可选的生效区间：
//   daily     每天   → `<分> <时> * * <星期>`       （星期为 * 表示不限）
//   interval  按间隔 → 分钟：`*/N * * * <星期>`
//                      小时：`0 */N * * <星期>`
//                      天  ：`<分> <时> */N * *`
//                      月  ：`<分> <时> <几号> */N *`
//   once      单次   → 不走 cron，用 run_at
//   cron      自定义 → 原样保存
//
// 「生效区间」不在表达式里表达（cron 没有日期边界的概念），走 croner 的 startAt / stopAt。
//
// 为什么「按间隔·天 / 月」不允许限定星期：cron 的 日 与 周 字段同时限定时是 **OR** 语义
// （`0 9 */2 * 1` 会在「每 2 天」或「周一」都触发，实测 croner 同样如此），拼不出
// 「每 2 天的周一」。要按周几跑请用「每天 + 生效的天」。
// 分钟 / 小时两档没有这个问题：它们的 dow 是唯一的星期来源，`*/15 * * * 1,2` 语义精确。
import { Cron } from 'croner';

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month';

/** 全部星期（cron 约定：0 = 周日）。 */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** 生效的天用 cron 约定（0=周日 … 6=周六）。渲染层用 1=周一 … 7=周日，映射在 utils/tasks.ts。 */
export type Schedule =
  | {
      type: 'daily';
      hour: number;
      minute: number;
      days: number[];
      startAt: number | null;
      endAt: number | null;
    }
  | {
      type: 'interval';
      n: number;
      unit: IntervalUnit;
      days: number[];
      hour: number;
      minute: number;
      /** 仅 unit='month' 用：每 N 个月的几号（1-31） */
      dayOfMonth: number;
      startAt: number | null;
      endAt: number | null;
    }
  | { type: 'once'; runAt: number }
  | { type: 'cron'; expression: string; startAt: number | null; endAt: number | null };

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WORKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

function assertInt(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 的整数，收到 ${String(v)}`);
  }
  return v;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 星期集合 → cron 的 dow 字段。全选（或空）都归一成 `*`，让「每天都跑」的表达式保持最简。 */
function dowField(days: number[] | undefined): string {
  const list = [...new Set(days ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (list.length === 0 || list.length === 7) return '*';
  return list.sort((a, b) => a - b).join(',');
}

/** cron 的 dow 字段 → 星期集合。非法返回 null（调用方退回自定义）。 */
function parseDow(field: string): number[] | null {
  if (field === '*') return [...ALL_DAYS];
  const out: number[] = [];
  for (const item of field.split(',')) {
    if (!/^\d$/.test(item)) return null;
    out.push(Number(item));
  }
  const uniq = [...new Set(out)];
  if (uniq.length !== out.length) return null; // 重复的星期（`1,1`）落自定义，不静默去重
  return uniq;
}

export function isSameDays(a: number[], b: number[]): boolean {
  const x = [...new Set(a)].sort((p, q) => p - q);
  const y = [...new Set(b)].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Schedule → cron 表达式。`once` 不走 cron，返回 null。 */
export function scheduleToCron(s: Schedule): string | null {
  if (s.type === 'once') return null;
  if (s.type === 'cron') {
    const expr = (s.expression ?? '').trim();
    if (!expr) throw new Error('自定义 cron 表达式不能为空');
    return expr;
  }
  const dow = dowField(s.days);
  if (s.type === 'daily') {
    const h = assertInt(s.hour, 0, 23, '小时');
    const m = assertInt(s.minute, 0, 59, '分钟');
    return `${m} ${h} * * ${dow}`;
  }
  const MAX_N: Record<IntervalUnit, number> = { minute: 59, hour: 23, day: 31, month: 12 };
  const n = assertInt(s.n, 1, MAX_N[s.unit], '间隔');
  if (s.unit === 'minute') return `*/${n} * * * ${dow}`;
  if (s.unit === 'hour') return `0 */${n} * * ${dow}`;
  // 按天 / 按月：小时分是「几点跑」，日（或月）字段承担间隔。
  // 这里**拒绝**受限的星期集合而不是静默丢掉 —— cron 的 日/周 同时限定是 OR 语义，
  // 拼出来会在「每 N 天」或「周X」都触发，静默产出错误行为比报错更糟（见文件头注释）。
  if (dow !== '*') throw new Error('「每 N 天 / 月」不能同时限定星期，请改用「每天 + 生效的天」');
  const h = assertInt(s.hour, 0, 23, '小时');
  const m = assertInt(s.minute, 0, 59, '分钟');
  if (s.unit === 'day') return `${m} ${h} */${n} * *`;
  const d = assertInt(s.dayOfMonth, 1, 31, '几号');
  return `${m} ${h} ${d} */${n} *`;
}

/** cron 表达式（+ 生效区间）→ Schedule。认不出来的形状原样落 `cron`，不猜。 */
export function cronToSchedule(
  expression: string,
  startAt: number | null = null,
  endAt: number | null = null,
): Schedule {
  const expr = (expression ?? '').trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { type: 'cron', expression: expr, startAt, endAt };
  const [mi, ho, dom, mon, dow] = parts;
  const num = (s: string, max: number): number | null =>
    /^\d+$/.test(s) && Number(s) <= max ? Number(s) : null;

  // 每 N 分钟：*/N * * * <dow>
  if (mi.startsWith('*/') && ho === '*' && dom === '*' && mon === '*') {
    const n = num(mi.slice(2), 59);
    const days = parseDow(dow);
    if (n !== null && n >= 1 && days) {
      return { type: 'interval', n, unit: 'minute', days, hour: 0, minute: 0, dayOfMonth: 1, startAt, endAt };
    }
  }
  // 每 N 小时：0 */N * * <dow>
  if (mi === '0' && ho.startsWith('*/') && dom === '*' && mon === '*') {
    const n = num(ho.slice(2), 23);
    const days = parseDow(dow);
    if (n !== null && n >= 1 && days) {
      return { type: 'interval', n, unit: 'hour', days, hour: 0, minute: 0, dayOfMonth: 1, startAt, endAt };
    }
  }
  // 每 N 个月的 D 号：<分> <时> <D> */N *
  if (mon.startsWith('*/') && dow === '*' && dom !== '*') {
    const m = num(mi, 59);
    const h = num(ho, 23);
    const d = num(dom, 31);
    const n = num(mon.slice(2), 12);
    if (m !== null && h !== null && d !== null && d >= 1 && n !== null && n >= 1) {
      return { type: 'interval', n, unit: 'month', days: [...ALL_DAYS], hour: h, minute: m, dayOfMonth: d, startAt, endAt };
    }
  }
  // 每 N 天：<分> <时> */N * *
  if (dom.startsWith('*/') && mon === '*' && dow === '*') {
    const m = num(mi, 59);
    const h = num(ho, 23);
    const n = num(dom.slice(2), 31);
    if (m !== null && h !== null && n !== null && n >= 1) {
      return { type: 'interval', n, unit: 'day', days: [...ALL_DAYS], hour: h, minute: m, dayOfMonth: 1, startAt, endAt };
    }
  }
  // <分> <时> * * <dow>
  if (dom === '*' && mon === '*') {
    const m = num(mi, 59);
    const h = num(ho, 23);
    const days = parseDow(dow);
    if (m !== null && h !== null && days) return { type: 'daily', hour: h, minute: m, days, startAt, endAt };
  }
  return { type: 'cron', expression: expr, startAt, endAt };
}

/** 生效区间（毫秒时间戳）。区间之外不排下一次运行。 */
interface CronWindow {
  startAt?: Date;
  stopAt?: Date;
}

function windowOf(s: Schedule): CronWindow {
  if (s.type === 'once') return {};
  const w: CronWindow = {};
  if (s.startAt != null) w.startAt = new Date(s.startAt);
  if (s.endAt != null) w.stopAt = new Date(s.endAt);
  return w;
}

export function computeNextRun(s: Schedule, from: number): number | null {
  if (s.type === 'once') return s.runAt > from ? s.runAt : null;
  // scheduleToCron 对非法输入抛错（空的 / 越界的），这里必须吞掉：它由 30s 一次的 tick 调用，
  // 一次抛错就会让整个调度器停摆。返回 null = 没有下一次，调用方据此跳过这个任务。
  let expr: string | null;
  try {
    expr = scheduleToCron(s);
  } catch {
    return null;
  }
  if (!expr) return null;
  try {
    const next = new Cron(expr, windowOf(s)).nextRun(new Date(from));
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

/** 任务行里与调度有关的字段（store.TaskRow 的子集，避免 schedule.ts 反向依赖 store）。 */
export interface ScheduledRow {
  scheduleType: string;
  scheduleExpr: string | null;
  runAt: number | null;
  scheduleStartAt: number | null;
  scheduleEndAt: number | null;
}

/** 从任务行的落库字段还原 Schedule。scheduler / index IPC / 表单回填共用同一份还原逻辑 ——
 *  各写一份的话，新增字段（如生效区间）总有一处漏掉，表单一编辑就把区间抹平。 */
export function scheduleOf(task: ScheduledRow): Schedule {
  if (task.scheduleType === 'once') return { type: 'once', runAt: task.runAt ?? 0 };
  return cronToSchedule(task.scheduleExpr ?? '', task.scheduleStartAt ?? null, task.scheduleEndAt ?? null);
}

/** 生效区间是否已经过去（用于把「跑完最后一次」的任务自动停用）。 */
export function isWindowClosed(s: Schedule, now: number): boolean {
  return s.type !== 'once' && s.endAt != null && s.endAt < now;
}

function daysLabel(days: number[] | undefined): string {
  const list = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (list.length === 0 || list.length === 7) return '每天';
  if (isSameDays(list, WORKDAYS)) return '工作日';
  if (isSameDays(list, WEEKEND)) return '周末';
  return list.map((d) => `周${WEEKDAY_CN[d]}`).join('、');
}

function windowLabel(s: Schedule): string {
  if (s.type === 'once' || s.startAt == null || s.endAt == null) return '';
  const d = (ms: number) => {
    const t = new Date(ms);
    return `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  };
  return `（${d(s.startAt)} ~ ${d(s.endAt)}）`;
}

export function describeSchedule(input: Schedule): string {
  // 自定义表达式若正好命中模板形状（`0 9 * * *`）就给可读文案；认不出的（`0 9 * * 1-5`、
  // 六段式等）原样输出。落库的永远是表达式，所以文案只能从表达式反推。
  const s = input.type === 'cron' ? cronToSchedule(input.expression, input.startAt, input.endAt) : input;
  const win = windowLabel(s);
  if (s.type === 'once') {
    const d = new Date(s.runAt);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  if (s.type === 'cron') return `${(s.expression ?? '').trim()}${win}`;
  if (s.type === 'interval') {
    const UNIT_CN: Record<IntervalUnit, string> = { minute: '分钟', hour: '小时', day: '天', month: '个月' };
    const base = `每 ${s.n} ${UNIT_CN[s.unit]}`;
    const at = ` ${pad2(s.hour)}:${pad2(s.minute)}`;
    switch (s.unit) {
      case 'minute': return `${base}${win}`;
      case 'hour': return `${base} · ${daysLabel(s.days)}${win}`;
      case 'day': return `${base}${at}${win}`;
      default: return `${base} ${s.dayOfMonth} 号${at}${win}`;
    }
  }
  return `${daysLabel(s.days)} ${pad2(s.hour)}:${pad2(s.minute)}${win}`;
}

/** 错过的任务在窗口内仍然补跑；超过窗口就跳过、直接排下一次。
 *  桌面应用关一整夜是常态，60 分钟比 cowagent 的 10 分钟宽。 */
export const CATCH_UP_MS = 60 * 60 * 1000;

/** 入队后超过这个时长仍未启动 → 标 skipped，避免「每天 9:00 的日报」拖到 11:00 才发。 */
export const QUEUE_TIMEOUT_MS = 30 * 60 * 1000;

/** 单次 run 的墙钟上限，到点 SIGTERM → 5s → SIGKILL。 */
export const RUN_TIMEOUT_MS = 30 * 60 * 1000;

export type DueState = 'not_due' | 'due' | 'missed';

export function isDue(nextRunAt: number | null, now: number, catchUpMs: number): DueState {
  if (nextRunAt == null) return 'not_due';
  if (now < nextRunAt) return 'not_due';
  return now - nextRunAt <= catchUpMs ? 'due' : 'missed';
}
