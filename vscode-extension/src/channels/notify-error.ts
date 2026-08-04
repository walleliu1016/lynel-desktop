import * as vscode from 'vscode';
import { getBus } from '../events.js';

export type NotifyLevel = 'error' | 'warn' | 'info';

const DEFAULT_THROTTLE_MS: Record<NotifyLevel, number> = {
  error: 5000, warn: 10000, info: 0,
};

const lastEmittedAt = new Map<string, number>();

function throttleKey(source: string, level: NotifyLevel, message: string): string {
  return `${level}|${source}|${message.slice(0, 80)}`;
}

export interface NotifyOptions {
  source: string;
  level?: NotifyLevel;
  message: string;
  duration?: number;
  throttleMs?: number;
  alwaysEmitFirst?: boolean;
}

function doEmit(level: NotifyLevel, message: string) {
  try {
    // 通过 EventBus 发出（如果有消费者）
    getBus().emit('app:toast', JSON.stringify({ level, message }));
    // 同时用 VS Code 通知（error 级别）
    if (level === 'error') {
      vscode.window.showErrorMessage(message.slice(0, 200));
    } else if (level === 'warn') {
      vscode.window.showWarningMessage(message.slice(0, 200));
    }
  } catch { /* 静默 */ }
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
    if (last && now - last < throttleMs) return;
    lastEmittedAt.set(key, now);
    if (lastEmittedAt.size > 200) {
      const cutoff = now - throttleMs;
      for (const [k, t] of lastEmittedAt) {
        if (t < cutoff) lastEmittedAt.delete(k);
      }
    }
  }

  doEmit(level, message);
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}
