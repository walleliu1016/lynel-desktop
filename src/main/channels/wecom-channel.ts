import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { OutputChannel, HookChannel, type HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import type { BotConfig, BotConnectionState } from '../types/bot.js';
import * as session from '../session.js';
import { getStore } from '../store.js';
import { getBus } from '../events.js';
import { getLogger } from '../log.js';
import { permissionBroker, PermissionRequest } from '../permission-broker.js';
import { buildPermissionCard, buildAskQuestionCard } from './wecom-cards/card-builder.js';
import { WeComCardStore } from './wecom-cards/card-store.js';
import { WeComCardEventHandler, type TemplateCardEventFrame } from './wecom-cards/event-handler.js';

const logger = getLogger().scope('wecom-channel');

/** 企业微信控制指令 → PTY 原始字节映射 */
const CONTROL_COMMANDS: Record<string, string> = {
  '/interrupt': '\x03', // Ctrl+C → SIGINT
  '/ctrl-c': '\x03',
  '/ctrl+c': '\x03',
  '/escape': '\x1b', // Esc
  '/esc': '\x1b',
  '/ctrl-d': '\x04', // Ctrl+D → EOF
  '/ctrl-z': '\x1a', // Ctrl+Z → SIGTSTP
};

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

export class WeComChannel implements OutputChannel, HookChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  /** 企微 markdown 单消息硬限制 20480 字节；保留 ~1.5KB buffer 应对 JSON 序列化膨胀 */
  private static readonly MARKDOWN_SAFE_LENGTH = 19000;
  private cfg: WeComChannelConfig;
  /** botId → BotConnectionState */
  private botPool = new Map<string, BotConnectionState>();
  /** sessionId → botId */
  private sessionBotMap = new Map<string, string>();
  /** 当前处理入站消息的 botId（用于命令回复路由） */
  private currentBotId: string | undefined;
  private chatIdToSession = new Map<string, string>();
  private lastActiveSession = new Map<string, string>();
  private sessionSeqCounters = new Map<string, number>();
  private createSessionCallback: ((workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>) | null = null;
  private cardStore = new WeComCardStore();
  private cardEventHandler?: WeComCardEventHandler;
  private currentUserAccount: string = '';
  private sessionTitleResolver: ((sessionId: string) => string) | null = null;
  /** 是否推送 thinking 文本 */
  pushThinking = true;
  /** 是否推送工具调用事件 */
  pushToolCalls = true;
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

  setCurrentUserAccount(account: string): void {
    this.currentUserAccount = account;
    logger.info(`[wecom-channel] current user account set to ${account}`);
  }

  private getEffectiveChatId(entry: BotConnectionState): string {
    return entry.config.chatId || this.currentUserAccount;
  }

  private getSessionTitle(sessionId: string): string | undefined {
    if (!this.sessionTitleResolver) return undefined;
    try {
      return this.sessionTitleResolver(sessionId);
    } catch {
      return undefined;
    }
  }

  /** 获取会话绑定的 bot entry */
  private getBotForSession(sessionId: string): BotConnectionState | undefined {
    const botId = this.sessionBotMap.get(sessionId);
    if (!botId) return undefined;
    return this.botPool.get(botId);
  }

  isEnabled(): boolean {
    const ok = this.botPool.size > 0;
    logger.info(`[wecom-channel] isEnabled=${ok} bots=${this.botPool.size}`);
    return ok;
  }

  updateConfig(cfg: WeComChannelConfig): void {
    logger.info('[wecom-channel] updateConfig', { bots: this.botPool.size });
    this.cfg = cfg;
    // bot 连接池由 updateBots() 管理，不在此处预连接
  }

  /** 批量更新 bot 连接池：新增/更新/移除连接 */
  updateBots(bots: BotConfig[]): void {
    const wecomBots = bots.filter((b) => b.source === 'wecom' || !b.source);
    const newIds = new Set(wecomBots.map((b) => b.id));
    // 移除不存在的 bot
    for (const [id, state] of this.botPool) {
      if (!newIds.has(id)) {
        logger.info(`[wecom-channel] removing bot ${id}`);
        state.wsClient?.disconnect();
        this.botPool.delete(id);
      }
    }
    // 新增/更新 bot
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
        this.connectBot(bot.id).catch((err) =>
          logger.error(`[wecom-channel] bot ${bot.id} connect failed:`, err)
        );
      }
    }
  }

  /** 会话已绑定 bot 且启动后，向 bot 推送启动通知 */
  sendSessionStarted(sessionId: string, workDir: string): void {
    if (!this.isEnabled()) return;
    const entry = this.getBotForSession(sessionId);
    if (!entry) return;
    const project = path.basename(workDir);
    const content = `**${project}** · \`${sessionId.slice(0, 8)}\`\n\n**${project}**，工作目录 **${workDir}**，会话已启动。`;
    this.sendContent(content, sessionId).catch((e) => logger.error('[wecom] sendSessionStarted failed:', e));
  }

  setSessionBot(sessionId: string, botId: string): void {
    this.sessionBotMap.set(sessionId, botId);
  }

  clearSessionBot(sessionId: string): void {
    this.sessionBotMap.delete(sessionId);
    this.clearSessionMappings(sessionId);
  }

  getBotConnectionStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [id, state] of this.botPool) {
      status[id] = state.wsClient?.isConnected ?? false;
    }
    return status;
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

  send(event: LynelEnvelope): void {
    if (!this.isEnabled()) return;
    if (!event.sessionId) return;

    // 推送过滤
    if (!this.pushThinking && event.ev.t === 'text' && event.ev.thinking) return;
    if (!this.pushToolCalls && (event.ev.t === 'tool-call-start' || event.ev.t === 'tool-call-end')) return;

    const entry = this.getBotForSession(event.sessionId);
    if (!entry) {
      logger.info(`[wecom-channel] no bot bound for session ${event.sessionId.slice(0, 8)}, dropping event`);
      return;
    }

    // 记录路由
    const effectiveChatId = this.getEffectiveChatId(entry);
    if (effectiveChatId) {
      this.recordRouting(effectiveChatId, event.sessionId);
    }

    const ev = event.ev;
    const header = this.formatSessionHeader(event.sessionId) ?? '';

    switch (ev.t) {
      case 'text': {
        if (event.role === 'user') {
          // 去掉 Claude 注入的 system-reminder，只保留用户实际输入；
          // 整条只含 reminder（自动续杯/上下文注入）时清完为空则丢弃；
          // TUI 注入的伪 user 消息（[SUGGESTION MODE:] / [AUTO MODE:] / [EXECUTE MODE:] 等）
          // 整条丢
          const cleanText = ev.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '').trim();
          if (!cleanText) break;
          if (/^\[[A-Z][A-Z _-]*MODE\s*:/.test(cleanText)) break;
          const content = `${header}\n---\n\n👤 **用户**\n\n${cleanText}`;
          this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] user text send failed:', e));
        } else if (event.role === 'agent') {
          const prefix = ev.thinking ? '💭 **思考**' : '🤖 **Claude**';
          const content = `${header}\n---\n\n${prefix}\n\n${ev.text}`;
          this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] agent text send failed:', e));
        }
        break;
      }
      case 'tool-call-start': {
        const argsStr = this.formatToolArgs(ev.args);
        const content = `${header}\n---\n\n🔧 **${ev.name}**${argsStr}`;
        this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] tool-call-start send failed:', e));
        break;
      }
      case 'tool-call-end': {
        const resultStr = ev.result ? this.formatToolResult(ev.result, !!ev.is_error) : '';
        if (ev.is_error) {
          const content = `${header}\n---\n\n❌ **工具执行失败**：${ev.error ?? '未知错误'} (${ev.call})${resultStr}`;
          this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] tool-call-end send failed:', e));
        } else {
          const content = `${header}\n---\n\n✅ **工具执行完成** (${ev.call})${resultStr}`;
          this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] tool-call-end send failed:', e));
        }
        break;
      }
      case 'turn-end':
        // 不需要推送给用户，忽略
        break;
      case 'service': {
        const content = `${header}\n---\n\n⚠️ **系统通知**\n\n${ev.text}`;
        this.sendContent(content, event.sessionId).catch((e) => logger.error('[wecom] service send failed:', e));
        break;
      }
      default:
        break;
    }
  }

  sendHook(event: HookEventLike): void {
    // 无论频道是否启用，会话结束时都应清理该会话的卡片状态
    if (event.kind === 'SessionEnd') {
      this.cardStore.cancelBySession(event.sessionId);
    }

    if (!this.isEnabled()) {
      logger.info('[wecom-channel] hook disabled, skip');
      return;
    }

    const msgSeq = (this.sessionSeqCounters.get(event.sessionId) ?? 0) + 1;
    this.sessionSeqCounters.set(event.sessionId, msgSeq);

    // 权限请求/提问使用模板卡片
    if (event.kind === 'PermissionRequest') {
      const p = event.payload as any;
      const toolName = p?.toolName || 'unknown';
      if (toolName === 'AskUserQuestion') {
        this.sendAskQuestionCard(event, msgSeq).catch((err) => logger.error('[wecom-channel] sendAskQuestionCard failed:', err));
      } else {
        this.sendPermissionCard(event, msgSeq).catch((err) => logger.error('[wecom-channel] sendPermissionCard failed:', err));
      }
      const entry = this.getBotForSession(event.sessionId);
      const chatId = entry ? this.getEffectiveChatId(entry) : '';
      if (chatId) {
        this.recordRouting(chatId, event.sessionId);
      }
      return;
    }

    // PermissionResolved 降级为 Markdown
    // 注意：source === 'wecom' 时跳过，因为卡片事件处理器或 /allow 命令已回复过
    if (event.kind === 'PermissionResolved') {
      const p = event.payload as any;
      if (p?.source === 'wecom') return;
      const header = this.formatSessionHeader(event.sessionId) ?? '';
      if (p?.source === 'terminal') {
        this.sendContent(`${header}\n---\n\n✅ **权限已在终端处理**`, event.sessionId).catch(() => {});
      } else {
        const src = p?.source === 'notch' ? '桌面端' : '终端';
        this.sendContent(`${header}\n---\n\n✅ **权限已处理: ${p?.decision}** (${src})`, event.sessionId).catch(() => {});
      }
      return;
    }

    // SessionEnd 降级为 Markdown
    if (event.kind === 'SessionEnd') {
      const header = this.formatSessionHeader(event.sessionId) ?? '';
      this.sendContent(`${header}\n---\n\n📌 **会话结束**`, event.sessionId).catch(() => {});
      return;
    }
  }

  private recordRouting(chatId: string, sessionId: string): void {
    this.lastActiveSession.set(chatId, sessionId);
    this.chatIdToSession.set(chatId, sessionId);
    const s = session.lookup(sessionId);
    if (s) {
      setMapping(chatId, sessionId, s.workDir);
    }
  }

  private async sendContent(content: string, sessionId: string): Promise<void> {
    const entry = this.getBotForSession(sessionId);
    if (!entry) return;

    // 企微 markdown 单消息硬限制 20480 字节。保留 ~1.5KB buffer 应对 JSON 序列化膨胀。
    if (content.length > WeComChannel.MARKDOWN_SAFE_LENGTH) {
      const overflow = content.length - WeComChannel.MARKDOWN_SAFE_LENGTH;
      content = content.slice(0, WeComChannel.MARKDOWN_SAFE_LENGTH) +
        `\n\n... (内容过长已截断 ${overflow} 字符)`;
      logger.warn(`[wecom-channel] markdown content truncated sid=${sessionId.slice(0, 8)} overflow=${overflow}`);
    }

    const [plugin] = await Promise.all([loadWecomPlugin(), this.ensureBotWebSocket(entry.config.id)]);
    if (!plugin?.outbound?.sendText) {
      logger.warn('[wecom-channel] plugin outbound.sendText not available');
      return;
    }

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          botId: entry.config.botId,
          secret: entry.config.secret,
          agent: this.cfg.agent,
        },
      },
    };

    // 优先使用 sendMarkdown（支持富文本），回退到 sendText
    const sendFn = plugin.outbound.sendMarkdown || plugin.outbound.sendText;
    const chatId = this.getEffectiveChatId(entry);
    logger.info(`[wecom-channel] sending to WeCom via ${plugin.outbound.sendMarkdown ? 'sendMarkdown' : 'sendText'}...`);
    try {
      const result = await sendFn({
        to: chatId,
        text: content,
        accountId: entry.config.id,
        cfg,
      });
      logger.info('[wecom-channel] send success:', JSON.stringify(result));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error(`[wecom] content send failed sid=${sessionId.slice(0, 8)} len=${content.length}: ${msg}`);
      // 通过 EventBus 推 toast，前端 useEventStream 订阅 app:toast 调 showToast
      try {
        getBus().emit('app:toast', 'error', `企微发送失败 (${sessionId.slice(0, 8)}): ${msg.slice(0, 100)}`);
      } catch { /* bus 不可用时静默 */ }
      throw err; // 保留 throw，让外层 .catch 仍能感知
    }
  }

  private async sendPermissionCard(event: HookEventLike, msgSeq: number): Promise<void> {
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
      );
      await this.sendContent(content, event.sessionId);
    }
  }

  private async sendAskQuestionCard(event: HookEventLike, msgSeq: number): Promise<void> {
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
    const intro = `${header}\n---\n\n**Claude 向你提了 ${questions.length} 个问题：**\n${questionsList}\n\n将逐一发送卡片，请依次作答。`;
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
    const entry = this.getBotForSession(sessionId);
    if (!entry) return false;

    try {
      const chatId = this.getEffectiveChatId(entry);
      logger.info('[wecom-channel] sendTemplateCard start: wsConnected=%s, chatId=%s, cardType=%s',
        String(entry.wsClient?.isConnected ?? false), chatId || '<none>',
        (card as any)?.card_type);
      await this.ensureBotWebSocket(entry.config.id);
      logger.info('[wecom-channel] sendTemplateCard after ensure: wsConnected=%s',
        String(entry.wsClient?.isConnected ?? false));
      if (!entry.wsClient?.isConnected || !chatId) {
        logger.warn('[wecom-channel] sendTemplateCard abort: ws=%s chatId=%s',
          String(entry.wsClient?.isConnected ?? false), String(chatId));
        return false;
      }

      const body = {
        msgtype: 'template_card' as const,
        template_card: card,
      };
      logger.info('[wecom-channel] sendTemplateCard sending to chatId=%s', chatId);
      const result = await entry.wsClient.sendMessage(chatId, body);
      logger.info('[wecom-channel] sendTemplateCard result: %s', JSON.stringify(result).slice(0, 200));

      const msgid = result?.body?.msgid ?? result?.headers?.req_id;
      if (msgid) {
        if (qIdx !== undefined) {
          // 多卡片场景：第一张卡片初始化 state，后续追加 msgid
          if (qIdx === 0) {
            this.cardStore.save(requestId, seq, chatId, msgid, sessionId);
          }
          this.cardStore.addQuestionMsgid(requestId, qIdx, msgid);
        } else {
          this.cardStore.save(requestId, seq, chatId, msgid, sessionId);
        }
      }
      return true;
    } catch (err) {
      logger.error('[wecom-channel] sendTemplateCard failed:', err);
      return false;
    }
  }

  /** 确保指定 bot 的 WebSocket 已连接 */
  private async ensureBotWebSocket(botId: string): Promise<void> {
    const entry = this.botPool.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not in pool`);
    if (entry.wsClient?.isConnected) return;
    if (entry.connecting) {
      await entry.connecting;
      return;
    }
    entry.connecting = this.connectBot(botId);
    try {
      await entry.connecting;
    } finally {
      entry.connecting = null;
    }
  }

  /** 连接单个 bot 的 WebSocket */
  private async connectBot(botId: string): Promise<void> {
    const entry = this.botPool.get(botId);
    if (!entry) return;
    const { botId: wecomBotId, secret } = entry.config;

    logger.info(`[wecom-channel] connecting websocket for bot ${botId}...`);
    const [WSClient, setWeComWebSocket] = await Promise.all([getWSClientClass(), getSetWeComWebSocket()]);

    return new Promise((resolve, reject) => {
      const wsClient = new WSClient({
        botId: wecomBotId,
        secret,
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
        logger.info(`[wecom-channel] websocket authenticated for bot ${botId}`);
        clearTimeout(timer);
        entry.wsClient = wsClient;
        entry.isConnected = true;
        setWeComWebSocket(botId, wsClient);
        resolve();
      });

      wsClient.on('message', (frame: any) => {
        try {
          this.handleInboundMessage(frame, botId);
        } catch (err) {
          logger.error(`[wecom-channel] bot ${botId} inbound failed:`, err);
        }
      });

      this.registerCardEventListener(wsClient, botId);

      wsClient.on('error', (err: any) => {
        clearTimeout(timer);
        entry.isConnected = false;
        reject(err);
      });

      wsClient.on('close', () => {
        entry.isConnected = false;
        entry.wsClient = null;
      });

      wsClient.connect();
    });
  }

  /** 外部调用：断开所有 bot 连接 */
  close(): void {
    this.disconnectAll();
  }

  /** 断开所有 bot 连接 */
  private disconnectAll(): void {
    for (const [id, state] of this.botPool) {
      logger.info(`[wecom-channel] disconnecting bot ${id}`);
      state.wsClient?.disconnect();
      state.wsClient = null;
      state.isConnected = false;
    }
  }

  /** 通过 chatId 查找对应的 bot wsClient */
  private getWSClientByChatId(chatId: string): any {
    for (const state of this.botPool.values()) {
      if (state.config.chatId === chatId && state.wsClient?.isConnected) {
        return state.wsClient;
      }
    }
    return null;
  }

  private getCardEventHandler(): WeComCardEventHandler {
    if (!this.cardEventHandler) {
      this.cardEventHandler = new WeComCardEventHandler(
        this.cardStore,
        (chatId, text, requestId) => this.sendCardReplyWithHeader(chatId, text, requestId),
        async (frame: TemplateCardEventFrame, card: unknown) => {
          // 优先用 currentBotId 定位 wsClient，确保卡片回复回到正确的 bot 连接
          const botEntry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
          const wsClient = botEntry?.wsClient;
          if (!wsClient) throw new Error('WSClient 未连接');
          await wsClient.updateTemplateCard(frame, card);
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

  private registerCardEventListener(wsClient: any, botId: string): void {
    wsClient.on('event.template_card_event', (frame: any) => {
      // 设置当前 bot，确保卡片回复消息回到正确的 bot 会话
      this.currentBotId = botId;
      this.getCardEventHandler()
        .handle(frame)
        .catch((err) => logger.error('[wecom-channel] failed to handle card event:', err));
    });
  }

  /** 根据 botId 取 bot entry，兜底取第一个可用的 */
  /** 通过 chatId 查找对应的 bot entry */
  private resolveBotByChatId(chatId: string): BotConnectionState | undefined {
    for (const state of this.botPool.values()) {
      if (state.config.chatId === chatId) return state;
    }
    return undefined;
  }

  /** 根据 botId 取 bot entry，兜底 currentBotId → chatId → 第一个可用的 */
  private resolveBot(botId?: string): BotConnectionState | undefined {
    const effectiveBotId = botId ?? this.currentBotId;
    if (effectiveBotId) {
      const entry = this.botPool.get(effectiveBotId);
      if (entry) return entry;
    }
    // 兜底：取第一个有 wsClient 的
    for (const state of this.botPool.values()) {
      if (state.wsClient) return state;
    }
    return undefined;
  }

  private handleInboundMessage(frame: any, botId?: string): void {
    this.currentBotId = botId;
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

    // 控制指令拦截：/interrupt、/escape 等 → 发送原始控制字符到 PTY
    const controlChar = CONTROL_COMMANDS[text];
    if (controlChar) {
      void this.handleControlCommand(chatId, body, text, controlChar);
      return;
    }

    // 所有消息直接转发给 Claude，不再拦截 / 命令
    // 通过引用消息中的会话头部直接路由
    const quoteRouting = this.resolveSessionFromQuote(body);
    if (quoteRouting) {
      if ('error' in quoteRouting) {
        this.sendWeComReplyWithHeader(chatId, quoteRouting.error).catch((err) =>
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

    // 多 bot 模式：通过 currentBotId 反查绑定的 session
    let sessionId: string | undefined;
    if (this.currentBotId) {
      for (const [sid, bid] of this.sessionBotMap) {
        if (bid === this.currentBotId) {
          sessionId = sid;
          break;
        }
      }
    }
    // 兜底：用持久化映射 / chatIdToSession（兼容旧路由）
    if (!sessionId) {
      const mapping = getMapping(chatId);
      if (mapping) sessionId = mapping.sessionId;
      else sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }
    if (!sessionId) {
      logger.info('[wecom-channel] no active session for inbound message');
      this.sendWeComReply(chatId, '当前没有绑定会话，请先通过 Lynel Desktop 为当前机器人绑定一个会话。').catch((err) =>
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

  /** 处理企业微信控制指令，发送原始控制字符到 PTY */
  private async handleControlCommand(
    chatId: string,
    body: any,
    command: string,
    controlChar: string,
  ): Promise<void> {
    // 解析目标 session（复用引用路由 + 默认路由逻辑）
    let sessionId: string | undefined;
    const quoteRouting = this.resolveSessionFromQuote(body);
    if (quoteRouting && !('error' in quoteRouting)) {
      sessionId = quoteRouting.id;
    }
    if (!sessionId) {
      if (this.currentBotId) {
        for (const [sid, bid] of this.sessionBotMap) {
          if (bid === this.currentBotId) { sessionId = sid; break; }
        }
      }
    }
    if (!sessionId) {
      const mapping = getMapping(chatId);
      if (mapping) sessionId = mapping.sessionId;
      else sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
    }

    if (!sessionId) {
      await this.sendWeComReply(chatId, '当前没有绑定会话，无法发送控制指令。');
      return;
    }

    const s = session.lookup(sessionId);
    if (!s || !s.process) {
      await this.sendWeComReplyWithHeader(chatId, `会话 ${sessionId.slice(0, 8)}... 不存在或未启动。`, sessionId);
      return;
    }

    try {
      session.writeInput(sessionId, controlChar);
      const label = command === '/interrupt' || command === '/ctrl-c' || command === '/ctrl+c'
        ? 'Ctrl+C (中断)'
        : command === '/escape' || command === '/esc'
          ? 'Esc'
          : command;
      await this.sendWeComReplyWithHeader(chatId, `已发送 ${label}`, sessionId);
      logger.info(`[wecom-channel] sent control char U+${controlChar.codePointAt(0)!.toString(16)} for ${command} to session ${sessionId.slice(0, 8)}`);
    } catch (err) {
      logger.error(`[wecom-channel] failed to send control char for ${command}:`, err);
      await this.sendWeComReply(chatId, `发送 ${command} 失败`);
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

    // 优先匹配完整头部：**project** · 会话#N · `xxxxxxxx`
    const headerMatch = quoteText.match(/\*\*[^*]+\*\* · 会话#(\d+) · `([a-z0-9]{8})`/);
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
  private async sendWeComReply(chatId: string, text: string, botId?: string): Promise<void> {
    const effectiveBotId = botId ?? this.currentBotId;
    logger.info(`[wecom-channel] sendWeComReply chatId=${chatId} botId=${effectiveBotId ?? 'fallback'}`);
    // Resolution chain: explicit botId → currentBotId → by chatId → first available
    let entry = effectiveBotId ? this.botPool.get(effectiveBotId) : undefined;
    if (!entry) entry = this.resolveBotByChatId(chatId);
    if (!entry) entry = this.resolveBot(); // fallback: first available
    if (!entry) {
      logger.warn('[wecom-channel] sendWeComReply no available bot');
      return;
    }
    const plugin = await loadWecomPlugin();
    if (!plugin?.outbound?.sendText) {
      logger.warn('[wecom-channel] plugin outbound.sendText not available');
      return;
    }
    await this.ensureBotWebSocket(entry.config.id);
    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          botId: entry.config.botId,
          secret: entry.config.secret,
          agent: this.cfg.agent,
        },
      },
    };
    try {
      const result = await plugin.outbound.sendText({ to: chatId, text, accountId: entry.config.id, cfg });
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
    const fullText = header ? `${header}\n---\n\n${text}` : text;
    await this.sendWeComReply(chatId, fullText);
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

  private formatHeader(event: { sessionId: string }, _msgSeq: number): string {
    return this.formatSessionHeader(event.sessionId) ?? '';
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

  /**
   * 格式化工具参数为企微 Markdown：
   * - Bash 命令：高亮 command 字段
   * - 文件操作：高亮 file_path/path 字段
   * - 其他：JSON 代码块（参数为空时返回空串）
   */
  private formatToolArgs(args: Record<string, unknown> | undefined): string {
    if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return '';

    const p = args as Record<string, any>;
    const lines: string[] = [];

    // 优先展示常用字段
    if (typeof p.command === 'string') {
      lines.push(`\n\`\`\`bash\n${p.command}\n\`\`\``);
    }
    if (typeof p.file_path === 'string') {
      lines.push(`\n> 📄 ${p.file_path}`);
    } else if (typeof p.path === 'string') {
      lines.push(`\n> 📄 ${p.path}`);
    }
    if (typeof p.pattern === 'string') {
      lines.push(`\n> 🔍 pattern: ${p.pattern}`);
    }
    // description 是 Claude 给工具调用加的说明，作为引用文字放在命令后面
    if (typeof p.description === 'string' && p.description.trim()) {
      lines.push(`\n> 💡 ${p.description.trim()}`);
    }

    // 其余字段按值类型分别展示：
    // - 多行字符串：用代码块展示（Write/Edit 的 content、new_string 等）
    // - 单行字符串：用 `- key: value` 行展示
    // - 非字符串（对象/数组/数字/布尔）：聚合后用 JSON 代码块展示
    const restNonString: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (['command', 'file_path', 'path', 'pattern', 'description'].includes(k)) continue;
      if (typeof v === 'string') {
        if (v.includes('\n')) {
          const MAX = 1000;
          const trunc = v.length > MAX ? v.slice(0, MAX) + `\n... (${v.length - MAX} 字符已省略)` : v;
          lines.push(`\n**${k}:**\n\`\`\`text\n${trunc}\n\`\`\``);
        } else {
          const MAX = 200;
          const trunc = v.length > MAX ? v.slice(0, MAX) + '...' : v;
          lines.push(`\n- \`${k}\`: ${trunc}`);
        }
      } else {
        restNonString[k] = v;
      }
    }
    if (Object.keys(restNonString).length > 0) {
      const json = JSON.stringify(restNonString, null, 2);
      lines.push(`\n\`\`\`json\n${json}\n\`\`\``);
    }

    return lines.join('');
  }

  /**
   * 格式化工具执行结果为企微 Markdown 代码块：
   * - 截断到 1500 字符避免超企微消息长度限制
   * - 根据是否出错选择代码块语言标记
   */
  private formatToolResult(result: string, isError: boolean): string {
    if (!result) return '';
    const MAX = 1500;
    const truncated = result.length > MAX
      ? result.slice(0, MAX) + `\n\n... (${result.length - MAX} 字符已省略)`
      : result;
    const lang = isError ? '' : 'text';
    return `\n\`\`\`${lang}\n${truncated}\n\`\`\``;
  }

  private formatPermissionRequest(header: string, toolName: string, input: unknown): string {
    const preview = this.formatToolInputPreview(input);
    const inputBlock = preview ? `\n\`\`\`\n${preview}\n\`\`\`` : '';
    return `${header}\n---\n\n**权限请求：${toolName}**${inputBlock}`;
  }

  private formatAskUserQuestion(header: string, input: unknown): string {
    const questions = this.parseAskQuestions(input);
    if (questions.length === 0) {
      return `${header}\n---\n\n**Claude 向你提问**`;
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

    return `${header}\n---\n\n${lines.join('\n')}`;
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
