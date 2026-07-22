// CloudChannel: 双向通道 → 云服务
// 方向1 (POST): 实时推送 LynelEnvelope 到云服务 /desktop/connect
// 方向2 (SSE, 预留): 接收云服务推送的指令/事件

import type { OutputChannel } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { getLogger } from '../log.js';

export interface CloudChannelConfig {
  url?: string;
  token?: string;
  enabled?: boolean;
}

export class CloudChannel implements OutputChannel {
  readonly id = 'cloud';
  readonly name = 'Cloud';

  private url = '';
  private token = '';
  private enabled = false;

  isEnabled(): boolean {
    return this.enabled && this.url.length > 0 && this.token.length > 0;
  }

  updateConfig(cfg: CloudChannelConfig): void {
    if (cfg.url !== undefined) this.url = cfg.url.replace(/\/+$/, '');
    if (cfg.token !== undefined) this.token = cfg.token;
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

    // fire-and-forget: 不阻塞 dispatcher 遍历其他 channel
    this.postEnvelope(event).catch((err) => {
      getLogger().warn('[cloud-channel] send error:', (err as Error).message);
    });
  }

  private async postEnvelope(event: LynelEnvelope): Promise<void> {
    const body = JSON.stringify(event);
    const endpoint = `${this.url}/desktop/connect`;

    const res = await fetch(endpoint, {
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
        `[cloud-channel] POST ${res.status}: ${res.statusText}`,
      );
    }
  }

  // 方向2 (预留): SSE 接收云服务指令
  // GET {url}/desktop/connect, Accept: text/event-stream
  // 云服务可推送控制指令到此通道，后续需求驱动实现

  close(): void {
    this.enabled = false;
  }
}
