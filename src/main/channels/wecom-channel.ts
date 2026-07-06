import { OutputChannel, ProxyStageEvent } from './channel.js';

export interface WeComChannelConfig {
  enabled: boolean;
  botId?: string;
  secret?: string;
  agent?: {
    corpId: string;
    corpSecret: string;
    agentId: number;
  };
}

export class WeComChannel implements OutputChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private cfg: WeComChannelConfig;

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  isEnabled(): boolean {
    return this.cfg.enabled && (!!this.cfg.botId || !!this.cfg.agent);
  }

  updateConfig(cfg: WeComChannelConfig): void {
    this.cfg = cfg;
  }

  async send(event: ProxyStageEvent): Promise<void> {
    if (!this.isEnabled()) return;

    const humanEvents = ['PermissionRequest', 'tool_result', 'SessionEnd', 'error'];
    const payload = event.payload as any;
    const eventName = payload?.name ?? event.kind;
    if (!humanEvents.includes(eventName) && event.kind !== 'error') return;

    const content = this.formatMessage(event);
    if (!content) return;

    // Placeholder: actual send via wecom-openclaw-plugin will be wired in Task 5.3
    console.log('[wecom-channel] would send:', content);
  }

  private formatMessage(event: ProxyStageEvent): string {
    switch (event.kind) {
      case 'PermissionRequest':
        return `🔒 权限请求: ${(event.payload as any)?.tool || 'unknown'}`;
      case 'tool_result':
        return `🛠️ 工具结果: ${(event.payload as any)?.name || 'unknown'}`;
      case 'error':
        return `❌ 错误: ${(event.payload as any)?.message || 'unknown'}`;
      default:
        return `📌 ${event.kind} (session ${event.sessionId})`;
    }
  }
}
