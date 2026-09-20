// src/main/tasks/schedule.ts
// 纯函数：调度计算。不碰 DB、不碰时钟（时间一律由调用方传入）。
import { Cron } from 'croner';

export type Schedule = { type: 'cron'; expression: string } | { type: 'once'; runAt: number };

export type PresetKind =
  | 'daily' | 'weekly' | 'monthly' | 'hourly' | 'everyNMinutes' | 'once' | 'custom';

export interface Preset {
  kind: PresetKind;
  hour?: number;        // 0-23
  minute?: number;      // 0-59
  weekdays?: number[];  // 0-6，0 = 周日（cron 约定）
  dayOfMonth?: number;  // 1-31
  everyMinutes?: number; // 1-59
  runAt?: number;       // once
  expression?: string;  // custom
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

function assertInt(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 的整数，收到 ${String(v)}`);
  }
  return v;
}

function hhmm(hour: number, minute: number): { h: number; m: number } {
  return { h: assertInt(hour, 0, 23, '小时'), m: assertInt(minute, 0, 59, '分钟') };
}

export function presetToCron(p: Preset): string {
  switch (p.kind) {
    case 'daily': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      return `${m} ${h} * * *`;
    }
    case 'weekly': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      const days = p.weekdays ?? [];
      if (days.length === 0) throw new Error('每周至少要选一天');
      for (const d of days) assertInt(d, 0, 6, '星期');
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      return `${m} ${h} * * ${sorted.join(',')}`;
    }
    case 'monthly': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      const d = assertInt(p.dayOfMonth, 1, 31, '几号');
      return `${m} ${h} ${d} * *`;
    }
    case 'hourly': {
      const m = assertInt(p.minute, 0, 59, '分钟');
      return `${m} * * * *`;
    }
    case 'everyNMinutes': {
      const n = assertInt(p.everyMinutes, 1, 59, '间隔分钟');
      return `*/${n} * * * *`;
    }
    case 'custom': {
      const expr = (p.expression ?? '').trim();
      if (!expr) throw new Error('自定义 cron 表达式不能为空');
      return expr;
    }
    case 'once':
      throw new Error('一次性任务不走 cron，请用 schedule_type=once + run_at');
    default:
      throw new Error(`未知预设类型: ${String(p.kind)}`);
  }
}

export function cronToPreset(expression: string): Preset {
  const expr = (expression ?? '').trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { kind: 'custom', expression: expr };
  const [mi, ho, dom, mon, dow] = parts;

  const num = (s: string, max: number): number | null => {
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= 0 && n <= max ? n : null;
  };

  // */N * * * *
  if (mi.startsWith('*/') && ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = num(mi.slice(2), 59);
    if (n !== null && n >= 1) return { kind: 'everyNMinutes', everyMinutes: n };
  }
  // M * * * *
  const mOnly = num(mi, 59);
  if (mOnly !== null && ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'hourly', minute: mOnly };
  }
  const m = num(mi, 59);
  const h = num(ho, 23);
  if (m === null || h === null) return { kind: 'custom', expression: expr };

  // M H D * *
  if (dom !== '*' && mon === '*' && dow === '*') {
    const d = num(dom, 31);
    if (d !== null && d >= 1) return { kind: 'monthly', hour: h, minute: m, dayOfMonth: d };
    return { kind: 'custom', expression: expr };
  }
  // M H * * D[,D...]
  if (dom === '*' && mon === '*' && dow !== '*') {
    const items = dow.split(',');
    const days: number[] = [];
    for (const it of items) {
      const d = num(it, 6);
      if (d === null) return { kind: 'custom', expression: expr };
      days.push(d);
    }
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    if (sorted.length !== days.length) return { kind: 'custom', expression: expr };
    return { kind: 'weekly', hour: h, minute: m, weekdays: sorted };
  }
  // M H * * *
  if (dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'daily', hour: h, minute: m };
  }
  return { kind: 'custom', expression: expr };
}

export function computeNextRun(s: Schedule, from: number): number | null {
  if (s.type === 'once') return s.runAt > from ? s.runAt : null;
  const expr = (s.expression ?? '').trim();
  if (!expr) return null;
  try {
    const next = new Cron(expr).nextRun(new Date(from));
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function describeSchedule(s: Schedule): string {
  if (s.type === 'once') {
    const d = new Date(s.runAt);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const preset = cronToPreset(s.expression);
  switch (preset.kind) {
    case 'daily':
      return `每天 ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'weekly':
      return `每周${preset.weekdays!.map((d) => WEEKDAY_CN[d]).join('、')} ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'monthly':
      return `每月 ${preset.dayOfMonth} 号 ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'hourly':
      return `每小时第 ${preset.minute} 分钟`;
    case 'everyNMinutes':
      return `每 ${preset.everyMinutes} 分钟`;
    default:
      return (s.expression ?? '').trim();
  }
}
