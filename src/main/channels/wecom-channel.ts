import { createRequire } from 'node:module';
import { OutputChannel, ProxyStageEvent } from './channel.js';

export interface WeComChannelConfig {
  enabled: boolean;
  chatId?: string;
  botId?: string;
  secret?: string;
  agent?: {
    corpId: string;
    corpSecret: string;
    agentId: number;
  };
}

const require = createRequire(import.meta.url);
let pluginModule: any;

async function loadPlugin(): Promise<any> {
  if (pluginModule) return pluginModule;
  try {
    const pluginPath = require.resolve('@wecom/wecom-openclaw-plugin');
    pluginModule = await import(pluginPath);
  } catch (err) {
    console.error('[wecom-channel] failed to load plugin:', err);
  }
  return pluginModule;
}

export class WeComChannel implements OutputChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private cfg: WeComChannelConfig;

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  isEnabled(): boolean {
    return this.cfg.enabled && !!this.cfg.chatId && (!!this.cfg.botId || !!this.cfg.agent);
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

    const plugin = await loadPlugin();
    if (!plugin?.wecomPlugin?.outbound?.sendText) {
      console.warn('[wecom-channel] plugin outbound.sendText not available');
      return;
    }

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          botId: this.cfg.botId,
          secret: this.cfg.secret,
          agent: this.cfg.agent,
        },
      },
    };

    await plugin.wecomPlugin.outbound.sendText({
      to: this.cfg.chatId,
      text: content,
      accountId: 'default',
      cfg,
    });
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
