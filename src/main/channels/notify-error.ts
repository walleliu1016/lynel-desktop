// 外部交互错误通知：把 channel / socket 报错统一通过 EventBus 推到前端 ToastCenter。
// 节流：相同 (source, level) 在窗口内不重复推送，避免一个会话断网刷屏。

import { getBus } from '../events.js';

export type NotifyLevel = 'error' | 'warn' | 'info';

const DEFAULT_THROTTLE_MS: Record<NotifyLevel, number> = {
  error: 5000,
  warn: 10000,
  info: 0,
};

const lastEmittedAt = new Map<string, number>();

function throttleKey(source: string, level: NotifyLevel, message: string): string {
  // 截断消息再哈希，避免长 stack trace 让窗口判定失效
  return `${level}|${source}|${message.slice(0, 80)}`;
}

export interface NotifyOptions {
  source: string;
  level?: NotifyLevel;
  message: string;
  duration?: number;
  /** 自定义节流窗口（毫秒）；0 表示禁用节流 */
  throttleMs?: number;
  /** 节流命中时是否仍 emit（仅延后首次，其余丢弃）；默认 false */
  alwaysEmitFirst?: boolean;
}

function doEmit(level: NotifyLevel, payload: string) {
  try {
    getBus().emit('app:toast', payload);
  } catch {
    // bus 不可用时静默：通知是辅助能力，不应阻塞主流程
  }
}

export function notifyExternal(opts: NotifyOptions): void {
  const level: NotifyLevel = opts.level ?? 'error';
  const source = opts.source || 'main';
  const message = String(opts.message ?? '').slice(0, 500);
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS[level];

  if (throttleMs > 0) {
    const key = throttleKey(source, level, message);
    const now = Date.now();
    const last = lastEmittedAt.get(key);
    if (last && now - last < throttleMs) {
      return;
    }
    lastEmittedAt.set(key, now);
    // 定期清理避免 Map 无限增长
    if (lastEmittedAt.size > 200) {
      const cutoff = now - throttleMs;
      for (const [k, t] of lastEmittedAt) {
        if (t < cutoff) lastEmittedAt.delete(k);
      }
    }
  }

  const payload = JSON.stringify({
    level,
    source,
    message,
    duration: opts.duration,
  });
  doEmit(level, payload);
}

/** 从任意 Error 对象中抽取 message，自动截断 */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
