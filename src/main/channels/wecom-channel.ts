import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { OutputChannel, ProxyStageEvent } from './channel.js';
import * as session from '../session.js';

export interface WeComChannelConfig {
  enabled: boolean;
  chatId?: string;
  botId?: string;
  secret?: string;
  agent?: {
    corpId: string;
    corpSecret: string;
    agentId: number;
    token?: string;
    encodingAESKey?: string;
  };
}

let pluginModule: any;
let stateManagerModule: any;
let wsClientModule: any;
let wecomPlugin: any;

function resolvePluginDir(): string {
  const url = (import.meta as any).resolve('@wecom/wecom-openclaw-plugin');
  const resolvedDir = path.dirname(fileURLToPath(url));
  // import.meta.resolve 指向包入口（如 dist/index.js），需要回到包根目录
  return path.basename(resolvedDir) === 'dist' ? path.dirname(resolvedDir) : resolvedDir;
}

async function loadPlugin(): Promise<any> {
  if (pluginModule) return pluginModule;
  try {
    pluginModule = await import('@wecom/wecom-openclaw-plugin');
  } catch (err) {
    console.error('[wecom-channel] failed to load plugin:', err);
  }
  return pluginModule;
}

async function loadWecomPlugin(): Promise<any> {
  if (wecomPlugin) return wecomPlugin;
  const module = await loadPlugin();
  if (!module?.default?.register) return null;

  const mockApi = {
    runtime: {
      log: () => {},
      error: () => {},
      config: { readConfigFile: async () => ({}), writeConfigFile: async () => {} },
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
        routing: { resolveAgentRoute: () => ({}) },
        session: { resolveStorePath: () => '', recordInboundSession: async () => {} },
        reply: { dispatchReplyWithBufferedBlockDispatcher: async () => {} },
      },
    },
    registerChannel: ({ plugin }: { plugin: any }) => {
      wecomPlugin = plugin;
    },
    registerTool: () => {},
    registerHttpRoute: () => {},
    on: () => {},
  };
  module.default.register(mockApi);
  return wecomPlugin;
}

async function getSetWeComWebSocket(): Promise<(client: any, accountId: string) => void> {
  if (stateManagerModule) return stateManagerModule.setWeComWebSocket;
  const pluginDir = resolvePluginDir();
  stateManagerModule = await import(pathToFileURL(path.join(pluginDir, 'dist/src/state-manager.js')).href);
  return stateManagerModule.setWeComWebSocket;
}

async function getWSClientClass(): Promise<any> {
  if (wsClientModule) return wsClientModule.WSClient;
  const pluginDir = resolvePluginDir();
  const m = await import(pathToFileURL(path.join(pluginDir, 'node_modules/@wecom/aibot-node-sdk/dist/index.esm.js')).href);
  return m.WSClient;
}

export class WeComChannel implements OutputChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private cfg: WeComChannelConfig;
  private wsClient: any = null;
  private connecting: Promise<void> | null = null;
  private chatIdToSession = new Map<string, string>();
  private lastSessionId: string | null = null;

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  isEnabled(): boolean {
    const ok = this.cfg.enabled && !!this.cfg.chatId && (!!this.cfg.botId || !!this.cfg.agent);
    console.log(`[wecom-channel] isEnabled=${ok} enabled=${this.cfg.enabled} chatId=${this.cfg.chatId ? 'set' : 'unset'} botId=${this.cfg.botId ? 'set' : 'unset'}`);
    return ok;
  }

  updateConfig(cfg: WeComChannelConfig): void {
    console.log('[wecom-channel] updateConfig', { enabled: cfg.enabled, chatId: cfg.chatId, botId: cfg.botId ? 'set' : 'unset' });
    this.cfg = cfg;
    if (!this.isEnabled()) {
      this.disconnect();
      return;
    }
    // 预连接 websocket，避免第一次发送消息时才阻塞连接
    if (this.cfg.botId && this.cfg.secret) {
      this.ensureWebSocket().catch((err) => console.error('[wecom-channel] proactive connect failed:', err));
    }
  }

  async close(): Promise<void> {
    this.disconnect();
  }

  send(event: ProxyStageEvent): void {
    console.log(`[wecom-channel] receive event ${event.kind} (sid=${event.sessionId.slice(0, 8)}...)`);
    if (!this.isEnabled()) {
      console.log('[wecom-channel] disabled, skip');
      return;
    }

    const outboundEvents = ['prompt', 'tool_use', 'response_complete', 'PermissionRequest', 'tool_result', 'SessionEnd', 'error'];
    if (!outboundEvents.includes(event.kind)) {
      console.log(`[wecom-channel] event ${event.kind} not in outbound list, skip`);
      return;
    }

    const content = this.formatMessage(event);
    if (!content) {
      console.log('[wecom-channel] empty content, skip');
      return;
    }
    console.log(`[wecom-channel] formatted content: ${content.slice(0, 80)}...`);

    // 记录会话路由关系，方便企业微信入站消息找到对应 session
    this.lastSessionId = event.sessionId;
    if (this.cfg.chatId) {
      this.chatIdToSession.set(this.cfg.chatId, event.sessionId);
    }

    // 异步发送，不阻塞 dispatcher / 主进程事件循环
    this.sendContent(content, event.sessionId).catch((err) => console.error('[wecom-channel] send failed:', err));
  }

  private async sendContent(content: string, _sessionId: string): Promise<void> {
    const plugin = await loadWecomPlugin();
    if (!plugin?.outbound?.sendText) {
      console.warn('[wecom-channel] plugin outbound.sendText not available');
      return;
    }

    console.log('[wecom-channel] ensuring websocket...');
    await this.ensureWebSocket();

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

    console.log('[wecom-channel] sending to WeCom...');
    const result = await plugin.outbound.sendText({
      to: this.cfg.chatId,
      text: content,
      accountId: 'default',
      cfg,
    });
    console.log('[wecom-channel] send success:', JSON.stringify(result));
  }

  private async ensureWebSocket(): Promise<void> {
    if (this.wsClient?.isConnected) return;
    if (!this.cfg.botId || !this.cfg.secret) return;
    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    console.log('[wecom-channel] connecting websocket...');
    const WSClient = await getWSClientClass();
    const setWeComWebSocket = await getSetWeComWebSocket();
    console.log('[wecom-channel] WSClient loaded');

    return new Promise((resolve, reject) => {
      const wsClient = new WSClient({
        botId: this.cfg.botId,
        secret: this.cfg.secret,
        wsUrl: 'wss://openws.work.weixin.qq.com',
        heartbeatInterval: 30000,
        maxReconnectAttempts: 3,
        maxAuthFailureAttempts: 2,
        logger: {
          debug: () => {},
          info: () => {},
          warn: (...args: any[]) => console.warn('[wecom-channel] ws warn:', ...args),
          error: (...args: any[]) => console.error('[wecom-channel] ws error:', ...args),
        },
      });

      const timer = setTimeout(() => {
        wsClient.disconnect();
        reject(new Error('WeCom WebSocket 认证超时'));
      }, 15000);

      wsClient.on('authenticated', () => {
        console.log('[wecom-channel] websocket authenticated');
        clearTimeout(timer);
        this.wsClient = wsClient;
        setWeComWebSocket('default', wsClient);
        resolve();
      });

      wsClient.on('message', (frame: any) => {
        try {
          this.handleInboundMessage(frame);
        } catch (err) {
          console.error('[wecom-channel] failed to handle inbound message:', err);
        }
      });

      wsClient.on('error', (err: any) => {
        clearTimeout(timer);
        reject(err);
      });

      wsClient.connect();
    });
  }

  private disconnect(): void {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
  }

  private handleInboundMessage(frame: any): void {
    const body = frame?.body as any;
    if (!body) {
      console.log('[wecom-channel] inbound frame has no body');
      return;
    }

    const text = this.extractInboundText(body);
    if (!text) {
      console.log('[wecom-channel] inbound message has no text content');
      return;
    }

    const chatId = body.chatid || body.from?.userid;
    const sessionId = (chatId && this.chatIdToSession.get(chatId)) || this.lastSessionId;
    if (!sessionId) {
      console.log('[wecom-channel] no active session for inbound message');
      return;
    }

    console.log(`[wecom-channel] inbound message from ${chatId || 'unknown'}, forward to session ${sessionId.slice(0, 8)}...`);
    try {
      session.send(sessionId, text);
    } catch (err) {
      console.error('[wecom-channel] failed to forward inbound message to session:', err);
    }
  }

  private extractInboundText(body: any): string | undefined {
    if (body.msgtype === 'text' && typeof body.text?.content === 'string') {
      return body.text.content.trim();
    }
    if (body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item)) {
      const parts: string[] = [];
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'text' && typeof item.text?.content === 'string') {
          parts.push(item.text.content);
        }
      }
      const joined = parts.join('\n').trim();
      return joined || undefined;
    }
    return undefined;
  }

  private formatMessage(event: ProxyStageEvent): string {
    const p = event.payload as any;
    switch (event.kind) {
      case 'prompt':
        return `👤 用户: ${p?.prompt || ''}`;
      case 'tool_use':
        return `🛠️ 调用工具: ${p?.name || 'unknown'}`;
      case 'response_complete':
        return `🤖 Claude: ${p?.text || ''}`;
      case 'PermissionRequest':
        return `🔒 权限请求: ${p?.tool || 'unknown'}`;
      case 'tool_result':
        return `🛠️ 工具结果: ${p?.name || 'unknown'}`;
      case 'error':
        return `❌ 错误: ${p?.message || 'unknown'}`;
      case 'SessionEnd':
        return `📌 会话结束 (session ${event.sessionId})`;
      default:
        return '';
    }
  }
}
