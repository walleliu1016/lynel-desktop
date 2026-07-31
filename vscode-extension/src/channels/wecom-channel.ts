import * as path from 'node:path';
import { OutputChannel, HookChannel, type HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import type { BotConfig, BotConnectionState } from '../types/bot.js';
import * as session from '../session.js';
import { getStore } from '../store.js';
import { getLogger } from '../log.js';
import { permissionBroker, PermissionRequest } from '../permission-broker.js';
import { buildPermissionCard, buildAskQuestionCard, buildExitPlanCard } from './wecom-cards/card-builder.js';
import { WeComCardStore } from './wecom-cards/card-store.js';
import { WeComCardEventHandler, type TemplateCardEventFrame } from './wecom-cards/event-handler.js';
import { notifyExternal, errMessage } from './notify-error.js';

const logger = getLogger().scope('wecom-channel');

const CONTROL_COMMANDS: Record<string, string> = {
  '/interrupt': '\x03', '/ctrl-c': '\x03', '/ctrl+c': '\x03',
  '/escape': '\x1b', '/esc': '\x1b',
  '/ctrl-d': '\x04', '/ctrl-z': '\x1a',
};

export interface WeComChannelConfig {
  enabled: boolean; chatId?: string; botId?: string; secret?: string;
  agent?: { corpId: string; corpSecret: string; agentId: number; token?: string; encodingAESKey?: string };
}

let pluginModule: any;
let stateManagerModule: any;
let wsClientModule: any;
let wecomPlugin: any;

interface WeComRoutingEntry { sessionId: string; workDir: string; updatedAt: number; }
interface AskOption { label: string; description?: string; }
interface AskQuestion { header?: string; question: string; multiSelect?: boolean; options: AskOption[]; }

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
    const s = all[idx - 1]; return { id: s.id, workDir: s.workDir };
  }
  const exact = session.lookup(arg);
  if (exact) return { id: exact.id, workDir: exact.workDir };
  const matches = all.filter((s) => s.id.startsWith(arg));
  if (matches.length === 0) return { error: `未找到匹配会话：${arg}，请发送 /list 查看。` };
  if (matches.length > 1) return { error: `找到 ${matches.length} 个匹配会话，请使用完整 session ID。` };
  return { id: matches[0].id, workDir: matches[0].workDir };
}

function resolvePluginRoot(): string {
  // @wecom/wecom-openclaw-plugin 是 ESM-only 包，require.resolve 无法解析
  // 从当前模块位置手动构造 package root 路径
  // __dirname = dist/channels/ → ../../node_modules/@wecom/wecom-openclaw-plugin
  return path.resolve(__dirname, '..', '..', 'node_modules', '@wecom', 'wecom-openclaw-plugin');
}

async function loadPlugin(): Promise<any> {
  if (pluginModule) return pluginModule;
  logger.info('[wecom-channel] loadPlugin from npm package');
  try {
    pluginModule = await import('@wecom/wecom-openclaw-plugin');
    logger.info('[wecom-channel] loadPlugin success');
  } catch (err) {
    logger.error('[wecom-channel] failed to load plugin:', err);
    notifyExternal({ source: 'wecom:plugin', level: 'error', message: `企微插件加载失败: ${errMessage(err)}` });
  }
  return pluginModule;
}

async function loadWecomPlugin(): Promise<any> {
  if (wecomPlugin) return wecomPlugin;
  const module = await loadPlugin();
  if (!module?.default?.register) {
    logger.warn('[wecom-channel] loadWecomPlugin plugin default.register not found'); return null;
  }
  const mockApi = {
    runtime: {
      log: (...args: any[]) => logger.info('[wecom-channel] plugin:', ...args),
      error: (...args: any[]) => logger.error('[wecom-channel] plugin:', ...args),
      config: { readConfigFile: async () => ({}), writeConfigFile: async () => {} },
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
        routing: { resolveAgentRoute: () => ({}) },
        session: { resolveStorePath: () => '', recordInboundSession: async () => {} },
        reply: { dispatchReplyWithBufferedBlockDispatcher: async () => {} },
      },
    },
    registerChannel: ({ plugin }: { plugin: any }) => { wecomPlugin = plugin; },
    registerTool: () => {}, registerHttpRoute: () => {}, on: () => {},
  };
  module.default.register(mockApi);
  logger.info('[wecom-channel] loadWecomPlugin registered');
  return wecomPlugin;
}

async function getSetWeComWebSocket(): Promise<(client: any, accountId: string) => void> {
  if (stateManagerModule) return stateManagerModule.setWeComWebSocket;
  const pluginRoot = resolvePluginRoot();
  stateManagerModule = await import(`file://${path.join(pluginRoot, 'dist/src/state-manager.js')}`);
  return stateManagerModule.setWeComWebSocket;
}

async function getWSClientClass(): Promise<any> {
  if (wsClientModule) return wsClientModule.WSClient;
  wsClientModule = await import('@wecom/aibot-node-sdk');
  return wsClientModule.WSClient;
}

export class WeComChannel implements OutputChannel, HookChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private static readonly MARKDOWN_SAFE_LENGTH = 19000;
  private cfg: WeComChannelConfig;
  private botPool = new Map<string, BotConnectionState>();
  private sessionBotMap = new Map<string, string>();
  private currentBotId: string | undefined;
  private chatIdToSession = new Map<string, string>();
  private lastActiveSession = new Map<string, string>();
  private sessionSeqCounters = new Map<string, number>();
  private createSessionCallback: ((workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>) | null = null;
  private cardStore = new WeComCardStore();
  private cardEventHandler?: WeComCardEventHandler;
  private sessionTitleResolver: ((sessionId: string) => string) | null = null;
  pushThinking = true;
  pushToolCalls = true;
  private pendingQuestionCards = new Map<string, { cards: unknown[]; sessionId: string; seq: number }>();

  constructor(cfg: WeComChannelConfig) { this.cfg = cfg; }

  setCreateSessionHandler(handler: (workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>): void {
    this.createSessionCallback = handler;
  }
  setSessionTitleResolver(resolver: (sessionId: string) => string): void { this.sessionTitleResolver = resolver; }

  private getEffectiveChatId(entry: BotConnectionState): string {
    return entry.config.chatId || '';
  }
  private getSessionTitle(sessionId: string): string | undefined {
    if (!this.sessionTitleResolver) return undefined;
    try { return this.sessionTitleResolver(sessionId); } catch { return undefined; }
  }
  private getBotForSession(sessionId: string): BotConnectionState | undefined {
    const botId = this.sessionBotMap.get(sessionId);
    if (!botId) return undefined;
    return this.botPool.get(botId);
  }

  isEnabled(): boolean { return this.botPool.size > 0; }

  updateConfig(cfg: WeComChannelConfig): void { this.cfg = cfg; }

  updateBots(bots: BotConfig[]): void {
    const wecomBots = bots.filter((b) => b.source === 'wecom' || !b.source);
    const newIds = new Set(wecomBots.map((b) => b.id));
    for (const [id, state] of this.botPool) {
      if (!newIds.has(id)) {
        logger.info(`[wecom-channel] removing bot ${id}`);
        state.wsClient?.disconnect();
        this.botPool.delete(id);
      }
    }
    for (const bot of wecomBots) {
      const existing = this.botPool.get(bot.id);
      if (existing) {
        if (existing.config.secret !== bot.secret || existing.config.botId !== bot.botId) {
          logger.info(`[wecom-channel] bot ${bot.id} credentials changed, reconnecting`);
          existing.wsClient?.disconnect();
          existing.wsClient = null;
        }
        existing.config = bot;
      } else {
        logger.info(`[wecom-channel] adding bot ${bot.id}`);
        this.botPool.set(bot.id, { config: bot, wsClient: null, connecting: null, isConnected: false });
        this.connectBot(bot.id).catch((err) => {
          logger.error(`[wecom-channel] bot ${bot.id} connect failed:`, err);
          notifyExternal({ source: 'wecom:connect', level: 'warn', message: `企微 Bot 连接失败: ${errMessage(err)}` });
        });
      }
    }
  }

  setSessionBot(sessionId: string, botId: string): void { this.sessionBotMap.set(sessionId, botId); }
  clearSessionBot(sessionId: string): void { this.sessionBotMap.delete(sessionId); this.clearSessionMappings(sessionId); }

  clearSessionMappings(sessionId: string): void {
    const all = (routingStore.store as any) || {};
    const mappings = all.mappings || {};
    for (const [chatId, entry] of Object.entries(mappings)) {
      if ((entry as WeComRoutingEntry).sessionId === sessionId) {
        routingStore.delete(`mappings.${chatId}` as any);
      }
    }
    this.chatIdToSession.forEach((sid, chatId) => { if (sid === sessionId) this.chatIdToSession.delete(chatId); });
    this.lastActiveSession.forEach((sid, chatId) => { if (sid === sessionId) this.lastActiveSession.delete(chatId); });
  }

  // === OutputChannel: 接收来自 APIProxy 的事件（MVP 暂不路由） ===
  send(_event: LynelEnvelope): void { /* APIProxy 事件不在 VS Code MVP 中路由 */ }

  // === HookChannel: 接收来自 HookServer 的事件 ===
  sendHook(event: HookEventLike): void {
    if (event.kind === 'SessionEnd') { this.cardStore.cancelBySession(event.sessionId); }
    if (!this.isEnabled()) return;

    const msgSeq = (this.sessionSeqCounters.get(event.sessionId) ?? 0) + 1;
    this.sessionSeqCounters.set(event.sessionId, msgSeq);

    if (event.kind === 'PermissionRequest') {
      this.handlePermissionEvent(event, msgSeq);
      return;
    }
    if (event.kind === 'PermissionResolved') {
      const p = event.payload as any;
      if (p?.source === 'wecom') return;
      const header = this.formatSessionHeader(event.sessionId) ?? '';
      if (p?.source === 'terminal') {
        this.sendContent(this.buildMessage(header, '✅ **权限已在终端处理**', ''), event.sessionId).catch(() => {});
      } else {
        this.sendContent(this.buildMessage(header, `✅ **权限已处理: ${p?.decision}**`, ''), event.sessionId).catch(() => {});
      }
      return;
    }
    if (event.kind === 'SessionEnd') {
      const header = this.formatSessionHeader(event.sessionId) ?? '';
      this.sendContent(this.buildMessage(header, '📌 **会话结束**', ''), event.sessionId).catch(() => {});
      return;
    }
  }

  private handlePermissionEvent(event: HookEventLike, msgSeq: number): void {
    const p = event.payload as any;
    const toolName = p?.toolName || 'unknown';
    const entry = this.getBotForSession(event.sessionId);
    const chatId = entry ? this.getEffectiveChatId(entry) : '';
    if (chatId) this.recordRouting(chatId, event.sessionId);

    if (toolName === 'AskUserQuestion') {
      this.sendAskQuestionCard(event, msgSeq).catch((err) => {
        logger.error('[wecom-channel] sendAskQuestionCard failed:', err);
      });
    } else if (toolName === 'ExitPlanMode') {
      this.sendExitPlanCard(event, msgSeq).catch((err) => {
        logger.error('[wecom-channel] sendExitPlanCard failed:', err);
      });
    } else {
      this.sendPermissionCard(event, msgSeq).catch((err) => {
        logger.error('[wecom-channel] sendPermissionCard failed:', err);
      });
    }
  }

  // === 发送权限卡片 ===
  private async sendPermissionCard(event: HookEventLike, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const req: PermissionRequest = {
      id: p.id, sessionId: event.sessionId, workDir: event.workDir,
      toolName: p.toolName || 'unknown', toolInput: p.toolInput,
    };
    const seq = p.seq ?? msgSeq;
    const card = buildPermissionCard(req, seq, this.getSessionTitle(event.sessionId));
    const ok = await this.sendTemplateCard(card, event.sessionId, req.id, seq);
    if (!ok) {
      const content = this.formatPermissionRequest(
        this.formatSessionHeader(event.sessionId) ?? '',
        p.toolName || 'unknown', p.toolInput);
      await this.sendContent(content, event.sessionId);
    }
  }

  private async sendExitPlanCard(event: HookEventLike, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const req: PermissionRequest = {
      id: p.id, sessionId: event.sessionId, workDir: event.workDir,
      toolName: 'ExitPlanMode', toolInput: p.toolInput,
    };
    const seq = p.seq ?? msgSeq;
    const card = buildExitPlanCard(req, seq, this.getSessionTitle(event.sessionId));
    const ok = await this.sendTemplateCard(card, event.sessionId, req.id, seq);
    if (!ok) {
      const content = this.formatExitPlanRequest(
        this.formatSessionHeader(event.sessionId) ?? '', p.toolInput);
      await this.sendContent(content, event.sessionId);
    }
  }

  private async sendAskQuestionCard(event: HookEventLike, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const seq = p.seq ?? msgSeq;
    const input = p.toolInput as any;
    const reqId = p.id;
    const questions = (input?.questions ?? []) as AskQuestion[];
    const cards = buildAskQuestionCard(seq, input, reqId, this.getSessionTitle(event.sessionId), questions.length);
    if (cards.length === 0) {
      const content = this.formatAskUserQuestion(this.formatSessionHeader(event.sessionId) ?? '', input);
      await this.sendContent(content, event.sessionId); return;
    }
    if (cards.length === 1) {
      const ok = await this.sendTemplateCard(cards[0], event.sessionId, reqId, seq, 0);
      if (!ok) {
        const content = this.formatAskUserQuestion(this.formatSessionHeader(event.sessionId) ?? '', input);
        await this.sendContent(content, event.sessionId);
      }
      return;
    }
    // 多问题：先发文字预告
    const header = this.formatSessionHeader(event.sessionId) ?? '';
    const questionsList = questions
      .map((q, i) => {
        const opts = q.options.map((o) => `- ${o.label}${o.description ? ` - ${o.description}` : ''}`).join('\n');
        return `**${i + 1}. ${q.question}**${q.multiSelect ? '（多选）' : ''}\n${opts}`;
      }).join('\n');
    const intro = `${header}\n---\n\n**Agent 向你提了 ${questions.length} 个问题：**\n${questionsList}\n\n将逐一发送卡片，请依次作答。`;
    await this.sendContent(intro, event.sessionId);
    this.pendingQuestionCards.set(reqId, { cards, sessionId: event.sessionId, seq });
    const ok = await this.sendTemplateCard(cards[0], event.sessionId, reqId, seq, 0);
    if (!ok) {
      this.pendingQuestionCards.delete(reqId);
      const content = this.formatAskUserQuestion(header, input);
      await this.sendContent(content, event.sessionId);
    }
  }

  // === 公开方法：发送 API 活动到企业微信 ===
  async sendApiActivity(
    sessionId: string,
    activity: { seq: number; model: string; prompt: string; text: string; toolUses: { name: string; input: Record<string, unknown> }[]; usage: { input_tokens?: number; output_tokens?: number } | null },
  ): Promise<void> {
    logger.info(`[wecom-channel] sendApiActivity seq=${activity.seq} sid=${sessionId.slice(0, 8)} enabled=${this.isEnabled()} prompt=${activity.prompt.slice(0, 50)} text=${activity.text.slice(0, 50)} tools=${activity.toolUses.length}`);
    if (!this.isEnabled()) { logger.warn('[wecom-channel] sendApiActivity skipped: not enabled'); return; }
    const header = this.formatSessionHeader(sessionId) ?? '';
    const parts: string[] = [header, '---'];

    if (activity.prompt) {
      const truncated = activity.prompt.length > 300 ? activity.prompt.slice(0, 300) + '...' : activity.prompt;
      parts.push(`**Prompt:** ${truncated}`);
    }
    for (const tu of activity.toolUses) {
      const inputStr = JSON.stringify(tu.input).slice(0, 500);
      parts.push(`**Tool: ${tu.name}**\n\`\`\`json\n${inputStr}\n\`\`\``);
    }
    if (activity.text) {
      const truncated = activity.text.length > 2000 ? activity.text.slice(0, 2000) + '...' : activity.text;
      parts.push(truncated);
    }
    if (activity.usage) {
      const u = activity.usage;
      parts.push(`---\n*${activity.model || 'API'} | tokens: ${u.input_tokens ?? '?'}→${u.output_tokens ?? '?'}*`);
    }

    if (parts.length <= 2) { logger.info('[wecom-channel] sendApiActivity skipped: empty content'); return; }
    logger.info(`[wecom-channel] sendApiActivity sending ${parts.join('\n\n').length} chars`);
    await this.sendContent(parts.join('\n\n'), sessionId);
  }

  // === 消息发送 ===
  private async sendContent(content: string, sessionId: string): Promise<void> {
    const entry = this.getBotForSession(sessionId);
    if (!entry) { logger.warn(`[wecom-channel] sendContent: no bot for session ${sessionId.slice(0, 8)}, sessionBotMap has=${this.sessionBotMap.has(sessionId)} botPoolSize=${this.botPool.size}`); return; }
    if (content.length > WeComChannel.MARKDOWN_SAFE_LENGTH) {
      const overflow = content.length - WeComChannel.MARKDOWN_SAFE_LENGTH;
      content = content.slice(0, WeComChannel.MARKDOWN_SAFE_LENGTH) +
        `\n\n... (内容过长已截断 ${overflow} 字符)`;
    }
    const [plugin] = await Promise.all([loadWecomPlugin(), this.ensureBotWebSocket(entry.config.id)]);
    if (!plugin?.outbound?.sendText) { logger.warn('[wecom-channel] plugin outbound.sendText not available'); return; }
    const cfg = {
      channels: { wecom: { enabled: true, botId: entry.config.botId, secret: entry.config.secret, agent: this.cfg.agent } },
    };
    const sendFn = plugin.outbound.sendMarkdown || plugin.outbound.sendText;
    const chatId = this.getEffectiveChatId(entry);
    try {
      const result = await sendFn({ to: chatId, text: content, accountId: entry.config.id, cfg });
      logger.info('[wecom-channel] send success:', JSON.stringify(result));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error(`[wecom] content send failed: ${msg}`);
      notifyExternal({ source: `wecom:send:${sessionId.slice(0, 8)}`, level: 'error', message: `企微发送失败: ${msg.slice(0, 100)}` });
    }
  }

  // === 模板卡片 ===
  private async sendTemplateCard(
    card: unknown, sessionId: string, requestId: string, seq: number, qIdx?: number,
  ): Promise<boolean> {
    const entry = this.getBotForSession(sessionId);
    if (!entry) return false;
    try {
      await this.ensureBotWebSocket(entry.config.id);
      const chatId = this.getEffectiveChatId(entry);
      if (!entry.wsClient?.isConnected || !chatId) return false;
      const result = await entry.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card });
      const msgid = result?.body?.msgid ?? result?.headers?.req_id;
      if (msgid) {
        if (qIdx !== undefined) {
          if (qIdx === 0) this.cardStore.save(requestId, seq, chatId, msgid, sessionId);
          this.cardStore.addQuestionMsgid(requestId, qIdx, msgid);
        } else {
          this.cardStore.save(requestId, seq, chatId, msgid, sessionId);
        }
      }
      return true;
    } catch (err) { logger.error('[wecom-channel] sendTemplateCard failed:', err); return false; }
  }

  // === Bot 连接管理 ===
  private async ensureBotWebSocket(botId: string): Promise<void> {
    const entry = this.botPool.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not in pool`);
    if (entry.wsClient?.isConnected) return;
    if (entry.connecting) { await entry.connecting; return; }
    entry.connecting = this.connectBot(botId);
    try { await entry.connecting; } finally { entry.connecting = null; }
  }

  private async connectBot(botId: string): Promise<void> {
    const entry = this.botPool.get(botId);
    if (!entry) return;
    const { botId: wecomBotId, secret } = entry.config;
    logger.info(`[wecom-channel] connecting websocket for bot ${botId}...`);
    const [WSClient, setWeComWebSocket] = await Promise.all([getWSClientClass(), getSetWeComWebSocket()]);

    return new Promise((resolve, reject) => {
      const wsClient = new WSClient({
        botId: wecomBotId, secret,
        wsUrl: 'wss://openws.work.weixin.qq.com',
        heartbeatInterval: 30000, maxReconnectAttempts: 3, maxAuthFailureAttempts: 2,
        logger: {
          debug: () => {}, info: () => {},
          warn: (...args: any[]) => logger.warn('[wecom-channel] ws warn:', ...args),
          error: (...args: any[]) => logger.error('[wecom-channel] ws error:', ...args),
        },
      });

      const timer = setTimeout(() => { wsClient.disconnect(); reject(new Error('WeCom WebSocket 认证超时')); }, 15000);

      wsClient.on('authenticated', () => {
        logger.info(`[wecom-channel] websocket authenticated for bot ${botId}`);
        clearTimeout(timer);
        entry.wsClient = wsClient;
        entry.isConnected = true;
        setWeComWebSocket(botId, wsClient);
        resolve();
      });

      wsClient.on('message', (frame: any) => {
        try { this.handleInboundMessage(frame, botId); } catch (err) {
          logger.error(`[wecom-channel] bot ${botId} inbound failed:`, err);
        }
      });

      this.registerCardEventListener(wsClient, botId);

      wsClient.on('error', (err: any) => { clearTimeout(timer); entry.isConnected = false; reject(err); });
      wsClient.on('close', () => { entry.isConnected = false; entry.wsClient = null; });
      wsClient.connect();
    });
  }

  // === 入站消息处理 ===
  private handleInboundMessage(frame: any, botId?: string): void {
    this.currentBotId = botId;
    const body = frame?.body as any;
    if (!body) return;
    const chatId = body.chatid || body.from?.userid;
    if (!chatId) return;

    let text = this.extractInboundText(body);
    if (!text) return;

    // 剥离 @botname 前缀
    text = text.replace(/^@\S+\s*/, '').trimStart();
    if (!text) return;
    text = text.replace(/[\r\n]+$/, '');

    // 控制指令拦截
    const controlChar = CONTROL_COMMANDS[text];
    if (controlChar) {
      void this.handleControlCommand(chatId, text, controlChar);
      return;
    }

    // 路由到 session
    let sessionId: string | undefined;
    if (this.currentBotId) {
      for (const [sid, bid] of this.sessionBotMap) {
        if (bid === this.currentBotId) { sessionId = sid; break; }
      }
    }
    if (!sessionId) {
      const mapping = getMapping(chatId);
      if (mapping) sessionId = mapping.sessionId;
      else sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }
    if (!sessionId) {
      this.sendWeComReply(chatId, '当前没有绑定会话，请在 VS Code 中创建终端并绑定 Bot。').catch(() => {});
      return;
    }

    const s = session.lookup(sessionId);
    if (!s || !s.process) {
      this.sendWeComReplyWithHeader(chatId, `会话 ${sessionId.slice(0, 8)}... 不存在或未启动。`, sessionId).catch(() => {});
      return;
    }

    logger.info(`[wecom-channel] inbound → session ${sessionId.slice(0, 8)}...`);
    try { session.send(sessionId, text); } catch (err) {
      logger.error('[wecom-channel] failed to forward:', err);
    }
  }

  private async handleControlCommand(chatId: string, command: string, controlChar: string): Promise<void> {
    let sessionId: string | undefined;
    if (this.currentBotId) {
      for (const [sid, bid] of this.sessionBotMap) {
        if (bid === this.currentBotId) { sessionId = sid; break; }
      }
    }
    if (!sessionId) {
      const mapping = getMapping(chatId);
      if (mapping) sessionId = mapping.sessionId;
      else sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }
    if (!sessionId) { await this.sendWeComReply(chatId, '当前没有绑定会话。'); return; }
    const s = session.lookup(sessionId);
    if (!s || !s.process) { await this.sendWeComReplyWithHeader(chatId, `会话不存在或未启动。`, sessionId); return; }
    try {
      session.writeInput(sessionId, controlChar);
      const label = ['/interrupt', '/ctrl-c', '/ctrl+c'].includes(command) ? 'Ctrl+C (中断)'
        : ['/escape', '/esc'].includes(command) ? 'Esc' : command;
      await this.sendWeComReplyWithHeader(chatId, `已发送 ${label}`, sessionId);
    } catch (err) {
      logger.error(`[wecom-channel] control char failed:`, err);
      await this.sendWeComReply(chatId, `发送 ${command} 失败`);
    }
  }

  // === 回复消息 ===
  private async sendWeComReply(chatId: string, text: string): Promise<void> {
    let entry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
    if (!entry) entry = this.resolveBot();
    if (!entry) { logger.warn('[wecom-channel] no available bot'); return; }
    const plugin = await loadWecomPlugin();
    if (!plugin?.outbound?.sendText) { logger.warn('[wecom-channel] plugin outbound.sendText not available'); return; }
    await this.ensureBotWebSocket(entry.config.id);
    const cfg = {
      channels: { wecom: { enabled: true, botId: entry.config.botId, secret: entry.config.secret, agent: this.cfg.agent } },
    };
    try {
      await plugin.outbound.sendText({ to: chatId, text, accountId: entry.config.id, cfg });
    } catch (err) { logger.error('[wecom-channel] sendWeComReply failed:', err); }
  }

  private async sendWeComReplyWithHeader(chatId: string, text: string, sessionId?: string): Promise<void> {
    const header = sessionId ? this.formatSessionHeader(sessionId) : undefined;
    const fullText = header ? `${header}\n\n${text}` : text;
    await this.sendWeComReply(chatId, fullText);
  }

  private resolveBot(): BotConnectionState | undefined {
    let entry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
    if (!entry) {
      for (const state of this.botPool.values()) {
        if (state.wsClient) return state;
      }
    }
    return entry;
  }

  // === 卡片事件 ===
  private getCardEventHandler(): WeComCardEventHandler {
    if (!this.cardEventHandler) {
      this.cardEventHandler = new WeComCardEventHandler(
        this.cardStore,
        (chatId, text, requestId) => this.sendCardReplyWithHeader(chatId, text, requestId),
        async (frame, card) => {
          const botEntry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
          const wsClient = botEntry?.wsClient;
          if (!wsClient) throw new Error('WSClient 未连接');
          await wsClient.updateTemplateCard(frame, card);
        },
        {
          onQuestionProgress: async (requestId, nextQIdx) => {
            const pending = this.pendingQuestionCards.get(requestId);
            if (!pending || nextQIdx >= pending.cards.length) return;
            await this.sendTemplateCard(pending.cards[nextQIdx], pending.sessionId, requestId, pending.seq, nextQIdx);
          },
          onAllQuestionsDone: async (requestId, chatId, answers, questions) => {
            this.pendingQuestionCards.delete(requestId);
            const lines = questions.map((q) => {
              const answer = answers[q.question];
              const value = Array.isArray(answer) ? answer.join('、') : answer;
              const tag = q.multiSelect ? '（多选）' : '';
              return `- **${q.question}**${tag}：${value}`;
            });
            await this.sendCardReplyWithHeader(chatId, `已收集全部回答，已回复 Agent：\n${lines.join('\n')}`, requestId);
          },
        },
      );
    }
    return this.cardEventHandler;
  }

  private registerCardEventListener(wsClient: any, botId: string): void {
    wsClient.on('event.template_card_event', (frame: any) => {
      this.currentBotId = botId;
      this.getCardEventHandler().handle(frame).catch((err) =>
        logger.error('[wecom-channel] card event handle failed:', err));
    });
  }

  private async sendCardReplyWithHeader(chatId: string, text: string, requestId?: string): Promise<void> {
    const sessionId = requestId ? this.cardStore.get(requestId)?.sessionId : undefined;
    await this.sendWeComReplyWithHeader(chatId, text, sessionId);
  }

  // === 格式化工具 ===
  private recordRouting(chatId: string, sessionId: string): void {
    this.lastActiveSession.set(chatId, sessionId);
    this.chatIdToSession.set(chatId, sessionId);
    const s = session.lookup(sessionId);
    if (s) setMapping(chatId, sessionId, s.workDir);
  }

  private extractInboundText(body: any): string | undefined {
    if (body.msgtype === 'text' && typeof body.text?.content === 'string') return body.text.content.trim();
    if (body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item)) {
      const parts: string[] = [];
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'text' && typeof item.text?.content === 'string') parts.push(item.text.content);
      }
      const joined = parts.join('\n').trim();
      return joined || undefined;
    }
    return undefined;
  }

  private getSessionListIndex(sessionId: string): string {
    const all = session.list();
    const idx = all.findIndex((s) => s.id === sessionId);
    return idx >= 0 ? `会话#${idx + 1}` : '?';
  }

  private formatSessionHeader(sessionId: string): string | undefined {
    const s = session.lookup(sessionId);
    if (!s) return undefined;
    const project = path.basename(s.workDir);
    const sid = sessionId.slice(0, 8);
    const sessionIdx = this.getSessionListIndex(sessionId);
    return `**${project}** · ${sessionIdx} · \`${sid}\``;
  }

  private buildMessage(header: string, role: string, body: string): string {
    const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
    return `${header}\n\n${role}\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
  }

  private formatToolInputPreview(input: unknown): string {
    const p = input as Record<string, any> | undefined;
    if (!p || typeof p !== 'object') return '';
    if (p.command) { const cmd = String(p.command); return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd; }
    if (p.file_path || p.path) return String(p.file_path || p.path);
    return '';
  }

  private formatPermissionRequest(header: string, toolName: string, input: unknown): string {
    const preview = this.formatToolInputPreview(input);
    const inputBlock = preview ? `\n\`\`\`\n${preview}\n\`\`\`` : '';
    return `${header}\n\n🔐 **权限请求：${toolName}**\n**━━━━━━━━━━━━━━━━**${inputBlock}`;
  }

  private formatExitPlanRequest(header: string, input: unknown): string {
    const p = input as Record<string, any> | undefined;
    const plan = typeof p?.plan === 'string' ? p.plan : '';
    const allowedPrompts = Array.isArray(p?.allowedPrompts) ? p.allowedPrompts : [];
    const lines: string[] = [];
    if (plan) {
      const MAX = 800;
      const trunc = plan.length > MAX ? plan.slice(0, MAX) + `\n\n... (${plan.length - MAX} 字符已省略)` : plan;
      lines.push(trunc);
    }
    if (allowedPrompts.length > 0) {
      lines.push('\n**批准后允许执行：**');
      for (const ap of allowedPrompts) lines.push(`- \`${ap.tool}\`: ${ap.prompt}`);
    }
    const body = lines.join('\n');
    const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
    return `${header}\n\n🗂️ **退出计划模式**\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
  }

  private formatAskUserQuestion(header: string, input: unknown): string {
    const questions = this.parseAskQuestions(input);
    if (questions.length === 0) return `${header}\n\n❓ **Agent 向你提问**\n**━━━━━━━━━━━━━━━━**`;
    const lines: string[] = ['', '**Agent 向你提问：**', ''];
    questions.forEach((q, idx) => {
      lines.push(`${idx + 1}. ${q.header || q.question}`);
      if (q.question && q.header && q.header !== q.question) lines.push(`   ${q.question}`);
      q.options.forEach((opt, optIdx) => {
        const num = optIdx + 1;
        const desc = opt.description ? ` (${opt.description})` : '';
        lines.push(`   ${num}. ${opt.label}${desc}`);
      });
      if (q.multiSelect) lines.push('   *多选，用逗号分隔*');
      lines.push('');
    });
    const body = lines.slice(2).join('\n');
    const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
    return `${header}\n\n❓ **Agent 向你提问：**\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
  }

  private parseAskQuestions(input: unknown): AskQuestion[] {
    const p = input as Record<string, any> | undefined;
    if (!p || typeof p !== 'object') return [];
    const raw = p.questions;
    if (!Array.isArray(raw)) return [];
    return raw.map((q: any) => ({
      header: typeof q.header === 'string' ? q.header : undefined,
      question: typeof q.question === 'string' ? q.question : '',
      multiSelect: !!q.multiSelect,
      options: Array.isArray(q.options) ? q.options.map((o: any) => ({
        label: typeof o.label === 'string' ? o.label : '',
        description: typeof o.description === 'string' ? o.description : undefined,
      })) : [],
    }));
  }

  dispose(): void { this.close(); }

  close(): void {
    for (const [id, state] of this.botPool) {
      logger.info(`[wecom-channel] disconnecting bot ${id}`);
      state.wsClient?.disconnect();
      state.wsClient = null;
      state.isConnected = false;
    }
  }
}
