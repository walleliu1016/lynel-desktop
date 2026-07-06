import { OutputChannel, ProxyStageEvent } from './channel.js';

export class ChannelDispatcher {
  private channels = new Map<string, OutputChannel>();

  register(channel: OutputChannel): void {
    this.channels.set(channel.id, channel);
  }

  unregister(id: string): void {
    this.channels.delete(id);
  }

  async dispatch(event: ProxyStageEvent): Promise<void> {
    for (const channel of this.channels.values()) {
      if (!channel.isEnabled()) continue;
      try {
        await channel.send(event);
      } catch (err) {
        console.error(`[channel ${channel.id}] dispatch failed:`, err);
      }
    }
  }

  list(): OutputChannel[] {
    return Array.from(this.channels.values());
  }
}
