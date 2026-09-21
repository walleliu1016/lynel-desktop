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
import { buildPermissionCard, buildAskQuestionCard, buildExitPlanCard } from './wecom-cards/card-builder.js';
import { WeComCardStore } from './wecom-cards/card-store.js';
import { WeComCardEventHandler, type TemplateCardEventFrame } from './wecom-cards/event-handler.js';
import { renderBufferToPng } from '../terminal-screenshot.js';
import { notifyExternal, errMessage } from './notify-error.js';

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
  '/screenshot': '__screenshot__',
  '/help': '__help__',
};

/** 任务指令（带参数，所以不进上面那张精确匹配表） */
const TASK_LIST_CMD = '/tasks';
const TASK_RUN_CMD = '/run';

/** 一个任务的展示信息（由 app.ts 从 tasks 模块取，通道不直接依赖 store） */
export interface WeComTaskInfo {
  id: string;
  name: string;
  enabled: boolean;
  /** 人读调度摘要，如「每天 09:00」 */
  schedule: string;
  lastStatus: string | null;
  nextRunAt: number | null;
  /** 当前已有非终态 run 在跑 */
  running: boolean;
}

/** 任务结果推送的载荷（与 tasks/index.ts 的 TaskResultPayload 同形） */
export interface WeComTaskResult {
  taskName: string;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  /** 一行摘要（截断） */
  text: string;
  /** 完整结果正文；缺省时退回 text */
  resultText?: string;
}

/** 任务桥接：列任务 / 触发一次。由 app.ts 注入（照 setSessionTitleResolver 的先例）。 */
export interface WeComTaskBridge {
  list(): WeComTaskInfo[];
  /** 触发一次；任务不存在返回 null。deduped=true 表示已有运行在跑、返回的是既有 run。 */
  run(taskId: string): { runId: string; deduped: boolean } | null;
}

const TASK_STATUS_CN: Record<string, string> = {
  queued: '排队中', running: '运行中', done: '成功', error: '失败',
  timeout: '超时', skipped: '已跳过', interrupted: '已中断', missed: '已过期',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${m}m${sec}s`;
}

/**
 * 企业微信 markdown 内容有字节上限（4096），中文一个字 3 字节，所以按**字节**截而不是按字符。
 * 截断了要显式说明，不能悄悄少半段 —— 那正是「跟桌面看到的不一样」的来源。
 */
function clampBytes(s: string, max: number): { text: string; cut: boolean } {
  if (Buffer.byteLength(s, 'utf8') <= max) return { text: s, cut: false };
  let out = s.slice(0, max);
  while (out.length > 0 && Buffer.byteLength(out, 'utf8') > max) out = out.slice(0, -1);
  return { text: out, cut: true };
}

function shortTime(ms: number | null): string {
  if (ms == null) return '—';
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 任务指令解析。返回 null = 不是任务指令，继续走普通消息转发。 */
export function parseTaskCommand(text: string): { kind: 'list' } | { kind: 'run'; arg: string } | null {
  const t = text.trim();
  if (t === TASK_LIST_CMD) return { kind: 'list' };
  const m = /^\/run(?:\s+(\S.*))?$/.exec(t);
  if (m) return { kind: 'run', arg: (m[1] ?? '').trim() };
  return null;
}

/** 任务参数 → 任务。序号 → 完整 id → 名称全等 → 名称唯一前缀（与 resolveSessionArg 同口径）。 */
export function resolveTaskArg(arg: string, all: WeComTaskInfo[]): { task: WeComTaskInfo } | { error: string } {
  if (!arg) return { error: `请给出任务序号或名称，例如 \`/run 1\`。发送 ${TASK_LIST_CMD} 查看。` };
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && String(idx) === arg.trim() && idx >= 1 && idx <= all.length) {
    return { task: all[idx - 1] };
  }
  const byId = all.find((t) => t.id === arg);
  if (byId) return { task: byId };
  const lower = arg.toLowerCase();
  const exact = all.filter((t) => t.name.toLowerCase() === lower);
  if (exact.length === 1) return { task: exact[0] };
  const prefixed = all.filter((t) => t.name.toLowerCase().startsWith(lower));
  if (prefixed.length === 1) return { task: prefixed[0] };
  if (prefixed.length > 1) {
    return { error: `有 ${prefixed.length} 个任务匹配「${arg}」，请用更完整的名称或序号。` };
  }
  return { error: `未找到匹配任务：${arg}。发送 ${TASK_LIST_CMD} 查看。` };
}

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
    notifyExternal({ source: 'wecom:plugin', level: 'error', message: `企微插件加载失败: ${errMessage(err)}` });
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
  private taskBridge: WeComTaskBridge | null = null;
  /** 被指定为「任务通知」的那个机器人的配置 id（设置里的 tasks_notify_bot） */
  private taskNotifyBotId: string | null = null;
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
  /** 最近一次由企微转发给 Claude 的用户输入（sessionId → 原文），用于抑制 claude 回显导致的重复消息 */
  private wecomOriginatedTexts = new Map<string, { text: string; at: number }>();

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  setCreateSessionHandler(handler: (workDir: string, prompt: string) => Promise<{ id: string; workDir: string } | { error: string }>): void {
    this.createSessionCallback = handler;
  }

  setSessionTitleResolver(resolver: (sessionId: string) => string): void {
    this.sessionTitleResolver = resolver;
  }

  /** 注入定时任务桥接（列任务 / 触发一次）。未注入时 /tasks 与 /run 退回普通消息转发。 */
  setTaskBridge(bridge: WeComTaskBridge): void {
    this.taskBridge = bridge;
  }

  /**
   * 告诉通道「哪个机器人被指定为任务通知」。
   *
   * 它与普通机器人的区别只在**入站**：普通机器人没绑会话时会回「当前没有绑定会话」，
   * 而任务通知机器人压根不参与会话转发 —— 用户给它发消息应该得到任务侧的说明，
   * 而不是那句误导的绑定提示。出站（推送任务结果）走 pushTaskResult，与这个开关无关。
   */
  setTaskNotifyBotId(botConfigId: string | null): void {
    this.taskNotifyBotId = botConfigId || null;
  }

  /** 入站消息该转发给哪个会话（bot 绑定 → 持久化映射 → 兜底）。无绑定返回 undefined。 */
  private resolveBoundSessionId(chatId: string): string | undefined {
    if (this.currentBotId) {
      for (const [sid, bid] of this.sessionBotMap) {
        if (bid === this.currentBotId) return sid;
      }
    }
    const mapping = getMapping(chatId);
    if (mapping) return mapping.sessionId;
    return this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
  }

  /**
   * 把一次任务运行的结果推给「任务通知机器人」。
   *
   * `botConfigId` 是机器人列表里那一条的 id（设置里的 tasks_notify_bot）。空 = 用户没开推送，
   * 静默返回。目标会话取该 bot 的 chatId，留空回退当前登录账号（= 推给自己）。
   *
   * 与「机器人」页的关系：**只借它的凭据发消息**，不等同于会话绑定 —— 任务推送既不读
   * sessionBotMap 也不往里写，所以选中它不会把任何会话绑上去。
   */
  async pushTaskResult(botConfigId: string, p: WeComTaskResult): Promise<void> {
    if (!botConfigId) return;
    const entry = this.botPool.get(botConfigId);
    if (!entry) {
      logger.warn(`[wecom-channel] 任务通知机器人 ${botConfigId} 不在连接池里（可能已删除），跳过推送`);
      return;
    }
    const chatId = entry.config.chatId || this.currentUserAccount;
    if (!chatId) {
      logger.warn('[wecom-channel] 任务通知机器人没有可用会话，跳过推送');
      return;
    }
    await this.ensureBotWebSocket(botConfigId);
    const state = p.status === 'done' ? '完成' : '未成功';
    const dur = p.durationMs != null ? formatDuration(p.durationMs) : '—';
    // 正文用**完整**结果（不是一行摘要）：桌面上看到什么，这里就推什么
    const { text: body, cut } = clampBytes(p.resultText?.trim() || p.text || '—', 3400);
    const md = [
      `**[Lynel Desktop] ${p.taskName} · ${state}**`,
      '',
      `- 时间：${shortTime(p.finishedAt ?? p.startedAt)}`,
      `- 耗时：${dur}`,
      `- 状态：${TASK_STATUS_CN[p.status] ?? p.status}`,
      '',
      body,
      ...(cut ? ['', '_（内容过长，已截断；完整结果见 Lynel Desktop）_'] : []),
    ].join('\n');
    await this.sendWeComReply(chatId, md, botConfigId);
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
        this.cancelReconnect(id);
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
          this.cancelReconnect(bot.id);
          existing.wsClient?.disconnect();
          existing.wsClient = null;
        }
        existing.config = bot;
      } else {
        logger.info(`[wecom-channel] adding bot ${bot.id}`);
        this.botPool.set(bot.id, { config: bot, wsClient: null, connecting: null, isConnected: false, reconnectTimer: null });
        this.connectBot(bot.id).catch((err) => {
          logger.error(`[wecom-channel] bot ${bot.id} connect failed:`, err);
          notifyExternal({ source: 'wecom:connect', level: 'warn', message: `企微 Bot 连接失败: ${errMessage(err)}` });
        });
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
    this.sendContent(content, sessionId).catch((e) => {
      logger.error('[wecom] sendSessionStarted failed:', e);
      notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微启动通知失败: ${errMessage(e)}` });
    });
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
    // 会话结束/迁移时清理企微来源记录，避免残留引用
    this.wecomOriginatedTexts.delete(sessionId);
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
          // 企微输入的回显抑制：消息本来就来自企微，用户已看到自己发的原文，
          // 不再把 claude 回显的"👤 用户"文本重复推送，避免同一条出现两遍。
          const pending = this.wecomOriginatedTexts.get(event.sessionId);
          if (pending) {
            if (pending.text === cleanText) {
              this.wecomOriginatedTexts.delete(event.sessionId);
              logger.info(`[wecom-channel] suppress user-text echo sid=${event.sessionId.slice(0, 8)} (originated from wecom)`);
              break;
            }
            // 超过 2 分钟未命中则丢弃记录，避免长期占内存
            if (Date.now() - pending.at > 120_000) {
              this.wecomOriginatedTexts.delete(event.sessionId);
            }
          }
          const content = this.buildMessage(header, '👤 **用户**', cleanText);
          this.sendContent(content, event.sessionId).catch((e) => {
            logger.error('[wecom] user text send failed:', e);
            notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送用户消息失败: ${errMessage(e)}` });
          });
        } else if (event.role === 'agent') {
          const prefix = ev.thinking ? '💭 **思考**' : '🤖 **Agent**';
          const content = this.buildMessage(header, prefix, ev.text);
          this.sendContent(content, event.sessionId).catch((e) => {
            logger.error('[wecom] agent text send failed:', e);
            notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送 Agent 消息失败: ${errMessage(e)}` });
          });
        }
        break;
      }
      case 'tool-call-start': {
        const argsStr = this.formatToolArgs(ev.args);
        const content = this.buildMessage(header, `🔧 **${ev.name}**`, '') + argsStr;
        this.sendContent(content, event.sessionId).catch((e) => {
          logger.error('[wecom] tool-call-start send failed:', e);
          notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送工具开始失败: ${errMessage(e)}` });
        });
        break;
      }
      case 'tool-call-end': {
        const resultStr = ev.result ? this.formatToolResult(ev.result, !!ev.is_error) : '';
        if (ev.is_error) {
          const content = this.buildMessage(header, '❌ **工具执行失败**', `${ev.error ?? '未知错误'} (${ev.call})`) + resultStr;
          this.sendContent(content, event.sessionId).catch((e) => {
            logger.error('[wecom] tool-call-end send failed:', e);
            notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送工具失败结果失败: ${errMessage(e)}` });
          });
        } else {
          const content = this.buildMessage(header, '✅ **工具执行完成**', `(${ev.call})`) + resultStr;
          this.sendContent(content, event.sessionId).catch((e) => {
            logger.error('[wecom] tool-call-end send failed:', e);
            notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送工具完成失败: ${errMessage(e)}` });
          });
        }
        break;
      }
      case 'turn-end':
        // 不需要推送给用户，忽略
        break;
      case 'service': {
        const content = this.buildMessage(header, '⚠️ **系统通知**', ev.text);
        this.sendContent(content, event.sessionId).catch((e) => {
          logger.error('[wecom] service send failed:', e);
          notifyExternal({ source: 'wecom:send', level: 'warn', message: `企微推送系统通知失败: ${errMessage(e)}` });
        });
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
        this.sendAskQuestionCard(event, msgSeq).catch((err) => {
          logger.error('[wecom-channel] sendAskQuestionCard failed:', err);
          notifyExternal({ source: 'wecom:card', level: 'error', message: `企微发送提问卡片失败: ${errMessage(err)}` });
        });
      } else if (toolName === 'ExitPlanMode') {
        this.sendExitPlanCard(event, msgSeq).catch((err) => {
          logger.error('[wecom-channel] sendExitPlanCard failed:', err);
          notifyExternal({ source: 'wecom:card', level: 'error', message: `企微发送计划审批卡片失败: ${errMessage(err)}` });
        });
      } else {
        this.sendPermissionCard(event, msgSeq).catch((err) => {
          logger.error('[wecom-channel] sendPermissionCard failed:', err);
          notifyExternal({ source: 'wecom:card', level: 'error', message: `企微发送权限卡片失败: ${errMessage(err)}` });
        });
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
        this.sendContent(this.buildMessage(header, '✅ **权限已在终端处理**', ''), event.sessionId).catch(() => {});
      } else {
        this.sendContent(this.buildMessage(header, `✅ **权限已处理: ${p?.decision}**`, ''), event.sessionId).catch(() => {});
      }
      return;
    }

    // SessionEnd 降级为 Markdown
    if (event.kind === 'SessionEnd') {
      const header = this.formatSessionHeader(event.sessionId) ?? '';
      this.sendContent(this.buildMessage(header, '📌 **会话结束**', ''), event.sessionId).catch(() => {});
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

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 发送 markdown 文本，带重试：WS 抖动时给一次恢复机会，
   *  避免"卡片发送失败 + 文本兜底也失败"导致消息彻底丢失。 */
  private async sendMarkdownWithRetry(content: string, sessionId: string, retries = 1): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        await this.sendContent(content, sessionId);
        return;
      } catch (err) {
        lastErr = err;
        logger.warn(`[wecom-channel] sendMarkdownWithRetry attempt ${i + 1} failed sid=${sessionId.slice(0, 8)}:`, err);
        if (i < retries) await this.sleep(400 * (i + 1));
      }
    }
    throw lastErr;
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
      // 通过 EventBus 推 toast，前端 ToastCenter 订阅 app:toast
      notifyExternal({
        source: `wecom:send:${sessionId.slice(0, 8)}`,
        level: 'error',
        message: `企微发送失败 (${sessionId.slice(0, 8)}): ${msg.slice(0, 100)}`,
      });
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
      await this.sendMarkdownWithRetry(content, event.sessionId);
    }
  }

  private async sendExitPlanCard(event: HookEventLike, msgSeq: number): Promise<void> {
    const p = event.payload as any;
    const req: PermissionRequest = {
      id: p.id,
      sessionId: event.sessionId,
      workDir: event.workDir,
      toolName: 'ExitPlanMode',
      toolInput: p.toolInput,
    };
    const seq = p.seq ?? msgSeq;
    const sessionTitle = this.getSessionTitle(event.sessionId);
    const card = buildExitPlanCard(req, seq, sessionTitle);
    const ok = await this.sendTemplateCard(card, event.sessionId, req.id, seq);
    if (!ok) {
      const content = this.formatExitPlanRequest(
        this.formatHeader(event, msgSeq),
        p.toolInput,
      );
      await this.sendMarkdownWithRetry(content, event.sessionId);
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
      await this.sendMarkdownWithRetry(content, event.sessionId);
      return;
    }

    // 运维端模板卡片显示不全，先发文本预告（含全部问题与选项）兜底完整信息，再发卡片供交互。
    // 单/多问题统一走此流程；多问题剩余卡片暂存，待用户作答后逐张发送。
    const header = this.formatHeader(event, msgSeq);
    const questionsList = questions
      .map((q, i) => {
        const opts = q.options
          .map((o) => `- ${o.label}${o.description ? ` - ${o.description}` : ''}`)
          .join('\n');
        return `**${i + 1}. ${q.question}**${q.multiSelect ? '（多选）' : ''}\n${opts}`;
      })
      .join('\n');
    const intro = `${header}\n---\n\n**Agent 向你提了 ${questions.length} 个问题：**\n${questionsList}\n\n${questions.length > 1 ? '将逐一发送卡片，请依次作答。' : '请在下方卡片中选择后提交。'}`;
    await this.sendMarkdownWithRetry(intro, event.sessionId);

    // 多问题：暂存剩余卡片，仅发送第一张
    if (cards.length > 1) {
      this.pendingQuestionCards.set(reqId, { cards, sessionId: event.sessionId, seq });
      logger.info('[wecom-channel] multi-question: stored %d pending cards for reqId=%s', cards.length, reqId);
    }

    // 发送第一张卡片；失败降级为完整 Markdown
    const ok = await this.sendTemplateCard(cards[0], event.sessionId, reqId, seq, 0);
    if (!ok) {
      if (cards.length > 1) this.pendingQuestionCards.delete(reqId);
      const content = this.formatAskUserQuestion(
        this.formatHeader(event, msgSeq),
        input,
      );
      await this.sendMarkdownWithRetry(content, event.sessionId);
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

    const chatId = this.getEffectiveChatId(entry);
    if (!chatId) {
      logger.warn('[wecom-channel] sendTemplateCard abort: chatId missing');
      return false;
    }

    // 卡片发送失败或 WS 未连接时重试一次：每次先强制 ensureBotWebSocket 重连，
    // 避免"偶发失败（5s ack 超时 / WS 抖动）导致没有卡片消息"。
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logger.info('[wecom-channel] sendTemplateCard attempt %d/%d: wsConnected=%s, chatId=%s, cardType=%s',
          attempt, MAX_ATTEMPTS,
          String(entry.wsClient?.isConnected ?? false), chatId,
          (card as any)?.card_type);
        await this.ensureBotWebSocket(entry.config.id);
        logger.info('[wecom-channel] sendTemplateCard after ensure: wsConnected=%s',
          String(entry.wsClient?.isConnected ?? false));
        if (!entry.wsClient?.isConnected) {
          logger.warn('[wecom-channel] sendTemplateCard abort: ws=%s',
            String(entry.wsClient?.isConnected ?? false));
          if (attempt < MAX_ATTEMPTS) await this.sleep(500 * attempt);
          continue;
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
        logger.warn('[wecom-channel] sendTemplateCard attempt %d/%d failed: %s',
          attempt, MAX_ATTEMPTS, err instanceof Error ? err.message : String(err));
        if (attempt < MAX_ATTEMPTS) await this.sleep(500 * attempt);
      }
    }
    return false;
  }

  /** 确保指定 bot 的 WebSocket 已连接 */
  private async ensureBotWebSocket(botId: string): Promise<void> {
    const entry = this.botPool.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not in pool`);
    if (entry.wsClient?.isConnected) return;
    if (entry.connecting) {
      await entry.connecting;
      // 重连竞态：await 期间 SDK 可能已恢复，二次检查
      if (entry.wsClient?.isConnected) return;
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

    // 取消已存在的重连定时器
    this.cancelReconnect(botId);

    // 先断开旧连接，避免旧实例的内部重连与新实例竞争同一 botId，
    // 导致企微服务器来回踢连接、卡片永远发送失败。
    const oldClient = entry.wsClient;
    if (oldClient) {
      try { oldClient.disconnect(); } catch { /* 忽略 */ }
      entry.wsClient = null;
      entry.isConnected = false;
    }

    logger.info(`[wecom-channel] connecting websocket for bot ${botId}...`);
    const [WSClient, setWeComWebSocket] = await Promise.all([getWSClientClass(), getSetWeComWebSocket()]);

    return new Promise((resolve, reject) => {
      const wsClient = new WSClient({
        botId: wecomBotId,
        secret,
        wsUrl: 'wss://openws.work.weixin.qq.com',
        heartbeatInterval: 30000,
        maxReconnectAttempts: 10,
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

      // 标记初始 Promise 是否已 resolve（首次 authenticated → true，之后都是 reconnect）
      let initialResolved = false;

      const onAuthenticated = (): void => {
        clearTimeout(timer);
        if (!initialResolved) {
          // 首次认证
          initialResolved = true;
          entry.wsClient = wsClient;
          entry.isConnected = true;
          setWeComWebSocket(botId, wsClient);
          this.cancelReconnect(botId);
          logger.info(`[wecom-channel] websocket authenticated for bot ${botId}`);
          notifyExternal({ source: 'wecom:connect', level: 'info', message: `企微 Bot ${botId.slice(0, 8)} 已连接`, throttleMs: 60_000 });
          resolve();
          return;
        }
        // 后续认证（SDK 自动重连成功）
        if (entry.wsClient && entry.wsClient !== wsClient) {
          // 另一个实例已接管，关闭这个陈旧的
          logger.warn(`[wecom-channel] bot ${botId} stale authenticated (another instance took over), discarding`);
          try { wsClient.disconnect(); } catch { /* 忽略 */ }
          return;
        }
        // 同一实例的 SDK 自动重连成功——恢复状态
        entry.wsClient = wsClient;
        entry.isConnected = true;
        this.cancelReconnect(botId);
        logger.info(`[wecom-channel] bot ${botId} re-authenticated (SDK auto-reconnect success)`);
        notifyExternal({ source: 'wecom:connect', level: 'info', message: `企微 Bot ${botId.slice(0, 8)} 已恢复连接`, throttleMs: 60_000 });
      };

      wsClient.on('authenticated', onAuthenticated);

      wsClient.on('message', (frame: any) => {
        try {
          this.handleInboundMessage(frame, botId);
        } catch (err) {
          logger.error(`[wecom-channel] bot ${botId} inbound failed:`, err);
        }
      });

      this.registerCardEventListener(wsClient, botId);

      wsClient.on('error', (err: any) => {
        if (!initialResolved) {
          // 初始连接阶段出错：reject 让 ensureBotWebSocket 感知失败
          clearTimeout(timer);
          reject(err);
          return;
        }
        // 后续阶段错误
        if (err?.code === 'WS_RECONNECT_EXHAUSTED') {
          // SDK 内部重连全部耗尽——WSClient 已死，不会自动恢复
          logger.error(`[wecom-channel] bot ${botId} reconnect exhausted, scheduling proactive reconnect`);
          if (entry.wsClient === wsClient) {
            entry.wsClient = null;
          }
          entry.isConnected = false;
          notifyExternal({ source: 'wecom:connect', level: 'error', message: `企微 Bot ${botId.slice(0, 8)} 重连耗尽，已离线，将自动重试`, throttleMs: 0 });
          this.scheduleReconnect(botId, 30_000);
        } else {
          logger.error('[wecom-channel] ws error:', err);
        }
      });

      // SDK 发 'disconnected'（正常 WS 断连 / 服务端踢号 / 我们手动 disconnect）
      // 不清空 entry.wsClient：SDK 内部仍会尝试重连，成功后 authenticated 恢复状态
      // 未恢复期间 isConnected=false 让 ensureBotWebSocket 能触发主动 connectBot
      wsClient.on('disconnected', (reason: any) => {
        const reasonStr = String(reason ?? '').slice(0, 80);
        logger.warn(`[wecom-channel] bot ${botId} disconnected: ${reasonStr}`);
        entry.isConnected = false;
        notifyExternal({ source: 'wecom:disconnect', level: 'warn', message: `企微 WS 断开（${reasonStr}），正在重连...`, throttleMs: 30_000 });
        // 调度主动重连兜底：SDK 内部自动重连如果失败/耗尽，这个 timer 会接管
        this.scheduleReconnect(botId, 30_000);
      });

      wsClient.on('reconnecting', (attempt: number) => {
        logger.info(`[wecom-channel] bot ${botId} SDK reconnecting attempt ${attempt}`);
      });

      wsClient.connect();
    });
  }

  /** 调度主动重连：30s 起步，指数退避，封顶 5 分钟 */
  private scheduleReconnect(botId: string, delayMs: number): void {
    const entry = this.botPool.get(botId);
    if (!entry) return;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      // 已连上就不需要重连
      if (entry.wsClient?.isConnected) return;
      // 已有连接流程在进行
      if (entry.connecting) return;
      logger.info(`[wecom-channel] scheduled reconnect for bot ${botId} after ${delayMs}ms`);
      entry.connecting = this.connectBot(botId)
        .catch((err) => {
          logger.error(`[wecom-channel] bot ${botId} scheduled reconnect failed:`, err);
          notifyExternal({ source: 'wecom:reconnect', level: 'warn', message: `企微 Bot ${botId.slice(0, 8)} 重连失败，${Math.min(delayMs * 2, 300_000) / 1000}s 后重试`, throttleMs: 30_000 });
          // 指数退避：30s → 60s → 120s → 240s → 300s（封顶）
          this.scheduleReconnect(botId, Math.min(delayMs * 2, 300_000));
        })
        .finally(() => {
          entry.connecting = null;
        });
    }, delayMs);
  }

  /** 取消待执行的主动重连 */
  private cancelReconnect(botId: string): void {
    const entry = this.botPool.get(botId);
    if (!entry || !entry.reconnectTimer) return;
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  /** 外部调用：断开所有 bot 连接 */
  close(): void {
    this.disconnectAll();
  }

  /** 断开所有 bot 连接 */
  private disconnectAll(): void {
    for (const [id, state] of this.botPool) {
      logger.info(`[wecom-channel] disconnecting bot ${id}`);
      this.cancelReconnect(id);
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
            const summary = `已收集全部回答，已回复 Agent：\n${lines.join('\n')}`;
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

  private resolveBotForChat(chatId: string): BotConnectionState | undefined {
    let entry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
    if (!entry) entry = this.resolveBotByChatId(chatId);
    if (!entry) entry = this.resolveBot();
    return entry;
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

    // 去除末尾换行，确保 session.send 始终追加 \r
    text = text.replace(/[\r\n]+$/, '');

    // 任务通知机器人：先把任务指令接住（这部分对所有机器人本来也成立），
    // 但**没绑会话时不要再回那句「请先绑定会话」** —— 它本来就不参与会话转发，
    // 那句话会把用户引到错误的方向。改成说明它的用途。
    if (this.taskNotifyBotId && this.currentBotId === this.taskNotifyBotId) {
      const taskCmd = this.taskBridge ? parseTaskCommand(text) : null;
      if (taskCmd) {
        void this.handleTaskCommand(chatId, taskCmd);
        return;
      }
      if (!this.resolveBoundSessionId(chatId)) {
        logger.info('[wecom-channel] 任务通知机器人收到非任务消息（未绑会话），回任务说明');
        this.sendWeComReply(
          chatId,
          '这是任务通知机器人，只响应 `/tasks`（列出任务）与 `/run <序号或名称>`（立即执行）。\n'
          + '任务跑完的结果也会推到这里。',
        ).catch((err) => logger.error('[wecom-channel] 任务机器人说明发送失败:', err));
        return;
      }
      // 绑了会话就按普通消息继续往下走（同一个人可能两种用法都要）
    }

    // 控制指令拦截：/interrupt、/escape 等 → 发送原始控制字符到 PTY
    const controlChar = CONTROL_COMMANDS[text];
    if (controlChar) {
      void this.handleControlCommand(chatId, body, text, controlChar);
      return;
    }

    // 任务指令：/tasks 列任务、/run <序号|名称> 触发一次。
    // 未注入桥接时 taskBridge 为 null，`/tasks` 会被当成普通文本转发给 Claude。
    if (this.taskBridge) {
      const taskCmd = parseTaskCommand(text);
      if (taskCmd) {
        void this.handleTaskCommand(chatId, taskCmd);
        return;
      }
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
        this.forwardWecomPrompt(quoteRouting.id, text);
      } catch (err) {
        logger.error('[wecom-channel] failed to forward quote-routed message to session:', err);
      }
      return;
    }

    const sessionId = this.resolveBoundSessionId(chatId);
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
      this.forwardWecomPrompt(sessionId, text);
    } catch (err) {
      logger.error('[wecom-channel] failed to forward inbound message to session:', err);
    }
  }

  /** 把企微入站文本转发给 Claude，并记录来源，供 claude 回显去重使用。 */
  private forwardWecomPrompt(sessionId: string, text: string): void {
    this.wecomOriginatedTexts.set(sessionId, { text, at: Date.now() });
    session.sendSafe(sessionId, text);
  }

  /**
   * 任务指令：`/tasks` 列表、`/run <序号|名称>` 触发一次。
   *
   * 触发走的是与桌面「立即执行」同一个入口（scheduler.runTaskNow），所以单任务去重口径一致：
   * 该任务已有非终态 run 时不新建，回执里说明是既有那次。
   */
  private async handleTaskCommand(
    chatId: string,
    cmd: { kind: 'list' } | { kind: 'run'; arg: string },
  ): Promise<void> {
    if (!this.taskBridge) {
      logger.warn('[wecom-channel] 收到任务指令但 taskBridge 未注入，忽略');
      return;
    }
    logger.info(`[wecom-channel] 任务指令 kind=${cmd.kind} chatId=${chatId}`);
    try {
      const all = this.taskBridge.list();
      if (all.length === 0) {
        await this.sendWeComReply(chatId, '还没有定时任务，请先在 Lynel Desktop 的任务页新建。');
        return;
      }

      if (cmd.kind === 'list') {
        const rows = all.map((t, i) => {
          const state = t.running
            ? '运行中'
            : t.lastStatus
              ? (TASK_STATUS_CN[t.lastStatus] ?? t.lastStatus)
              : '还没跑过';
          const next = !t.enabled ? '已停用' : t.nextRunAt != null ? `下次 ${shortTime(t.nextRunAt)}` : '—';
          return `| ${i + 1} | ${t.name} | ${t.schedule} | ${state} · ${next} |`;
        });
        const md = [
          '**Lynel Desktop** · 任务列表',
          '',
          '| # | 任务 | 调度 | 状态 |',
          '|---|------|------|------|',
          ...rows,
          '',
          `回复 \`${TASK_RUN_CMD} <序号或名称>\` 立即执行某个任务。`,
        ].join('\n');
        await this.sendWeComReply(chatId, md);
        return;
      }

      const resolved = resolveTaskArg(cmd.arg, all);
      if ('error' in resolved) {
        await this.sendWeComReply(chatId, resolved.error);
        return;
      }
      const task = resolved.task;
      const idx = all.indexOf(task) + 1;
      const res = this.taskBridge.run(task.id);
      if (!res) {
        await this.sendWeComReply(chatId, `任务 ${task.name} 已不存在，请发送 ${TASK_LIST_CMD} 刷新。`);
        return;
      }
      if (res.deduped) {
        await this.sendWeComReply(chatId, `#${idx} ${task.name} 已有一次运行在进行中，未重复触发。`);
        return;
      }
      const off = task.enabled ? '' : '（该任务当前已停用）';
      await this.sendWeComReply(chatId, `已触发 #${idx} ${task.name}${off}，可在 Lynel Desktop 的任务页查看运行流水。`);
    } catch (err) {
      logger.error('[wecom-channel] task command failed:', err);
      await this.sendWeComReply(chatId, `执行失败：${errMessage(err)}`).catch(() => {});
    }
  }

  /** 处理企业微信控制指令，发送原始控制字符到 PTY */
  private async handleControlCommand(
    chatId: string,
    body: any,
    command: string,
    controlChar: string,
  ): Promise<void> {
    if (controlChar === '__screenshot__') {
      await this.handleScreenshot(chatId, body);
      return;
    }
    if (controlChar === '__help__') {
      await this.handleHelp(chatId);
      return;
    }

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

  private async handleHelp(chatId: string): Promise<void> {
    const entry = this.resolveBotForChat(chatId);
    if (!entry?.wsClient) {
      await this.sendWeComReply(chatId, 'Bot 未连接。');
      return;
    }

    const help = [
      '## 快捷指令',
      '',
      '| 指令 | 作用 |',
      '|------|------|',
      '| `/interrupt` `/ctrl-c` `/ctrl+c` | 中断 Agent 当前生成 |',
      '| `/escape` `/esc` | 发送 Esc 键 |',
      '| `/ctrl-d` | 发送 Ctrl+D（EOF） |',
      '| `/ctrl-z` | 发送 Ctrl+Z（SIGTSTP） |',
      '| `/screenshot` | 截取当前终端画面 |',
      '| `/tasks` | 列出所有定时任务 |',
      '| `/run <序号或名称>` | 立即执行某个定时任务 |',
      '| `/help` | 显示本帮助 |',
      '',
      '## 常见操作',
      '',
      '- 直接发送文本消息，自动转发给当前绑定的 Agent',
      '- 权限审批：收到卡片后点击 **允许** / **拒绝**',
      '- 选择题：单选或多选后点击 **提交**',
    ].join('\n');

    const msg = `**Lynel Desktop** · 使用帮助\n\n/help\n\n${help}`;
    try {
      await entry.wsClient.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: msg } });
      logger.info(`[wecom-channel] help sent to chatId=${chatId}`);
    } catch (err: any) {
      logger.error('[wecom-channel] help send failed:', err);
    }
  }

  private async handleScreenshot(chatId: string, body: any): Promise<void> {
    let sessionId: string | undefined;
    const quoteRouting = this.resolveSessionFromQuote(body);
    if (quoteRouting && !('error' in quoteRouting)) {
      sessionId = quoteRouting.id;
    }
    if (!sessionId && this.currentBotId) {
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
      await this.sendWeComReply(chatId, '当前没有绑定会话，无法截图。');
      return;
    }

    const s = session.lookup(sessionId);
    if (!s) {
      await this.sendWeComReplyWithHeader(chatId, '会话不存在或已关闭。', sessionId);
      return;
    }

    const raw = session.getBuffer(sessionId);
    if (!raw) {
      await this.sendWeComReplyWithHeader(chatId, '终端暂无内容。', sessionId);
      return;
    }

    const size = session.getSize(sessionId);
    const rawLen = raw.length;
    const rawTail = raw.slice(-200).replace(/\x1b/g, '<ESC>').replace(/\r/g, '<R>').replace(/\n/g, '<N>');
    logger.info(`[wecom-channel] screenshot cols=${size?.cols} rawLen=${rawLen} rawTail=${rawTail}`);

    let pngBuf: Buffer;
    try {
      pngBuf = await renderBufferToPng(raw, { cols: size?.cols, rows: size?.rows });
    } catch (err: any) {
      logger.error('[wecom-channel] screenshot render failed:', err);
      await this.sendWeComReplyWithHeader(chatId, `截图渲染失败: ${err.message}`, sessionId);
      return;
    }

    const entry = this.resolveBotForChat(chatId);
    if (!entry?.wsClient) {
      await this.sendWeComReplyWithHeader(chatId, 'Bot 未连接。', sessionId);
      return;
    }

    try {
      const uploadResult = await entry.wsClient.uploadMedia(pngBuf, { type: 'image', filename: 'screenshot.png' });
      await entry.wsClient.sendMediaMessage(chatId, 'image', uploadResult.media_id);
      logger.info(`[wecom-channel] screenshot sent for session ${sessionId.slice(0, 8)} chatId=${chatId}`);
    } catch (err: any) {
      logger.error('[wecom-channel] screenshot upload/send failed:', err);
      await this.sendWeComReplyWithHeader(chatId, `截图发送失败: ${err.message}`, sessionId);
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
    const fullText = header ? `${header}\n\n${text}` : text;
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

  private buildMessage(header: string, role: string, body: string): string {
    const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
    return `${header}\n\n${role}\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
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
    return `${header}\n\n🔐 **权限请求：${toolName}**\n**━━━━━━━━━━━━━━━━**${inputBlock}`;
  }

  private formatExitPlanRequest(header: string, input: unknown): string {
    const p = input as Record<string, any> | undefined;
    const plan = typeof p?.plan === 'string' ? p.plan : '';
    const allowedPrompts = Array.isArray(p?.allowedPrompts) ? p.allowedPrompts : [];
    const lines: string[] = [];
    if (plan) {
      const MAX = 800;
      const trunc = plan.length > MAX
        ? plan.slice(0, MAX) + `\n\n... (${plan.length - MAX} 字符已省略)`
        : plan;
      lines.push(trunc);
    }
    if (allowedPrompts.length > 0) {
      lines.push('\n**批准后允许执行：**');
      for (const ap of allowedPrompts) {
        lines.push(`- \`${ap.tool}\`: ${ap.prompt}`);
      }
    }
    const body = lines.join('\n');
    const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
    return `${header}\n\n🗂️ **退出计划模式**\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
  }

  private formatAskUserQuestion(header: string, input: unknown): string {
    const questions = this.parseAskQuestions(input);
    if (questions.length === 0) {
      return `${header}\n\n❓ **Agent 向你提问**\n**━━━━━━━━━━━━━━━━**`;
    }

    const lines: string[] = ['', '**Agent 向你提问：**', ''];
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
