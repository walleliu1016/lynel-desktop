import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { OutputChannel, ProxyStageEvent } from './channel.js';
import * as session from '../session.js';
import { getStore } from '../store.js';

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

interface WeComRoutingEntry {
  sessionId: string;
  workDir: string;
  updatedAt: number;
}

const routingStore = getStore('wecom-routing');

function getMapping(chatId: string): WeComRoutingEntry | undefined {
  return routingStore.get(`mappings.${chatId}`) as WeComRoutingEntry | undefined;
}

function setMapping(chatId: string, sessionId: string, workDir: string): void {
  routingStore.set(`mappings.${chatId}`, { sessionId, workDir, updatedAt: Date.now() });
}

function deleteMapping(chatId: string): void {
  routingStore.delete(`mappings.${chatId}` as any);
}

function resolveSessionArg(arg: string): { id: string; workDir: string } | { error: string } {
  const all = session.list();
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= all.length) {
    const s = all[idx - 1];
    return { id: s.id, workDir: s.workDir };
  }
  const exact = session.lookup(arg);
  if (exact) return { id: exact.id, workDir: exact.workDir };
  const matches = all.filter((s) => s.id.startsWith(arg));
  if (matches.length === 0) {
    return { error: `未找到匹配会话：${arg}，请发送 #list 查看。` };
  }
  if (matches.length > 1) {
    return { error: `找到 ${matches.length} 个匹配会话，请使用完整 session ID。` };
  }
  return { id: matches[0].id, workDir: matches[0].workDir };
}

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
  private lastActiveSession = new Map<string, string>();

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

  clearSessionMappings(sessionId: string): void {
    const all = (routingStore.store as any) || {};
    const mappings = all.mappings || {};
    for (const [chatId, entry] of Object.entries(mappings)) {
      if ((entry as WeComRoutingEntry).sessionId === sessionId) {
        routingStore.delete(`mappings.${chatId}` as any);
      }
    }
    this.chatIdToSession.forEach((sid, chatId) => {
      if (sid === sessionId) this.chatIdToSession.delete(chatId);
    });
    this.lastActiveSession.forEach((sid, chatId) => {
      if (sid === sessionId) this.lastActiveSession.delete(chatId);
    });
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
    if (this.cfg.chatId) {
      this.lastActiveSession.set(this.cfg.chatId, event.sessionId);
      this.chatIdToSession.set(this.cfg.chatId, event.sessionId);
      const s = session.lookup(event.sessionId);
      if (s) {
        setMapping(this.cfg.chatId, event.sessionId, s.workDir);
      }
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

    const chatId = body.chatid || body.from?.userid;
    if (!chatId) {
      console.log('[wecom-channel] inbound message has no chatId');
      return;
    }

    const text = this.extractInboundText(body);
    if (!text) {
      console.log('[wecom-channel] inbound message has no text content');
      return;
    }

    // 单条消息指定 session，不修改默认绑定
    if (text.startsWith('#to ')) {
      this.handleToCommand(chatId, text).catch((err) => console.error('[wecom-channel] #to failed:', err));
      return;
    }

    // 其他命令消息在企业微信侧处理，不送给 Claude
    if (text.startsWith('#')) {
      this.handleCommand(chatId, text).catch((err) => console.error('[wecom-channel] command failed:', err));
      return;
    }

    // 优先用持久化映射，其次内存映射，最后最近活跃 session
    const mapping = getMapping(chatId);
    let sessionId: string | undefined;
    if (mapping) {
      const s = session.lookup(mapping.sessionId);
      if (!s) {
        this.sendWeComReply(chatId, '绑定的会话已不存在，请发送 #bind 重新绑定。').catch((err) =>
          console.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      if (s.workDir !== mapping.workDir) {
        this.sendWeComReply(chatId, '绑定会话的工作目录已变更，请发送 #bind 重新绑定。').catch((err) =>
          console.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      sessionId = mapping.sessionId;
    } else {
      sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }
    if (!sessionId) {
      console.log('[wecom-channel] no active session for inbound message');
      this.sendWeComReply(chatId, '当前没有绑定会话，请发送 #list 查看，或 #bind <sessionId> / #bind <序号> 绑定。').catch((err) =>
        console.error('[wecom-channel] failed to send reply:', err),
      );
      return;
    }

    const s = session.lookup(sessionId);
    if (!s || !s.process) {
      console.log(`[wecom-channel] session ${sessionId.slice(0, 8)}... not found or no process`);
      this.sendWeComReply(chatId, `会话 ${sessionId.slice(0, 8)}... 不存在或未启动，请重新绑定。`).catch((err) =>
        console.error('[wecom-channel] failed to send reply:', err),
      );
      return;
    }

    console.log(`[wecom-channel] inbound message from ${chatId}, forward to session ${sessionId.slice(0, 8)}...`);
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

  private async handleCommand(chatId: string, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1];

    switch (cmd) {
      case '#bind':
      case '#switch': {
        if (!arg) {
          await this.sendWeComReply(chatId, '用法：#bind <sessionId> 或 #bind <序号>，先发送 #list 查看列表。');
          return;
        }
        const resolved = resolveSessionArg(arg);
        if ('error' in resolved) {
          await this.sendWeComReply(chatId, resolved.error);
          return;
        }
        setMapping(chatId, resolved.id, resolved.workDir);
        await this.sendWeComReply(chatId, `已绑定到会话 ${resolved.id.slice(0, 8)}...\n工作目录：${resolved.workDir}`);
        return;
      }
      case '#unbind':
      case '#close': {
        deleteMapping(chatId);
        await this.sendWeComReply(chatId, '已解绑当前聊天与会话的关联。');
        return;
      }
      case '#status': {
        const mapping = getMapping(chatId);
        if (!mapping) {
          await this.sendWeComReply(chatId, '当前聊天未绑定会话。发送 #list 查看可用会话，或 #bind <sessionId> 绑定。');
          return;
        }
        const s = session.lookup(mapping.sessionId);
        const state = s?.state ?? 'unknown';
        await this.sendWeComReply(
          chatId,
          `当前绑定会话：${mapping.sessionId.slice(0, 8)}...\n状态：${state}\n工作目录：${mapping.workDir}`,
        );
        return;
      }
      case '#list': {
        const sessions = session.list();
        if (sessions.length === 0) {
          await this.sendWeComReply(chatId, '当前没有可用会话。请先在 Lynel Desktop 中创建或打开一个会话。');
          return;
        }
        const lines = sessions.map((s, i) => `${i + 1}. ${s.id} [${s.state}] ${s.workDir}`);
        await this.sendWeComReply(chatId, '可用会话：\n' + lines.join('\n'));
        return;
      }
      default: {
        await this.sendWeComReply(
          chatId,
          '未知命令。可用命令：#list、#bind <sessionId/序号>、#switch <sessionId/序号>、#to <sessionId/序号> <消息>、#status、#unbind',
        );
        return;
      }
    }
  }

  private async handleToCommand(chatId: string, text: string): Promise<void> {
    const rest = text.slice(3).trim();
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx === -1) {
      await this.sendWeComReply(chatId, '用法：#to <sessionId/序号> <消息内容>');
      return;
    }
    const arg = rest.slice(0, spaceIdx);
    const message = rest.slice(spaceIdx + 1).trim();
    if (!message) {
      await this.sendWeComReply(chatId, '消息内容不能为空。');
      return;
    }

    const resolved = resolveSessionArg(arg);
    if ('error' in resolved) {
      await this.sendWeComReply(chatId, resolved.error);
      return;
    }

    const s = session.lookup(resolved.id);
    if (!s || !s.process) {
      await this.sendWeComReply(chatId, `会话 ${resolved.id.slice(0, 8)}... 不存在或未启动。`);
      return;
    }

    console.log(`[wecom-channel] #to from ${chatId}, forward to session ${resolved.id.slice(0, 8)}...`);
    try {
      session.send(resolved.id, message);
      await this.sendWeComReply(chatId, `已临时发送到会话 ${resolved.id.slice(0, 8)}...`);
    } catch (err) {
      console.error('[wecom-channel] failed to forward #to message to session:', err);
      await this.sendWeComReply(chatId, `发送失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendWeComReply(chatId: string, text: string): Promise<void> {
    const plugin = await loadWecomPlugin();
    if (!plugin?.outbound?.sendText) {
      console.warn('[wecom-channel] plugin outbound.sendText not available');
      return;
    }
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
    await plugin.outbound.sendText({ to: chatId, text, accountId: 'default', cfg });
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
