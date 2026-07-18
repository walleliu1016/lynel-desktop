import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { OutputChannel, ProxyStageEvent } from './channel.js';
import * as session from '../session.js';
import { getStore } from '../store.js';
import { getLogger } from '../log.js';
import { permissionBroker, PermissionRequest } from '../permission-broker.js';
import { buildPermissionCard, buildAskQuestionCard } from './wecom-cards/card-builder.js';
import { WeComCardStore } from './wecom-cards/card-store.js';
import { WeComCardEventHandler, type TemplateCardEventFrame } from './wecom-cards/event-handler.js';

const logger = getLogger().scope('wecom-channel');

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

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: AskOption[];
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
    return { error: `未找到匹配会话：${arg}，请发送 /list 查看。` };
  }
  if (matches.length > 1) {
    return { error: `找到 ${matches.length} 个匹配会话，请使用完整 session ID。` };
  }
  return { id: matches[0].id, workDir: matches[0].workDir };
}

async function resolvePluginRoot(): Promise<string> {
  const url = await (import.meta as any).resolve('@wecom/wecom-openclaw-plugin');
  const entryPath = fileURLToPath(url);
  // import.meta.resolve 指向 dist/index.js，包根目录是其父目录
  return path.dirname(path.dirname(entryPath));
}

async function loadPlugin(): Promise<any> {
  if (pluginModule) return pluginModule;
  logger.info('[wecom-channel] loadPlugin from npm package');
  try {
    pluginModule = await import('@wecom/wecom-openclaw-plugin');
    logger.info(`[wecom-channel] loadPlugin success defaultKeys=${pluginModule?.default ? Object.keys(pluginModule.default) : 'none'}`);
  } catch (err) {
    logger.error('[wecom-channel] failed to load plugin:', err);
  }
  return pluginModule;
}

async function loadWecomPlugin(): Promise<any> {
  if (wecomPlugin) return wecomPlugin;
  const module = await loadPlugin();
  if (!module?.default?.register) {
    logger.warn('[wecom-channel] loadWecomPlugin plugin default.register not found');
    return null;
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
    registerChannel: ({ plugin }: { plugin: any }) => {
      wecomPlugin = plugin;
    },
    registerTool: () => {},
    registerHttpRoute: () => {},
    on: () => {},
  };
  module.default.register(mockApi);
  logger.info(`[wecom-channel] loadWecomPlugin registered outboundKeys=${wecomPlugin?.outbound ? Object.keys(wecomPlugin.outbound) : 'none'}`);
  return wecomPlugin;
}

async function getSetWeComWebSocket(): Promise<(client: any, accountId: string) => void> {
  if (stateManagerModule) return stateManagerModule.setWeComWebSocket;
  const pluginRoot = await resolvePluginRoot();
  stateManagerModule = await import(pathToFileURL(path.join(pluginRoot, 'dist/src/state-manager.js')).href);
  return stateManagerModule.setWeComWebSocket;
}

async function getWSClientClass(): Promise<any> {
  if (wsClientModule) return wsClientModule.WSClient;
  wsClientModule = await import('@wecom/aibot-node-sdk');
  return wsClientModule.WSClient;
}

export class WeComChannel implements OutputChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private cfg: WeComChannelConfig;
  private wsClient: any = null;
  private connecting: Promise<void> | null = null;
  private chatIdToSession = new Map<string, string>();
  private lastActiveSession = new Map<string, string>();
  private sessionSeqCounters = new Map<string, number>();
  private createSessionCallback: ((workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>) | null = null;
  private cardStore = new WeComCardStore();
  private cardEventHandler?: WeComCardEventHandler;
  private sessionTitleResolver: ((sessionId: string) => string) | null = null;
  /** 多问题场景：暂存待发送的卡片数据 */
  private pendingQuestionCards = new Map<string, {
    cards: unknown[];
    sessionId: string;
    seq: number;
  }>();

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  setCreateSessionHandler(handler: (workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>): void {
    this.createSessionCallback = handler;
  }

  setSessionTitleResolver(resolver: (sessionId: string) => string): void {
    this.sessionTitleResolver = resolver;
  }

  private getSessionTitle(sessionId: string): string | undefined {
    if (!this.sessionTitleResolver) return undefined;
    try {
      return this.sessionTitleResolver(sessionId);
    } catch {
      return undefined;
    }
  }

  isEnabled(): boolean {
    const ok = this.cfg.enabled && !!this.cfg.chatId && (!!this.cfg.botId || !!this.cfg.agent);
    logger.info(`[wecom-channel] isEnabled=${ok} enabled=${this.cfg.enabled} chatId=${this.cfg.chatId ? 'set' : 'unset'} botId=${this.cfg.botId ? 'set' : 'unset'}`);
    return ok;
  }

  updateConfig(cfg: WeComChannelConfig): void {
    logger.info('[wecom-channel] updateConfig', { enabled: cfg.enabled, chatId: cfg.chatId, botId: cfg.botId ? 'set' : 'unset' });
    this.cfg = cfg;
    if (!this.isEnabled()) {
      this.disconnect();
      return;
    }
    // 预加载插件并预连接 websocket，避免第一次发送消息时才阻塞
    if (this.cfg.botId && this.cfg.secret) {
      this.preconnect().catch((err) => logger.error('[wecom-channel] proactive init failed:', err));
    }
  }

  private async preconnect(): Promise<void> {
    logger.info('[wecom-channel] preconnect start');
    await Promise.all([loadWecomPlugin(), this.ensureWebSocket()]);
    logger.info('[wecom-channel] preconnect done');
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
    logger.info(`[wecom-channel] receive event ${event.kind} (sid=${event.sessionId.slice(0, 8)}...)`);

    // 无论频道是否启用，会话结束时都应清理该会话的卡片状态
    if (event.kind === 'SessionEnd') {
      this.cardStore.cancelBySession(event.sessionId);
    }

    if (!this.isEnabled()) {
      logger.info('[wecom-channel] disabled, skip');
      return;
    }

    const outboundEvents = ['prompt', 'tool_use', 'response_complete', 'PermissionRequest', 'PermissionResolved', 'tool_result', 'SessionEnd', 'error'];
    if (!outboundEvents.includes(event.kind)) {
      logger.info(`[wecom-channel] event ${event.kind} not in outbound list, skip`);
      return;
    }

    // prompt 会同时来自 hook（UserPromptSubmit，seq=0）和 apiproxy（实际 API 请求，seq>0），
    // 只保留 apiproxy 来源，避免企业微信里同一条用户消息出现两次。
    if (event.kind === 'prompt' && event.seq === 0) {
      logger.info('[wecom-channel] skip hook-sourced prompt (will be sent via apiproxy)');
      return;
    }

    const msgSeq = (this.sessionSeqCounters.get(event.sessionId) ?? 0) + 1;
    this.sessionSeqCounters.set(event.sessionId, msgSeq);

    // 权限请求/提问使用模板卡片，失败后再降级为 Markdown
    if (event.kind === 'PermissionRequest') {
      const p = event.payload as any;
      const toolName = p?.toolName || 'unknown';
      if (toolName === 'AskUserQuestion') {
        this.sendAskQuestionCard(event, msgSeq).catch((err) => logger.error('[wecom-channel] sendAskQuestionCard failed:', err));
      } else {
        this.sendPermissionCard(event, msgSeq).catch((err) => logger.error('[wecom-channel] sendPermissionCard failed:', err));
      }
      // 仍然记录路由关系
      if (this.cfg.chatId) {
        this.recordRouting(this.cfg.chatId, event.sessionId);
      }
      return;
    }

    const content = this.formatMessage(event, msgSeq);
    if (!content) {
      logger.info('[wecom-channel] empty content, skip');
      return;
    }
    logger.info(`[wecom-channel] formatted content: ${content.slice(0, 80)}...`);

    // 记录会话路由关系，方便企业微信入站消息找到对应 session
    if (this.cfg.chatId) {
      this.recordRouting(this.cfg.chatId, event.sessionId);
    }

    // 异步发送，不阻塞 dispatcher / 主进程事件循环
    this.sendContent(content, event.sessionId).catch((err) => logger.error('[wecom-channel] send failed:', err));
  }

  private recordRouting(chatId: string, sessionId: string): void {
    this.lastActiveSession.set(chatId, sessionId);
    this.chatIdToSession.set(chatId, sessionId);
    const s = session.lookup(sessionId);
    if (s) {
      setMapping(chatId, sessionId, s.workDir);
    }
  }

  private async sendContent(content: string, _sessionId: string): Promise<void> {
    const [plugin] = await Promise.all([loadWecomPlugin(), this.ensureWebSocket()]);
    if (!plugin?.outbound?.sendText) {
      logger.warn('[wecom-channel] plugin outbound.sendText not available');
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

    // 优先使用 sendMarkdown（支持富文本），回退到 sendText
    const sendFn = plugin.outbound.sendMarkdown || plugin.outbound.sendText;
    logger.info(`[wecom-channel] sending to WeCom via ${plugin.outbound.sendMarkdown ? 'sendMarkdown' : 'sendText'}...`);
    const result = await sendFn({
      to: this.cfg.chatId,
      text: content,
      accountId: 'default',
      cfg,
    });
    logger.info('[wecom-channel] send success:', JSON.stringify(result));
  }

  private async sendPermissionCard(event: ProxyStageEvent, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const req: PermissionRequest = {
      id: p.id,
      sessionId: event.sessionId,
      workDir: event.workDir,
      toolName: p.toolName || 'unknown',
      toolInput: p.toolInput,
    };
    const seq = p.seq ?? msgSeq;
    const sessionTitle = this.getSessionTitle(event.sessionId);
    const card = buildPermissionCard(req, seq, sessionTitle);
    const ok = await this.sendTemplateCard(card, event.sessionId, req.id, seq);
    if (!ok) {
      const content = this.formatPermissionRequest(
        this.formatHeader(event, msgSeq),
        p.toolName || 'unknown',
        p.toolInput,
        this.getSessionCmdArg(event.sessionId),
      );
      await this.sendContent(content, event.sessionId);
    }
  }

  private async sendAskQuestionCard(event: ProxyStageEvent, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const seq = p.seq ?? msgSeq;
    const input = p.toolInput as any;
    const reqId = p.id;
    const questions = (input?.questions ?? []) as AskQuestion[];
    const sessionTitle = this.getSessionTitle(event.sessionId);
    const cards = buildAskQuestionCard(seq, input, reqId, sessionTitle, questions.length);
    if (cards.length === 0) {
      // 问题列表为空，直接降级为 Markdown
      const content = this.formatAskUserQuestion(
        this.formatHeader(event, msgSeq),
        input,
        this.getSessionCmdArg(event.sessionId),
      );
      await this.sendContent(content, event.sessionId);
      return;
    }

    // 单问题：直接发送卡片
    if (cards.length === 1) {
      const ok = await this.sendTemplateCard(cards[0], event.sessionId, reqId, seq, 0);
      if (!ok) {
        const content = this.formatAskUserQuestion(
          this.formatHeader(event, msgSeq),
          input,
          this.getSessionCmdArg(event.sessionId),
        );
        await this.sendContent(content, event.sessionId);
      }
      return;
    }

    // 多问题：先发文字预告（含选项），再发第一张卡片，其余等用户作答后依次发送
    const header = this.formatHeader(event, msgSeq);
    const questionsList = questions
      .map((q, i) => {
        const opts = q.options
          .map((o) => `- ${o.label}${o.description ? ` - ${o.description}` : ''}`)
          .join('\n');
        return `**${i + 1}. ${q.question}**${q.multiSelect ? '（多选）' : ''}\n${opts}`;
      })
      .join('\n');
    const intro = `${header}\n\n**Claude 向你提了 ${questions.length} 个问题：**\n${questionsList}\n\n将逐一发送卡片，请依次作答。`;
    await this.sendContent(intro, event.sessionId);

    // 暂存剩余卡片，发送第一张
    this.pendingQuestionCards.set(reqId, { cards, sessionId: event.sessionId, seq });
    logger.info('[wecom-channel] multi-question: stored %d pending cards for reqId=%s', cards.length, reqId);
    const ok = await this.sendTemplateCard(cards[0], event.sessionId, reqId, seq, 0);
    if (!ok) {
      this.pendingQuestionCards.delete(reqId);
      const content = this.formatAskUserQuestion(
        this.formatHeader(event, msgSeq),
        input,
        this.getSessionCmdArg(event.sessionId),
      );
      await this.sendContent(content, event.sessionId);
    }
  }

  private async sendTemplateCard(
    card: unknown,
    sessionId: string,
    requestId: string,
    seq: number,
    qIdx?: number,
  ): Promise<boolean> {
    try {
      logger.info('[wecom-channel] sendTemplateCard start: wsConnected=%s, chatId=%s, cardType=%s',
        String(this.wsClient?.isConnected ?? false), this.cfg.chatId || '<none>',
        (card as any)?.card_type);
      await this.ensureWebSocket();
      logger.info('[wecom-channel] sendTemplateCard after ensure: wsConnected=%s',
        String(this.wsClient?.isConnected ?? false));
      if (!this.wsClient?.isConnected || !this.cfg.chatId) {
        logger.warn('[wecom-channel] sendTemplateCard abort: ws=%s chatId=%s',
          String(this.wsClient?.isConnected ?? false), String(this.cfg.chatId));
        return false;
      }

      const body = {
        msgtype: 'template_card' as const,
        template_card: card,
      };
      logger.info('[wecom-channel] sendTemplateCard sending to chatId=%s', this.cfg.chatId);
      const result = await this.wsClient.sendMessage(this.cfg.chatId, body);
      logger.info('[wecom-channel] sendTemplateCard result: %s', JSON.stringify(result).slice(0, 200));

      const msgid = result?.body?.msgid ?? result?.headers?.req_id;
      if (msgid) {
        if (qIdx !== undefined) {
          // 多卡片场景：第一张卡片初始化 state，后续追加 msgid
          if (qIdx === 0) {
            this.cardStore.save(requestId, seq, this.cfg.chatId, msgid, sessionId);
          }
          this.cardStore.addQuestionMsgid(requestId, qIdx, msgid);
        } else {
          this.cardStore.save(requestId, seq, this.cfg.chatId, msgid, sessionId);
        }
      }
      return true;
    } catch (err) {
      logger.error('[wecom-channel] sendTemplateCard failed:', err);
      return false;
    }
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
    logger.info('[wecom-channel] connecting websocket...');
    const WSClient = await getWSClientClass();
    const setWeComWebSocket = await getSetWeComWebSocket();
    logger.info('[wecom-channel] WSClient loaded');

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
          warn: (...args: any[]) => logger.warn('[wecom-channel] ws warn:', ...args),
          error: (...args: any[]) => logger.error('[wecom-channel] ws error:', ...args),
        },
      });

      const timer = setTimeout(() => {
        wsClient.disconnect();
        reject(new Error('WeCom WebSocket 认证超时'));
      }, 15000);

      wsClient.on('authenticated', () => {
        logger.info('[wecom-channel] websocket authenticated');
        clearTimeout(timer);
        this.wsClient = wsClient;
        setWeComWebSocket('default', wsClient);
        resolve();
      });

      wsClient.on('message', (frame: any) => {
        try {
          this.handleInboundMessage(frame);
        } catch (err) {
          logger.error('[wecom-channel] failed to handle inbound message:', err);
        }
      });

      this.registerCardEventListener(wsClient);

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

  private getCardEventHandler(): WeComCardEventHandler {
    if (!this.cardEventHandler) {
      this.cardEventHandler = new WeComCardEventHandler(
        this.cardStore,
        (chatId, text, requestId) => this.sendCardReplyWithHeader(chatId, text, requestId),
        async (frame: TemplateCardEventFrame, card: unknown) => {
          if (!this.wsClient) throw new Error('WSClient 未连接');
          await this.wsClient.updateTemplateCard(frame, card);
        },
        {
          onQuestionProgress: async (requestId, nextQIdx, chatId) => {
            logger.info('[wecom-channel] onQuestionProgress: reqId=%s nextQIdx=%d', requestId, nextQIdx);
            const pending = this.pendingQuestionCards.get(requestId);
            if (!pending) {
              logger.warn('[wecom-channel] onQuestionProgress: no pending cards for reqId=%s', requestId);
              return;
            }
            if (nextQIdx >= pending.cards.length) {
              logger.warn('[wecom-channel] onQuestionProgress: nextQIdx=%d >= cards.length=%d', nextQIdx, pending.cards.length);
              return;
            }
            logger.info('[wecom-channel] onQuestionProgress: sending card %d/%d', nextQIdx + 1, pending.cards.length);
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
            const summary = `已收集全部回答，已回复 Claude：\n${lines.join('\n')}`;
            await this.sendCardReplyWithHeader(chatId, summary, requestId);
          },
        },
      );
    }
    return this.cardEventHandler;
  }

  private registerCardEventListener(wsClient: any): void {
    wsClient.on('event.template_card_event', (frame: any) => {
      this.getCardEventHandler()
        .handle(frame)
        .catch((err) => logger.error('[wecom-channel] failed to handle card event:', err));
    });
  }

  private handleInboundMessage(frame: any): void {
    logger.info('[wecom-channel] inbound frame received');
    const body = frame?.body as any;
    if (!body) {
      logger.info('[wecom-channel] inbound frame has no body');
      return;
    }

    const chatId = body.chatid || body.from?.userid;
    if (!chatId) {
      logger.info('[wecom-channel] inbound message has no chatId', { body });
      return;
    }

    let text = this.extractInboundText(body);
    logger.info(`[wecom-channel] inbound from ${chatId} text=${text}`);
    if (!text) {
      logger.info('[wecom-channel] inbound message has no text content', { msgtype: body.msgtype });
      return;
    }

    // 剥离群聊中 @botname 前缀，确保命令检测不受影响
    text = text.replace(/^@\S+\s*/, '').trimStart();
    if (!text) {
      logger.info('[wecom-channel] inbound message empty after stripping @mention');
      return;
    }
    logger.info(`[wecom-channel] after strip text=${text}`);

    // 单条消息指定 session，不修改默认绑定
    if (text.startsWith('/to ')) {
      this.handleToCommand(chatId, text).catch((err) => logger.error('[wecom-channel] /to failed:', err));
      return;
    }

    // 其他命令消息在企业微信侧处理，不送给 Claude
    if (text.startsWith('/')) {
      this.handleCommand(chatId, text).catch((err) => logger.error('[wecom-channel] command failed:', err));
      return;
    }

    // 通过引用消息中的会话头部直接路由，无需 /to
    const quoteRouting = this.resolveSessionFromQuote(body);
    if (quoteRouting) {
      if ('error' in quoteRouting) {
        this.sendWeComReplyWithHeader(chatId, quoteRouting.error, quoteRouting.id).catch((err) =>
          logger.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      const s = session.lookup(quoteRouting.id);
      if (!s || !s.process) {
        this.sendWeComReplyWithHeader(chatId, `引用的会话 ${quoteRouting.id.slice(0, 8)}... 不存在或未启动。`, quoteRouting.id).catch((err) =>
          logger.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      logger.info(`[wecom-channel] inbound message from ${chatId}, routed by quote to session ${quoteRouting.id.slice(0, 8)}...`);
      try {
        session.send(quoteRouting.id, text);
      } catch (err) {
        logger.error('[wecom-channel] failed to forward quote-routed message to session:', err);
      }
      return;
    }

    // 优先用持久化映射，其次内存映射，最后最近活跃 session
    const mapping = getMapping(chatId);
    let sessionId: string | undefined;
    if (mapping) {
      const s = session.lookup(mapping.sessionId);
      if (!s) {
        this.sendWeComReplyWithHeader(chatId, '绑定的会话已不存在，请发送 /bind 重新绑定。', mapping.sessionId).catch((err) =>
          logger.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      if (s.workDir !== mapping.workDir) {
        this.sendWeComReplyWithHeader(chatId, '绑定会话的工作目录已变更，请发送 /bind 重新绑定。', mapping.sessionId).catch((err) =>
          logger.error('[wecom-channel] failed to send reply:', err),
        );
        return;
      }
      sessionId = mapping.sessionId;
    } else {
      sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }
    if (!sessionId) {
      logger.info('[wecom-channel] no active session for inbound message');
      this.sendWeComReply(chatId, '当前没有绑定会话，请发送 /list 查看，或 /bind <sessionId> / /bind <序号> 绑定。').catch((err) =>
        logger.error('[wecom-channel] failed to send reply:', err),
      );
      return;
    }

    const s = session.lookup(sessionId);
    if (!s || !s.process) {
      logger.info(`[wecom-channel] session ${sessionId.slice(0, 8)}... not found or no process`);
      this.sendWeComReplyWithHeader(chatId, `会话 ${sessionId.slice(0, 8)}... 不存在或未启动，请重新绑定。`, sessionId).catch((err) =>
        logger.error('[wecom-channel] failed to send reply:', err),
      );
      return;
    }

    logger.info(`[wecom-channel] inbound message from ${chatId}, forward to session ${sessionId.slice(0, 8)}...`);
    try {
      session.send(sessionId, text);
    } catch (err) {
      logger.error('[wecom-channel] failed to forward inbound message to session:', err);
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

  /**
   * 从引用消息内容中解析会话标识。
   * 优先匹配完整头部格式，其次单独匹配会话序号。
   */
  private resolveSessionFromQuote(body: any): { id: string; workDir: string } | { error: string } | undefined {
    const quoteText = body?.quote?.text?.content;
    if (typeof quoteText !== 'string') {
      return undefined;
    }

    // 优先匹配完整头部：> **project** · 会话#N · `xxxxxxxx`
    const headerMatch = quoteText.match(/> \*\*[^*]+\*\* · 会话#(\d+) · `([a-z0-9]{8})`/);
    if (headerMatch) {
      const resolved = resolveSessionArg(headerMatch[1]);
      if ('error' in resolved) {
        return { error: `引用消息中的会话无效：${resolved.error}` };
      }
      return resolved;
    }

    // 兼容只引用到部分头部的情况
    const idxMatch = quoteText.match(/会话#(\d+)/);
    if (idxMatch) {
      const resolved = resolveSessionArg(idxMatch[1]);
      if ('error' in resolved) {
        return { error: `引用消息中的会话无效：${resolved.error}` };
      }
      return resolved;
    }

    return undefined;
  }

  private async handleCommand(chatId: string, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1];
    logger.info(`[wecom-channel] handleCommand cmd=${cmd} arg=${arg} chatId=${chatId}`);

    switch (cmd) {
      case '/bind':
      case '/switch': {
        if (!arg) {
          await this.sendWeComReply(chatId, '用法：/bind <sessionId> 或 /bind <序号>，先发送 /list 查看列表。');
          return;
        }
        const resolved = resolveSessionArg(arg);
        if ('error' in resolved) {
          await this.sendWeComReply(chatId, resolved.error);
          return;
        }
        setMapping(chatId, resolved.id, resolved.workDir);
        await this.sendWeComReply(
          chatId,
          '**已绑定会话**\n\n' +
          '| 项目 | 值 |\n' +
          '|------|------|\n' +
          `| 会话ID | \`${resolved.id.slice(0, 8)}\` |\n` +
          `| 工作目录 | ${resolved.workDir} |`,
        );
        return;
      }
      case '/unbind':
      case '/close': {
        deleteMapping(chatId);
        await this.sendWeComReply(chatId, '**已解绑**\n\n当前聊天不再关联任何会话。');
        return;
      }
      case '/status': {
        const mapping = getMapping(chatId);
        if (!mapping) {
          await this.sendWeComReply(chatId, '当前聊天未绑定会话。发送 /list 查看可用会话，或 /bind <sessionId> 绑定。');
          return;
        }
        const s = session.lookup(mapping.sessionId);
        const state = s?.state ?? 'unknown';
        await this.sendWeComReply(
          chatId,
          '**当前绑定状态**\n\n' +
          '| 项目 | 值 |\n' +
          '|------|------|\n' +
          `| 会话ID | \`${mapping.sessionId.slice(0, 8)}\` |\n` +
          `| 状态 | ${state} |\n` +
          `| 工作目录 | ${mapping.workDir} |`,
        );
        return;
      }
      case '/create':
      case '/new': {
        if (!this.createSessionCallback) {
          await this.sendWeComReply(chatId, '创建会话功能暂不可用。');
          return;
        }
        const rest = text.trim().slice(cmd.length).trim();
        if (!rest) {
          await this.sendWeComReply(chatId, '用法：`/create <工作目录> [提示词]`\n\n示例：\n```\n/create /home/user/project 帮我优化代码\n```');
          return;
        }
        const args = rest.split(/\s+/);
        const workDir = args[0].replace(/^~(?=[\/\\]|$)/, os.homedir());
        const prompt = args.slice(1).join(' ').trim();
        await this.sendWeComReply(chatId, '正在创建新会话…');
        try {
          const result = await this.createSessionCallback(workDir, prompt);
          if ('error' in result) {
            await this.sendWeComReply(chatId, `创建失败：${result.error}`);
            return;
          }
          setMapping(chatId, result.id, result.workDir);
          const seq = session.list().length; // 新创建的在末尾，序号即总数
          await this.sendWeComReply(
            chatId,
            '**已创建并绑定新会话**\n\n' +
            '| 项目 | 值 |\n' +
            '|------|------|\n' +
            `| 序号 | ${seq} |\n` +
            `| 会话ID | \`${result.id.slice(0, 8)}\` |\n` +
            `| 工作目录 | ${result.workDir} |` +
            (prompt ? `\n| 提示词 | ${prompt} |` : ''),
          );
        } catch (err: any) {
          await this.sendWeComReply(chatId, `创建失败：${err.message}`);
        }
        return;
      }
      case '/allow':
      case '/allowed':
      case '/允许':
      case '/y': {
        await this.handleAllowDeny(chatId, true, arg);
        return;
      }
      case '/deny':
      case '/拒绝':
      case '/n': {
        await this.handleAllowDeny(chatId, false, arg);
        return;
      }
      case '/answer':
      case '/回答': {
        await this.handleAnswerCommand(chatId, text);
        return;
      }
      case '/pending': {
        await this.handlePendingCommand(chatId);
        return;
      }
      case '/list': {
        const sessions = session.list();
        if (sessions.length === 0) {
          await this.sendWeComReply(chatId, '当前没有可用会话。请先在 Lynel Desktop 中创建或打开一个会话。');
          return;
        }
        const lines = sessions.map((s, i) => {
          const project = path.basename(s.workDir);
          return `| ${i + 1} | \`${s.id.slice(0, 8)}\` | ${s.state} | ${project} |`;
        });
        await this.sendWeComReply(
          chatId,
          '**可用会话**\n\n' +
          '| 序号 | 会话ID | 状态 | 项目 |\n' +
          '|------|--------|------|------|\n' +
          lines.join('\n'),
        );
        return;
      }
      case '/help': {
        await this.sendWeComReply(
          chatId,
          '**Lynel 企业微信助手**\n\n' +
          '**可用命令**\n\n' +
          '| 命令 | 说明 |\n' +
          '|------|------|\n' +
          '| `/list` | 查看可用会话列表 |\n' +
          '| `/create <工作目录> [提示词]` `/new ...` | 创建新会话 |\n' +
          '| `/bind <sessionId/序号>` | 绑定会话到当前聊天 |\n' +
          '| `/switch <sessionId/序号>` | 切换绑定会话 |\n' +
          '| `/status` | 查看当前绑定状态 |\n' +
          '| `/unbind` `/close` | 解绑当前聊天 |\n' +
          '| `/to <sessionId/序号> <消息>` | 临时发送消息到指定会话 |\n' +
          '| `/allow [会话序号/sessionId]` `/允许` `/y` | 批准权限请求（省略则处理最近一条） |\n' +
          '| `/deny [会话序号/sessionId]` `/拒绝` `/n` | 拒绝权限请求（省略则处理最近一条） |\n' +
          '| `/pending` | 查看待处理权限/提问 |\n' +
          '| `/answer <会话序号/sessionId> <答案>` `/回答` | 回答 Claude 提问 |\n' +
          '| `/help` | 显示此帮助信息 |\n\n' +
          '**快捷操作**\n\n' +
          '引用任意一条机器人发送的消息并直接输入内容，会自动转发到该消息所属的会话，无需 `/to`。\n\n' +
          '**使用示例**\n\n' +
          '1. 查看会话并绑定\n' +
          '```\n/list\n/bind 1\n```\n\n' +
          '2. 创建新会话\n' +
          '```\n/create /home/user/project 帮我优化代码\n```\n\n' +
          '3. 批准会话 3 的权限请求\n' +
          '```\n/allow 3\n```\n' +
          '或直接回复（处理最近一条）：\n' +
          '```\n/y\n```\n\n' +
          '4. 回答会话 3 的 Claude 提问（单选 / 多选 / 自定义）\n' +
          '```\n/answer 3 1\n/answer 3 1,2\n/answer 3 我的自定义回答\n```\n\n' +
          '5. 临时向第 2 个会话发送消息\n' +
          '```\n/to 2 帮我优化这段代码\n```',
        );
        return;
      }
      default: {
        await this.sendWeComReply(
          chatId,
          '未知命令。发送 /help 查看可用命令。',
        );
        return;
      }
    }
  }

  private async handleAllowDeny(chatId: string, isAllow: boolean, arg?: string): Promise<void> {
    if (arg) {
      // 参数是会话序号（/list 中的编号）或 sessionId（前缀），定位到该会话的待处理请求
      const resolved = resolveSessionArg(arg);
      if ('error' in resolved) {
        await this.sendWeComReply(chatId, resolved.error);
        return;
      }
      const label = this.getSessionListIndex(resolved.id);
      const ok = permissionBroker.resolveBySession(resolved.id, isAllow ? 'allow' : 'deny', 'wecom');
      if (ok) {
        await this.sendWeComReplyWithHeader(chatId, `已${isAllow ? '批准' : '拒绝'} ${label} 的权限请求`, resolved.id);
      } else {
        await this.sendWeComReplyWithHeader(chatId, `${label} 当前没有待处理的权限请求。`, resolved.id);
      }
      return;
    }

    // 没有参数时，取当前绑定会话的最近一条待处理权限
    const mapping = getMapping(chatId);
    const pending = permissionBroker
      .listPending()
      .filter((p) => (mapping ? p.request.sessionId === mapping.sessionId : true))
      .sort((a, b) => b.seq - a.seq);
    if (pending.length === 0) {
      await this.sendWeComReply(chatId, '当前没有待处理的权限请求。');
      return;
    }
    const target = pending[0];
    const label = this.getSessionListIndex(target.request.sessionId);
    const ok = permissionBroker.resolve(target.id, isAllow ? 'allow' : 'deny', 'wecom');
    if (!ok) {
      await this.sendWeComReplyWithHeader(chatId, `${label} 的权限请求已被处理。`, target.request.sessionId);
    } else {
      await this.sendWeComReplyWithHeader(chatId, `已${isAllow ? '批准' : '拒绝'} ${label} 的权限请求`, target.request.sessionId);
    }
  }

  private async handleAnswerCommand(chatId: string, text: string): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0].toLowerCase();
    const rest = text.slice(cmd.length).trim();
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx === -1) {
      await this.sendWeComReply(
        chatId,
        '用法：/answer <会话序号> <答案>\n例如：/answer 3 A  或  /answer 3 A,B',
      );
      return;
    }

    const sessArg = rest.slice(0, spaceIdx).trim();
    const answerText = rest.slice(spaceIdx + 1).trim();
    // 参数是会话序号（/list 中的编号）或 sessionId（前缀）
    const resolved = resolveSessionArg(sessArg);
    if ('error' in resolved) {
      await this.sendWeComReply(chatId, resolved.error);
      return;
    }
    const label = this.getSessionListIndex(resolved.id);

    logger.info(`[wecom-channel] handleAnswerCommand session=${resolved.id.slice(0, 8)} answerText=${answerText}`);

    const entry = permissionBroker.getPendingBySession(resolved.id);
    if (!entry) {
      await this.sendWeComReplyWithHeader(chatId, `${label} 当前没有待处理的权限请求或提问。`, resolved.id);
      return;
    }

    if (entry.request.toolName !== 'AskUserQuestion') {
      permissionBroker.resolve(entry.id, 'allow', 'wecom');
      await this.sendWeComReplyWithHeader(chatId, `已批准 ${label} 的权限请求`, resolved.id);
      return;
    }

    const questions = this.parseAskQuestions(entry.request.toolInput);
    const result = this.parseAskAnswer(questions, answerText);
    if ('error' in result) {
      await this.sendWeComReplyWithHeader(chatId, `回答格式错误：${result.error}`, resolved.id);
      return;
    }

    permissionBroker.resolve(entry.id, 'allow', 'wecom', result.answers);
    await this.sendWeComReplyWithHeader(chatId, `已提交 ${label} 的回答`, resolved.id);
  }

  private async handlePendingCommand(chatId: string): Promise<void> {
    const mapping = getMapping(chatId);
    const pending = permissionBroker.listPending();
    const filtered = mapping ? pending.filter((p) => p.request.sessionId === mapping.sessionId) : pending;
    if (filtered.length === 0) {
      await this.sendWeComReply(chatId, '当前没有待处理的权限请求或提问。');
      return;
    }

    const lines = filtered.map((p) => {
      const isAsk = p.request.toolName === 'AskUserQuestion';
      const preview = isAsk ? 'Claude 提问' : this.formatToolInputPreview(p.request.toolInput);
      return `| ${this.getSessionListIndex(p.request.sessionId)} | ${p.request.toolName} | ${preview || '-'} |`;
    });
    await this.sendWeComReply(
      chatId,
      '**待处理权限/提问**\n\n' +
      '| 会话 | 类型 | 内容 |\n' +
      '|------|------|------|\n' +
      lines.join('\n'),
    );
  }

  private async handleToCommand(chatId: string, text: string): Promise<void> {
    const rest = text.slice(3).trim();
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx === -1) {
      await this.sendWeComReply(chatId, '用法：/to <sessionId/序号> <消息内容>');
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
      await this.sendWeComReplyWithHeader(chatId, `会话 ${resolved.id.slice(0, 8)}... 不存在或未启动。`, resolved.id);
      return;
    }

    logger.info(`[wecom-channel] /to from ${chatId}, forward to session ${resolved.id.slice(0, 8)}...`);
    try {
      session.send(resolved.id, message);
      // 不发送成功提示，避免与 Claude 的回复消息重复
    } catch (err) {
      logger.error('[wecom-channel] failed to forward /to message to session:', err);
      await this.sendWeComReplyWithHeader(chatId, `发送失败：${err instanceof Error ? err.message : String(err)}`, resolved.id);
    }
  }

  private async sendWeComReply(chatId: string, text: string): Promise<void> {
    logger.info(`[wecom-channel] sendWeComReply chatId=${chatId} text=${text.slice(0, 80)}`);
    const plugin = await loadWecomPlugin();
    if (!plugin?.outbound?.sendText) {
      logger.warn('[wecom-channel] plugin outbound.sendText not available');
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
    try {
      const result = await plugin.outbound.sendText({ to: chatId, text, accountId: 'default', cfg });
      logger.info('[wecom-channel] sendWeComReply success:', JSON.stringify(result));
    } catch (err) {
      logger.error('[wecom-channel] sendWeComReply failed:', err);
      throw err;
    }
  }

  /** 发送卡片相关反馈，自动带上 requestId 对应会话的头部。 */
  private async sendCardReplyWithHeader(chatId: string, text: string, requestId?: string): Promise<void> {
    const sessionId = requestId ? this.cardStore.get(requestId)?.sessionId : undefined;
    await this.sendWeComReplyWithHeader(chatId, text, sessionId);
  }

  /** 发送文本反馈，自动带上指定会话的头部（如果找得到会话）。 */
  private async sendWeComReplyWithHeader(chatId: string, text: string, sessionId?: string): Promise<void> {
    const header = sessionId ? this.formatSessionHeader(sessionId) : undefined;
    const fullText = header ? `${header}\n${text}` : text;
    await this.sendWeComReply(chatId, fullText);
  }

  private getSessionListIndex(sessionId: string): string {
    const all = session.list();
    const idx = all.findIndex((s) => s.id === sessionId);
    return idx >= 0 ? `会话#${idx + 1}` : '?';
  }

  // 生成 /allow /deny /answer 的命令参数：优先会话序号，找不到时用 sessionId 前缀
  private getSessionCmdArg(sessionId: string): string {
    const all = session.list();
    const idx = all.findIndex((s) => s.id === sessionId);
    return idx >= 0 ? String(idx + 1) : sessionId.slice(0, 8);
  }

  private formatSessionHeader(sessionId: string): string | undefined {
    const s = session.lookup(sessionId);
    if (!s) return undefined;
    const project = path.basename(s.workDir);
    const sid = sessionId.slice(0, 8);
    const sessionIdx = this.getSessionListIndex(sessionId);
    return `> **${project}** · ${sessionIdx} · \`${sid}\``;
  }

  private formatHeader(event: ProxyStageEvent, _msgSeq: number): string {
    return this.formatSessionHeader(event.sessionId) ?? '';
  }

  private formatToolInput(p: any): string {
    if (!p?.input || typeof p.input !== 'object') return '';
    const input = p.input as Record<string, any>;
    const keys = Object.keys(input);
    if (keys.length === 0) return '';

    if (input.command) {
      const cmd = String(input.command);
      return `\n\`\`\`\n${cmd.length > 300 ? cmd.slice(0, 300) + '...' : cmd}\n\`\`\``;
    }
    if (input.file_path || input.path) {
      return `\n📄 ${input.file_path || input.path}`;
    }
    const firstKey = keys[0];
    const val = typeof input[firstKey] === 'string' ? input[firstKey] : JSON.stringify(input[firstKey]);
    const short = val.length > 100 ? val.slice(0, 100) + '...' : val;
    return `\n${firstKey}: ${short}`;
  }

  private formatMessage(event: ProxyStageEvent, msgSeq: number): string {
    const header = this.formatHeader(event, msgSeq);
    const p = event.payload as any;
    switch (event.kind) {
      case 'prompt':
        return `${header}\n👤 **用户**\n${p?.prompt || ''}`;
      case 'tool_use':
        return `${header}\n🔧 **工具调用: ${p?.name || 'unknown'}**${this.formatToolInput(p)}`;
      case 'response_complete':
        return `${header}\n🤖 **Claude**\n${p?.text || ''}`;
      case 'PermissionRequest': {
        const toolName = p?.toolName || 'unknown';
        const input = p?.toolInput;
        const reqId = this.getSessionCmdArg(event.sessionId);
        if (toolName === 'AskUserQuestion') {
          return this.formatAskUserQuestion(header, input, reqId);
        }
        return this.formatPermissionRequest(header, toolName, input, reqId);
      }
      case 'PermissionResolved': {
        // 终端自行处理时不知道实际决策，只提示已处理
        if (p?.source === 'terminal') {
          return `${header}\n✅ **权限已在终端处理**`;
        }
        const src = p?.source === 'wecom' ? '企业微信' : p?.source === 'notch' ? '桌面端' : '终端';
        return `${header}\n✅ **权限已处理: ${p?.decision}** (${src})`;
      }
      case 'tool_result':
        return `${header}\n📋 **工具结果: ${p?.name || 'unknown'}**`;
      case 'error':
        return `${header}\n❌ **错误: ${p?.message || 'unknown'}**`;
      case 'SessionEnd':
        return `${header}\n📌 **会话结束**`;
      default:
        return '';
    }
  }

  private formatToolInputPreview(input: unknown): string {
    const p = input as Record<string, any> | undefined;
    if (!p || typeof p !== 'object') return '';
    if (p.command) {
      const cmd = String(p.command);
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    }
    if (p.file_path || p.path) {
      return String(p.file_path || p.path);
    }
    return '';
  }

  private formatPermissionRequest(header: string, toolName: string, input: unknown, reqId: string | number): string {
    const preview = this.formatToolInputPreview(input);
    const inputBlock = preview ? `\n\`\`\`\n${preview}\n\`\`\`` : '';
    return `${header}\n\n**权限请求：${toolName}**${inputBlock}\n\n操作：\`/allow ${reqId}\` 或 \`/deny ${reqId}\``;
  }

  private formatAskUserQuestion(header: string, input: unknown, reqId: string | number): string {
    const questions = this.parseAskQuestions(input);
    if (questions.length === 0) {
      return `${header}\n\n**Claude 向你提问**\n\n操作：\`/answer ${reqId} <你的回答>\``;
    }

    const lines: string[] = ['', '**Claude 向你提问：**', ''];
    questions.forEach((q, idx) => {
      lines.push(`${idx + 1}. ${q.header || q.question}`);
      if (q.question && q.header && q.header !== q.question) {
        lines.push(`   ${q.question}`);
      }
      q.options.forEach((opt, optIdx) => {
        const num = optIdx + 1;
        const desc = opt.description ? ` (${opt.description})` : '';
        lines.push(`   ${num}. ${opt.label}${desc}`);
      });
      if (q.multiSelect) {
        lines.push('   *多选，用逗号分隔*');
      }
      lines.push('');
    });

    lines.push('**回复示例：**');
    lines.push(`- \`/answer ${reqId} 1\`  单选`);
    lines.push(`- \`/answer ${reqId} 1,2\`  多选`);
    lines.push(`- \`/answer ${reqId} 自定义回答\`  自由输入`);
    if (questions.length > 1) {
      lines.push(`- \`/answer ${reqId} 1;2,3\`  多个问题用分号分隔`);
    }

    return `${header}\n${lines.join('\n')}`;
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
      options: Array.isArray(q.options)
        ? q.options.map((o: any) => ({
            label: typeof o.label === 'string' ? o.label : '',
            description: typeof o.description === 'string' ? o.description : undefined,
          }))
        : [],
    }));
  }

  private parseAskAnswer(questions: AskQuestion[], text: string): { answers: Record<string, string | string[]> } | { error: string } {
    if (questions.length === 0) {
      return { error: '没有问题可回答' };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return { error: '答案不能为空' };
    }

    if (questions.length === 1) {
      const answer = this.parseSingleQuestionAnswer(questions[0], trimmed);
      if ('error' in answer) return answer;
      return { answers: { [questions[0].question]: answer.value } };
    }

    const parts = trimmed.split(';').map((s) => s.trim());
    if (parts.length !== questions.length) {
      return { error: `该提问包含 ${questions.length} 个问题，请用分号分隔答案，例如：/answer 1 1;2,3` };
    }

    const answers: Record<string, string | string[]> = {};
    for (let i = 0; i < questions.length; i++) {
      const answer = this.parseSingleQuestionAnswer(questions[i], parts[i]);
      if ('error' in answer) return answer;
      answers[questions[i].question] = answer.value;
    }
    return { answers };
  }

  private parseSingleQuestionAnswer(
    question: AskQuestion,
    text: string,
  ): { value: string | string[] } | { error: string } {
    const parts = text
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return { error: '答案不能为空' };
    }

    const labels: string[] = [];
    for (const part of parts) {
      // 优先按选项 label 精确匹配
      const labelMatch = question.options.find((o) => o.label === part);
      if (labelMatch) {
        labels.push(labelMatch.label);
        continue;
      }

      // 再按数字序号匹配
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= question.options.length) {
        labels.push(question.options[num - 1].label);
        continue;
      }

      // 有一个部分无法识别，则整体视为自定义文本
      if (parts.length === 1) {
        return { value: text.trim() };
      }
      return { error: `选项 "${part}" 不存在，可用选项为 1-${question.options.length}` };
    }

    if (question.multiSelect) {
      return { value: labels };
    }
    if (labels.length > 1) {
      return { error: '该问题为单选，只能选择一个答案' };
    }
    return { value: labels[0] };
  }
}
