// ChannelDispatcher: 路由 LynelEnvelope 和 HookEvent 到注册 channel

import type { OutputChannel, HookChannel, HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';

export class ChannelDispatcher {
  private channels = new Map<string, OutputChannel>();
  private hookChannels = new Map<string, HookChannel>();

  register(channel: OutputChannel): void {
    this.channels.set(channel.id, channel);
  }

  registerHook(channel: HookChannel): void {
    this.hookChannels.set(channel.id, channel);
  }

  unregister(id: string): void {
    this.channels.delete(id);
    this.hookChannels.delete(id);
  }

  async dispatch(event: LynelEnvelope): Promise<void> {
    for (const channel of this.channels.values()) {
      if (!channel.isEnabled()) continue;
      try {
        await channel.send(event);
      } catch (err) {
        console.error(`[channel ${channel.id}] dispatch failed:`, err);
      }
    }
  }

  async dispatchHook(event: HookEventLike): Promise<void> {
    for (const channel of this.hookChannels.values()) {
      if (!channel.isEnabled()) continue;
      try {
        await channel.sendHook(event);
      } catch (err) {
        console.error(`[hook ${channel.id}] dispatch failed:`, err);
      }
    }
  }

  list(): OutputChannel[] {
    return Array.from(this.channels.values());
  }

  async closeAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        if (channel.close) await channel.close();
      } catch (err) {
        console.error(`[channel ${channel.id}] close failed:`, err);
      }
    }
    for (const channel of this.hookChannels.values()) {
      try {
        if (channel.close) await channel.close();
      } catch (err) {
        console.error(`[hook ${channel.id}] close failed:`, err);
      }
    }
    this.channels.clear();
    this.hookChannels.clear();
  }
}
