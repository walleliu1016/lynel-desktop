// CloudChannel: 上行通道 → 云服务
// POST /api/envelope/push  批量推送 LynelEnvelope（buffer + 定时 flush）
// POST /api/sessions/sync   会话元数据同步

import type { OutputChannel } from './channel.js';
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

export class CloudChannel implements OutputChannel {
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
      from: 'desktop',
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
    this.enabled = false;
  }
}
