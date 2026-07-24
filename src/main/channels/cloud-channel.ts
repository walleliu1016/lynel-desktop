// CloudChannel: 上行通道 → 云服务
// POST /api/envelope/push  批量推送 LynelEnvelope（buffer + 定时 flush）
// POST /api/sessions/sync  会话元数据同步
// POST /api/hook           转发 Claude 原始 hook body
//   - 非审批类 hook（PreToolUse/PostToolUse/...）：fire-and-forget，3s/50 batch
//   - PermissionRequest：同步 forward + 等待 cloud 决策
//   - 本地 broker 先 resolve 时：POST action=abort 通知 cloud 取消

import type { OutputChannel, HookChannel, HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { getLogger } from '../log.js';

export interface CloudChannelConfig {
  url?: string;
  token?: string;
  enabled?: boolean;
  userId?: string;
}

export interface SyncSession {
  session_id: string;
  jsonl_path?: string;
  cwd?: string;
  project_name?: string;
  title?: string;
  last_activity_at?: number;
}

// sendPermissionRequest 同步等待 cloud 响应后的结果。bodyText 原样透传给 hookserver。
export interface CloudHookResponse {
  ok: boolean;
  status: number;
  bodyText: string;
  parsed?: unknown;
}

const FROM_TAG = 'desktop';
// PermissionRequest 默认超时：2 小时
const DEFAULT_PERMISSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class CloudChannel implements OutputChannel, HookChannel {
  readonly id = 'cloud';
  readonly name = 'Cloud';

  private url = '';
  private token = '';
  private enabled = false;
  private userId = '';
  private buffer: LynelEnvelope[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL = 3_000;
  private readonly MAX_BATCH_SIZE = 50;
  // 非审批类 hook 独立 buffer：fire-and-forget batch
  private hookBuffer: Record<string, unknown>[] = [];
  private hookFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HOOK_FLUSH_INTERVAL = 3_000;
  private readonly HOOK_MAX_BATCH_SIZE = 50;
  // PermissionRequest 待响应的 AbortController：用于本地 race 胜出时取消 fetch
  private pendingPermissions = new Map<string, AbortController>();

  isEnabled(): boolean {
    return this.enabled && this.url.length > 0 && this.token.length > 0;
  }

  updateConfig(cfg: CloudChannelConfig): void {
    if (cfg.url !== undefined) this.url = cfg.url.replace(/\/+$/, '');
    if (cfg.token !== undefined) this.token = cfg.token;
    if (cfg.userId !== undefined) this.userId = cfg.userId;
    if (cfg.enabled !== undefined) {
      const wasEnabled = this.enabled;
      this.enabled = cfg.enabled;
      if (this.enabled && !wasEnabled) {
        getLogger().info('[cloud-channel] enabled, url:', this.url);
      } else if (!this.enabled && wasEnabled) {
        getLogger().info('[cloud-channel] disabled');
      }
    }
  }

  send(event: LynelEnvelope): void {
    if (!this.isEnabled()) return;
    this.buffer.push(event);
    if (this.buffer.length >= this.MAX_BATCH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  // HookChannel: 非审批类 hook fire-and-forget batch
  // PermissionRequest 走 sendPermissionRequest；PermissionResolved 是 broker 内部合成事件
  sendHook(event: HookEventLike): void {
    if (!this.isEnabled()) return;
    if (event.kind === 'PermissionRequest' || event.kind === 'PermissionResolved') return;
    if (!event.rawBody) return;
    this.hookBuffer.push(event.rawBody);
    if (this.hookBuffer.length >= this.HOOK_MAX_BATCH_SIZE) {
      this.flushHooks();
    } else if (!this.hookFlushTimer) {
      this.hookFlushTimer = setTimeout(() => this.flushHooks(), this.HOOK_FLUSH_INTERVAL);
    }
  }

  // 同步转发 PermissionRequest 到 cloud，等待响应
  // 超时 / 本地 abort / 网络错误均 reject；调用方需做 race 协调
  async sendPermissionRequest(
    reqId: string,
    rawBody: Record<string, unknown>,
    timeoutMs: number = DEFAULT_PERMISSION_TIMEOUT_MS,
  ): Promise<CloudHookResponse> {
    if (!this.isEnabled()) {
      throw new Error('[cloud-channel] not enabled');
    }
    const controller = new AbortController();
    this.pendingPermissions.set(reqId, controller);

    const body = JSON.stringify({
      action: 'forward',
      from: FROM_TAG,
      data: rawBody,
      request_id: reqId,
    });

    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error('cloud permission timeout'));
    }, timeoutMs);

    try {
      const res = await fetch(`${this.url}/api/hook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body,
        signal: controller.signal,
      });
      // 拿到响应后再次检查 abort：避免 abortPermissionRequest 触发后误用迟到的成功响应
      if (controller.signal.aborted) {
        throw new Error('aborted by local resolution');
      }
      const bodyText = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(bodyText); } catch { /* 非 JSON 时 parsed 留空 */ }
      return { ok: res.ok, status: res.status, bodyText, parsed };
    } finally {
      clearTimeout(timeoutHandle);
      this.pendingPermissions.delete(reqId);
    }
  }

  // 本地 broker 先 resolve 时调用：通知 cloud 取消 + 取消本地 fetch
  // 发送 abort 失败仅打 warn，不抛异常
  async abortPermissionRequest(
    reqId: string,
    rawBody: Record<string, unknown>,
    decision?: 'allow' | 'deny',
  ): Promise<void> {
    if (!this.isEnabled()) return;

    // 1. 取消本地 fetch（如果还在等）
    const controller = this.pendingPermissions.get(reqId);
    if (controller) {
      controller.abort(new Error('aborted by local resolution'));
      // pendingPermissions 会在 sendPermissionRequest 的 finally 中清理
    }

    // 2. 通知 cloud 取消
    const body = JSON.stringify({
      action: 'abort',
      from: FROM_TAG,
      data: rawBody,
      request_id: reqId,
      decision,
    });

    try {
      await fetch(`${this.url}/api/hook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      getLogger().warn('[cloud-channel] abort send error:', (err as Error).message);
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.postEnvelopes(batch).catch((err) => {
      getLogger().warn('[cloud-channel] flush error:', (err as Error).message);
    });
  }

  private async postEnvelopes(envelopes: LynelEnvelope[]): Promise<void> {
    const body = JSON.stringify({
      user_id: this.userId,
      from: FROM_TAG,
      envelopes,
    });

    const res = await fetch(`${this.url}/api/envelope/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      getLogger().warn(
        `[cloud-channel] POST /api/envelope/push ${res.status}: ${res.statusText}`,
      );
    }
  }

  private flushHooks(): void {
    if (this.hookFlushTimer) {
      clearTimeout(this.hookFlushTimer);
      this.hookFlushTimer = null;
    }
    if (this.hookBuffer.length === 0) return;
    const batch = this.hookBuffer.splice(0);
    this.postHooks(batch).catch((err) => {
      getLogger().warn('[cloud-channel] hook flush error:', (err as Error).message);
    });
  }

  private async postHooks(bodies: Record<string, unknown>[]): Promise<void> {
    // 非审批类 batch：data 为数组，每项是一条原始 hook body
    const body = JSON.stringify({
      action: 'forward',
      from: FROM_TAG,
      data: bodies,
    });

    const res = await fetch(`${this.url}/api/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      getLogger().warn(
        `[cloud-channel] POST /api/hook (batch) ${res.status}: ${res.statusText}`,
      );
    }
  }

  async syncSessions(sessions: SyncSession[]): Promise<void> {
    if (!this.isEnabled()) return;

    const body = JSON.stringify({
      user_id: this.userId,
      sessions,
    });

    try {
      const res = await fetch(`${this.url}/api/sessions/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        getLogger().warn(
          `[cloud-channel] POST /api/sessions/sync ${res.status}: ${res.statusText}`,
        );
      }
    } catch (err) {
      getLogger().warn('[cloud-channel] syncSessions error:', (err as Error).message);
    }
  }

  close(): void {
    this.flush();
    this.flushHooks();
    // 关闭时取消所有 pending 的 permission 请求
    for (const controller of this.pendingPermissions.values()) {
      controller.abort(new Error('channel closed'));
    }
    this.pendingPermissions.clear();
    this.enabled = false;
  }
}
