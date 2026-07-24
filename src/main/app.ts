import { app, ipcMain, BrowserWindow, dialog, powerSaveBlocker, clipboard } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStore } from './store.js';
import { getBus } from './events.js';
import { getLogger } from './log.js';
import * as auth from './auth.js';
import * as jsonl from './jsonl.js';
import * as session from './session.js';

import { HookServer } from './hookserver.js';
import { ChannelDispatcher } from './channels/registry.js';
import { SSEChannel } from './channels/sse-channel.js';
import { WeComChannel, WeComChannelConfig } from './channels/wecom-channel.js';
import { LocalFileChannel } from './channels/localfile-channel.js';
import { StateChannel } from './channels/state-channel.js';
import { CloudChannel, CloudChannelConfig } from './channels/cloud-channel.js';
import { OutputChannel, type HookEventLike } from './channels/channel.js';
import { permissionBroker, PermissionRequest as BrokerPermissionRequest } from './permission-broker.js';
import { setNotchMousePassthrough, resizeNotchWindow, showNotchWindow, hideNotchWindow, getNotchWindow } from './notch-window.js';
import { startProxy } from './apiproxy.js';
import { start as startPty, PtyMode, PtySize, preloadShellEnv } from './pty.js';
import { registerTraceIpc } from './trace/ipc.js';
import type { BotConfig } from './types/bot.js';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

function resolveAnthropicBaseUrl(): string {
  const candidates = [
    path.resolve('.claude/settings.local.json'),
    path.resolve('.claude/settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const f of candidates) {
    try {
      const url = JSON.parse(fs.readFileSync(f, 'utf8'))?.env?.ANTHROPIC_BASE_URL;
      if (typeof url === 'string' && url) {
        getLogger().info(`[app] resolved ANTHROPIC_BASE_URL from ${f}: ${url}`);
        return url;
      }
    } catch {}
  }
  getLogger().warn(`[app] no ANTHROPIC_BASE_URL found in settings, using default: ${DEFAULT_ANTHROPIC_BASE_URL}`);
  return DEFAULT_ANTHROPIC_BASE_URL;
}

function createSettingsOverrideFile(proxyUrl: string): { args: string[]; cleanup: () => void } {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const tmpDir = path.join(os.tmpdir(), 'lynel-desktop');
  try {
    // 读取现有 settings.json，在此基础上覆盖 ANTHROPIC_BASE_URL，保留 hooks 等配置
    let data: Record<string, any> = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.trim()) data = JSON.parse(raw);
    } catch {}
    data.env = { ...(data.env || {}), ANTHROPIC_BASE_URL: proxyUrl };
    const settings = JSON.stringify(data, null, 2);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `claude-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmpFile, settings, 'utf8');
    const fileSize = fs.statSync(tmpFile).size;
    const hasHooks = !!(data.hooks && Object.keys(data.hooks).length > 0);
    getLogger().info(`[app] created settings override: ${tmpFile} size=${fileSize} hasHooks=${hasHooks}`);
    return {
      args: ['--settings', tmpFile],
      cleanup: () => {
        try {
          fs.unlinkSync(tmpFile);
          getLogger().info(`[app] removed settings override: ${tmpFile}`);
        } catch {}
      },
    };
  } catch (err: any) {
    getLogger().error(`[app] failed to create settings override: ${err.message}`);
    return { args: [], cleanup: () => {} };
  }
}

function mapHookToKind(name: string): HookEventLike['kind'] | null {
  switch (name) {
    case 'SessionStart': return 'SessionStart';
    default: return null;
  }
}

interface SessionActivity {
  phase: 'thinking' | 'working' | 'idle' | 'awaiting_permission';
  tool?: string;
  toolInput?: string;
}

function normalizeHookActivity(name: string, evt: any): SessionActivity | null {
  switch (name) {
    case 'PreToolUse': {
      const tool = evt.tool_name || evt.tool || '';
      const input = extractToolInput(evt.tool_input || evt.input || {});
      return { phase: 'working', tool, toolInput: input };
    }
    case 'PostToolUse':
      return { phase: 'thinking' };
    default:
      return null;
  }
}

function extractToolInput(input: any): string {
  if (!input || typeof input !== 'object') return '';
  return input.command || input.file_path || input.pattern || input.url || input.query || '';
}

interface RecentSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle: string;
  firstPrompt: string;
  userTitle?: string;
  lastOpenedAt: number;
  state: string;
  botId?: string;
  /** 用户在 claude 终端里主动执行了 /exit（或其他退出命令）。
   *  claude CLI 内部会把这种 session 标记为终止，即使 jsonl 完整存在，
   *  后续 `claude --resume <sid>` 也会被它自己拒绝。
   *  openTerminal 检测到该标志就走 PtyMode.New + 同 sid 重新拉起，
   *  避免触发 "No conversation found" 错误。spawn 成功后立刻清掉，
   *  保证新 session 的下一次 reconnect 走正常的 Resume 路径。 */
  terminated?: boolean;
}

const RECENT_SESSIONS_PATH = path.join(os.homedir(), '.lynel-desktop', 'recent-sessions.json');
const MAX_RECENT_SESSIONS = 30;

function readRecentSessions(): RecentSessionRecord[] {
  try {
    const raw = fs.readFileSync(RECENT_SESSIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 文件不存在或解析失败时返回空数组
  }
  return [];
}

function writeRecentSessions(list: RecentSessionRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(RECENT_SESSIONS_PATH), { recursive: true });
    fs.writeFileSync(RECENT_SESSIONS_PATH, JSON.stringify(list, null, 2), 'utf8');
  } catch (err: any) {
    getLogger().error(`[recent-sessions] write failed: ${err.message}`);
  }
}

async function generateRecentFromProjects(): Promise<RecentSessionRecord[]> {
  const sessions = await jsonl.scanAll();
  const map = new Map<string, RecentSessionRecord>();
  for (const s of sessions) {
    const existing = map.get(s.id);
    const lastOpened = s.mtime * 1000;
    if (!existing || existing.lastOpenedAt < lastOpened) {
      map.set(s.id, {
        sessionId: s.id,
        workdir: s.workdir,
        project: s.project,
        aiTitle: s.ai_title || '',
        firstPrompt: s.first_prompt || '',
        userTitle: s.user_title,
        lastOpenedAt: lastOpened,
        state: 'idle',
      });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_RECENT_SESSIONS);
}

async function getRecentSessions(): Promise<RecentSessionRecord[]> {
  let list = readRecentSessions();
  if (list.length === 0) {
    list = await generateRecentFromProjects();
    if (list.length > 0) writeRecentSessions(list);
  }
  return list;
}

async function addRecentSession(record: RecentSessionRecord): Promise<void> {
  const list = await getRecentSessions();
  const idx = list.findIndex((r) => r.sessionId === record.sessionId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record, lastOpenedAt: Date.now() };
  } else {
    list.unshift({ ...record, lastOpenedAt: Date.now() });
  }
  const sorted = list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, MAX_RECENT_SESSIONS);
  writeRecentSessions(sorted);
}

function removeRecentSession(sessionId: string): void {
  const list = readRecentSessions().filter((r) => r.sessionId !== sessionId);
  writeRecentSessions(list);
}

/** 读取某 session 的 terminated 标志；record 不存在或字段缺失返回 false。 */
function getTerminatedFlag(sessionId: string): boolean {
  const list = readRecentSessions();
  const record = list.find((r) => r.sessionId === sessionId);
  return record?.terminated === true;
}

/** 把某 session 标记为 terminated（用户主动 /exit 之后）。
 *  通过 recent-sessions.json 持久化，应用重启后也能识别。
 *  找不到 record 时只记日志不报错（pending 阶段的 session 也可能触发）。 */
function setTerminatedFlag(sessionId: string): void {
  const list = readRecentSessions();
  const record = list.find((r) => r.sessionId === sessionId);
  if (!record) {
    getLogger().info(`[exit-detect] setTerminatedFlag: sid=${sessionId.slice(0, 8)} not in recent list yet, skip`);
    return;
  }
  if (record.terminated) return;  // 已标记，避免重复写盘
  record.terminated = true;
  writeRecentSessions(list);
  getLogger().info(`[exit-detect] marked terminated sid=${sessionId.slice(0, 8)}`);
}

/** 清除 terminated 标志：在 openTerminal 成功用 PtyMode.New 拉起新 session 后调用，
 *  让新 session 的后续 reconnect 走正常的 Resume 路径。 */
function clearTerminatedFlag(sessionId: string): void {
  const list = readRecentSessions();
  const record = list.find((r) => r.sessionId === sessionId);
  if (!record || !record.terminated) return;
  delete record.terminated;
  writeRecentSessions(list);
  getLogger().info(`[exit-detect] cleared terminated sid=${sessionId.slice(0, 8)}`);
}

/** claude 终端里的"退出"命令集合。用户敲其中任意一个并按 Enter，
 *  claude 内部就把该 session 标记为终止，后续 `--resume` 必失败。
 *  严格匹配（不忽略大小写）：避免正常文本里出现 "exit" 字样被误判。
 *  `/q` 不在列：claude 不支持，且与"问问题"语义容易冲突。 */
const EXIT_COMMANDS = new Set(['/exit', 'exit', '/quit', 'quit']);

/** 把 PTY 收到的一批字节按"当前行"维度消化，识别退出命令。
 *  - \r / \n：行结束，检查 trim 后的内容是否匹配 EXIT_COMMANDS
 *  - \x7f / \b：退格，删一个字
 *  - \x03 (Ctrl+C)：清空当前行（claude 自己也清）
 *  - \x15 (Ctrl+U)：清空当前行（kill）
 *  - \x17 (Ctrl+W)：删一个词（按空白切）
 *  - 其他控制字符：忽略（不影响行内容）
 *  - 可打印字符 / Tab：累加到行尾
 *  返回 { line, detected }：line 是消化完所有字节后的"当前行"，detected 表示本批字节是否触发了退出命令。 */
export function consumeInputForExitDetect(
  prevLine: string,
  data: string,
): { line: string; detected: boolean } {
  let line = prevLine;
  let detected = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === '\r' || ch === '\n') {
      if (EXIT_COMMANDS.has(line.trim())) detected = true;
      line = '';
    } else if (ch === '\x7f' || ch === '\b') {
      line = line.slice(0, -1);
    } else if (ch === '\x03' || ch === '\x15') {
      line = '';  // Ctrl+C / Ctrl+U 全清
    } else if (ch === '\x17') {
      // Ctrl+W：删到上一个空白之后
      line = line.replace(/\S+\s*$/, '');
    } else {
      const code = ch.charCodeAt(0);
      if (code >= 32 || ch === '\t') line += ch;
    }
  }
  return { line, detected };
}

export class App {
  private window: BrowserWindow | null = null;
  private settingsStore = getStore('settings');
  private instanceStore = getStore('instance');
  private providersStore = getStore('providers');
  private hookServer: HookServer | null = null;
  private dispatcher = new ChannelDispatcher();
  private sseChannel = new SSEChannel();
  private wecomChannel = new WeComChannel({} as WeComChannelConfig);
  private localFileChannel = new LocalFileChannel();
  private stateChannel = new StateChannel({
    onStableState: (id, state, persist = true) => this.setSessionState(id, state, persist),
    onActivity: (id, activity) =>
      getBus().emit('sessions:activity', JSON.stringify({ sessionId: id, ...activity })),
  });
  private cloudChannel = new CloudChannel();
  // type → singleton 通道实例；与 settingsStore.channels 的 key 对齐（key === type）
  private channelInstances = new Map<string, OutputChannel>([
    ['wecom', this.wecomChannel],
    ['localfile', this.localFileChannel],
    ['cloud', this.cloudChannel],
  ]);
  private ptyCleanups = new Map<string, (() => void) | null>();
  private recentSessionsLock = false;
  // 待写入 recent 列表的新会话元数据：spawn 时登记，收到首个 UserPromptSubmit 时落盘
  private pendingRecentWrites = new Map<string, { workdir: string; project: string; firstPrompt: string; botId?: string }>();
  // 用户在 xterm.js 输入的"当前行"缓存：仅追踪到下一次 \r/\n，为 /exit 检测提供依据。
  // 渲染端 writeTerminalInput 走 IPC 把字节送到这里。onExit 时清理。
  private inputLineBuffers = new Map<string, string>();
  private aiTitleRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private apiProxies: import('./apiproxy.js').Proxy[] = [];
  private watchCleanup: (() => void) | null = null;
  private sleepBlockerId: number | null = null;

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
    this.dispatcher.register(this.localFileChannel);
    this.dispatcher.register(this.cloudChannel);
    this.dispatcher.register(this.stateChannel);
    this.dispatcher.registerHook(this.stateChannel);
    this.dispatcher.registerHook(this.wecomChannel);
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
    const bus = getBus();
    const originalEmit = bus.emit.bind(bus);
    bus.emit = (event: string | symbol, ...args: any[]) => {
      if (typeof event === 'string') {
        if (!this.window?.isDestroyed()) {
          this.window?.webContents.send(event, ...args);
        }
        const notch = getNotchWindow();
        if (notch && !notch.isDestroyed()) {
          notch.webContents.send(event, ...args);
        }
      }
      return originalEmit(event, ...args);
    };
    win.on('closed', () => {
      this.window = null;
    });
  }

  private clearLockout(): void {
    this.settingsStore.set('lockout.attempts', 0);
    this.settingsStore.set('lockout.until', 0);
  }

  private setSessionState(id: string, state: string, persist = true): void {
    if (persist) {
      this.instanceStore.set(`sessions.${id}.state`, state);
    }
    session.setState(id, state as import('./session.js').SessionState);
    getBus().emit('sessions:state:changed', id, state);
  }

  private recordFailedAttempt(): void {
    const attempts = ((this.settingsStore.get('lockout.attempts', 0) as number) ?? 0) + 1;
    this.settingsStore.set('lockout.attempts', attempts);
    if (attempts >= 5) {
      this.settingsStore.set('lockout.until', Date.now() + 5 * 60 * 1000);
      getLogger().warn('[app] lockout triggered: 5 failed attempts');
    }
  }

  async init(): Promise<void> {
    this.applyChannelConfigs();
    this.applyAutoSettings();
    this.applyPushSettings();
    this.applyCloudSettings();
    // 预热 macOS shell env 缓存（异步，不阻塞 init）
    void preloadShellEnv().catch((err) => {
      getLogger().warn(`[app] preload shell env failed: ${err?.message || err}`);
    });
    session.setOnRemove((id) => this.wecomChannel.clearSessionMappings(id));
    this.wecomChannel.setSessionTitleResolver((sessionId: string) => {
      const list = this.withRecentLock(() => readRecentSessions());
      const r = list.find((x) => x.sessionId === sessionId);
      return r ? (r.userTitle || r.aiTitle || r.firstPrompt || r.project || sessionId.slice(0, 8)) : sessionId.slice(0, 8);
    });
    this.wecomChannel.setCreateSessionHandler(async (workDir: string, prompt: string) => {
      try {
        const stat = await fs.promises.stat(workDir);
        if (!stat.isDirectory()) {
          return { error: `路径不是目录：${workDir}` };
        }
      } catch (err: any) {
        return { error: `目录不存在或无法访问：${workDir}` };
      }
      try {
        const id = await this.createSessionInternal(workDir, prompt, [], true);
        const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;
        getBus().emit('session:created', JSON.stringify({ id, workDir, project, prompt }));
        return { id, workDir };
      } catch (err: any) {
        return { error: err.message };
      }
    });
    // 加载已持久化的 bot 配置到 WeComChannel 连接池
    const bots = this.settingsStore.get('wecomBots', {}) as Record<string, BotConfig>;
    this.wecomChannel.updateBots(Object.values(bots));
    // 加载已有 session 的 bot 绑定
    this.withRecentLock(() => {
      for (const r of readRecentSessions()) {
        if (r.botId) this.wecomChannel.setSessionBot(r.sessionId, r.botId);
      }
    });
    // 当前登录 UM 账户作为默认 chatId
    this.wecomChannel.setCurrentUserAccount(this.getCurrentUserAccount());
    await this.ensureHookServer();
    this.watchJsonl();
    this.startAiTitleRefresh();
    this.registerIpcHandlers();
  }

  async shutdown(): Promise<void> {
    getLogger().info('[app] shutdown begin');
    // 1. 停止 AI title 定时轮询
    if (this.aiTitleRefreshTimer) {
      clearInterval(this.aiTitleRefreshTimer);
      this.aiTitleRefreshTimer = null;
    }
    // 2. 关闭所有 Claude PTY 进程
    for (const s of session.list()) {
      try {
        session.close(s.id, 'SIGTERM');
        getLogger().info(`[app] shutdown closed session sid=${s.id.slice(0, 8)}`);
      } catch (err: any) {
        getLogger().error(`[app] shutdown close session failed sid=${s.id.slice(0, 8)}: ${err.message}`);
      }
    }
    // 3. 关闭所有 API 代理
    for (const proxy of this.apiProxies) {
      try {
        proxy.close();
      } catch { /* ignore */ }
    }
    this.apiProxies = [];
    // 4. 关闭 hook server
    if (this.hookServer) {
      try {
        await this.hookServer.stop();
        getLogger().info('[app] shutdown hook server stopped');
      } catch (err: any) {
        getLogger().error(`[app] shutdown hook server stop failed: ${err.message}`);
      }
    }
    // 5. 停止文件 watcher
    if (this.watchCleanup) {
      try {
        this.watchCleanup();
      } catch { /* ignore */ }
      this.watchCleanup = null;
    }
    // 6. 关闭 channels
    try { await this.wecomChannel.close?.(); } catch { /* ignore */ }
    try { this.localFileChannel.close?.(); } catch { /* ignore */ }
    try { this.cloudChannel.close(); } catch { /* ignore */ }
    getLogger().info('[app] shutdown complete');
    getLogger().info('[app] shutdown complete');
  }

  private applyChannelConfigs(): void {
    const channels = (this.settingsStore.get('channels', {}) || {}) as Record<string, any>;
    let migrated = false;
    for (const [id, val] of Object.entries(channels)) {
      const norm = this.normalizeChannelInstance(id, val);
      if (!norm) continue;
      if (norm !== val) {
        channels[id] = norm;
        migrated = true;
      }
      this.applyChannelConfigToInstance(norm);
    }
    if (!channels.wecom) {
      const legacy = this.settingsStore.get('wecom', null) as WeComChannelConfig | null;
      if (legacy) {
        const wrapper = this.normalizeChannelInstance('wecom', legacy);
        if (wrapper) {
          channels.wecom = wrapper;
          this.applyChannelConfigToInstance(wrapper);
          migrated = true;
          getLogger().info('[app] migrated legacy wecom config to channels');
        }
      }
    }

    // 向后兼容：旧格式 channels.wecom.config 含 botId/secret → 迁移到 wecomBots
    const wecomCfg = channels.wecom?.config;
    if (wecomCfg && (wecomCfg.botId || wecomCfg.secret)) {
      const existingBots = this.settingsStore.get('wecomBots', {}) as Record<string, BotConfig>;
      // 检查是否已经迁移过（已存在同名 bot）
      const alreadyMigrated = Object.values(existingBots).some(
        (b) => b.botId === wecomCfg.botId || (wecomCfg.chatId && b.chatId === wecomCfg.chatId),
      );
      if (!alreadyMigrated) {
        const id = randomUUID();
        const now = Date.now();
        existingBots[id] = {
          id,
          name: 'default',
          source: 'wecom',
          botId: wecomCfg.botId || '',
          secret: wecomCfg.secret || '',
          chatId: wecomCfg.chatId || '',
          createdAt: now,
          updatedAt: now,
        };
        this.settingsStore.set('wecomBots', existingBots);
        getLogger().info('[app] migrated old wecom channel config to wecomBots');
      }
      // 清除 channel config 中的 botId/secret，避免重复迁移
      delete wecomCfg.botId;
      delete wecomCfg.secret;
      if (wecomCfg.chatId) delete wecomCfg.chatId;
      migrated = true;
    }

    if (migrated) {
      this.settingsStore.set('channels', channels);
    }
  }

  private applyPushSettings(): void {
    const pushThinking = this.settingsStore.get('push_thinking', true) as boolean;
    const pushToolCalls = this.settingsStore.get('push_tool_calls', true) as boolean;
    this.wecomChannel.pushThinking = pushThinking;
    this.wecomChannel.pushToolCalls = pushToolCalls;
    getLogger().info(`[app] push settings: thinking=${pushThinking} toolCalls=${pushToolCalls}`);
  }

  private applyAutoSettings(): void {
    // auto_start
    app.setLoginItemSettings({
      openAtLogin: this.settingsStore.get('auto_start', false) as boolean,
    })

    // log_enabled
    const logEnabled = this.settingsStore.get('log_enabled', false) as boolean
    getLogger().transports.file.level = logEnabled ? 'info' : false

    // prevent_sleep
    const preventSleep = this.settingsStore.get('prevent_sleep', false) as boolean
    if (preventSleep && this.sleepBlockerId == null) {
      this.sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!preventSleep && this.sleepBlockerId != null) {
      powerSaveBlocker.stop(this.sleepBlockerId)
      this.sleepBlockerId = null
    }
  }

  private applyCloudSettings(): void {
    const enabled = (this.settingsStore.get('cloud_service_enabled', false) as boolean) || false;
    const url = (this.settingsStore.get('cloud_service_url', '') as string) || '';
    const token = (this.settingsStore.get('cloud_service_token', '') as string) || '';
    const userId = this.getCurrentUserAccount();
    this.cloudChannel.updateConfig({ enabled, url, token, userId });
  }

  private syncCloudSession(sessionId: string, workDir: string): void {
    if (!this.cloudChannel.isEnabled()) return;
    const list = this.withRecentLock(() => readRecentSessions());
    const r = list.find((x) => x.sessionId === sessionId);
    const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;
    const title = r ? (r.userTitle || r.aiTitle || r.firstPrompt || undefined) : undefined;
    const sessionData = {
      session_id: sessionId,
      jsonl_path: jsonl.getSessionJsonlPath(sessionId, workDir),
      cwd: workDir,
      project_name: project,
      title,
      last_activity_at: Math.floor(Date.now() / 1000),
    };
    this.cloudChannel.syncSessions([sessionData]).catch((err) => {
      getLogger().warn(`[app] syncCloudSession failed for ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
    });
  }

  /** 把 ChannelInstance 规范化成 {id, type, name, enabled, config}；旧的内联 config 格式会被包装 */
  private normalizeChannelInstance(id: string, raw: any): Record<string, any> | null {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.type === 'string' && raw.config && typeof raw.config === 'object') {
      return {
        id: raw.id ?? id,
        type: raw.type,
        name: raw.name ?? raw.type,
        enabled: !!raw.enabled,
        config: raw.config,
      };
    }
    // 旧格式：直接是 config 对象（可能含 enabled）
    return {
      id,
      type: id,
      name: id,
      enabled: !!raw.enabled,
      config: raw,
    };
  }

  /** 把 wrapper.enabled 合并进内层 config，再喂给 channel instance */
  private applyChannelConfigToInstance(wrapper: Record<string, any>): void {
    const instance = this.channelInstances.get(wrapper.id);
    if (!instance?.updateConfig) return;
    const inner = { ...(wrapper.config ?? {}), enabled: !!wrapper.enabled };
    try {
      instance.updateConfig(inner);
    } catch (err) {
      getLogger().error(`[app] channel ${wrapper.id} updateConfig failed:`, err);
    }
  }

  /** 从 ~/.claude/settings.json 读取已有 env 配置，构建默认供应商 */
  private readDefaultProviderFromSettings(): Record<string, any> {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let env: Record<string, string> = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.trim()) {
        const data = JSON.parse(raw);
        if (data.env && typeof data.env === 'object') {
          env = data.env;
        }
      }
    } catch {
      // settings.json 不存在或格式错误，用空 env
    }
    return {
      id: 'default',
      name: '默认',
      base_url: env.ANTHROPIC_BASE_URL || '',
      auth_token: env.ANTHROPIC_AUTH_TOKEN || '',
      default_model: env.ANTHROPIC_MODEL || '',
      default_haiku_model: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
      default_sonnet_model: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      default_opus_model: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      reasoning_model: env.ANTHROPIC_REASONING_MODEL || '',
    };
  }

  private async ensureHookServer(): Promise<void> {
    this.hookServer = new HookServer(this.sseChannel);

    // 通用 hook 事件：EventBus + ChannelDispatcher（部分事件）
    this.hookServer.onEvent((evt) => {
      const sid = evt.session_id ?? '';
      const name = evt.hook_event_name ?? evt.type ?? '';
      const toolName = evt.tool_name || (evt as any).tool || '';

      // 收到首个 UserPromptSubmit 才把会话写入 recent 列表，
      // 避免新建后未发 prompt 就关闭/重启产生 phantom session。
      if (name === 'UserPromptSubmit' && sid && this.pendingRecentWrites.has(sid)) {
        const meta = this.pendingRecentWrites.get(sid)!;
        this.pendingRecentWrites.delete(sid);
        const hookPrompt = typeof (evt as any).prompt === 'string' ? (evt as any).prompt : meta.firstPrompt;
        addRecentSession({
          sessionId: sid,
          workdir: meta.workdir,
          project: meta.project,
          aiTitle: '',
          firstPrompt: hookPrompt,
          lastOpenedAt: Date.now(),
          state: 'running',
          botId: meta.botId,
        }).catch((err) => getLogger().error(`[app] deferred addRecentSession failed: ${err?.message ?? err}`));
      }

      getBus().emit(`hook:${sid}`, JSON.stringify(evt));

      // 广播结构化活动事件（供灵动岛等 UI 消费）
      const activity = normalizeHookActivity(name, evt);
      if (activity && sid) {
        getBus().emit('sessions:activity', JSON.stringify({ sessionId: sid, ...activity }));
      }

      // PostToolUse / PostToolUseFailure：如果 broker 仍有该 session+tool 的待处理条目，
      // 说明用户在终端自行解决了权限 → 取消 broker 条目并通知 UI 关闭
      if ((name === 'PostToolUse' || name === 'PostToolUseFailure') && sid && toolName) {
        if (permissionBroker.cancelBySessionTool(sid, toolName)) {
          getBus().emit('permission:cancelled', JSON.stringify({ sessionId: sid, toolName }));
        }
      }

      const kind = mapHookToKind(name);
      if (kind) {
        const s = session.lookup(sid);
        const workDir = s?.workDir ?? '';
        try {
          this.dispatcher.dispatchHook({ kind, sessionId: sid, workDir, payload: evt as Record<string, unknown> });
        } catch {}
      }
    });

    // PermissionRequest：走 broker 阻塞等待用户决策
    this.hookServer.onPermissionRequest(async (evt) => {
      const sid = evt.session_id ?? '';
      const request = evt.request || ({} as any);
      const toolName = evt.tool_name || evt.tool || request.tool_name || 'unknown';
      const toolInput = evt.tool_input || request.tool_input || request.toolInput || request.input || {};

      const s = session.lookup(sid);
      const workDir = s?.workDir ?? '';
      const reqId = String(request.id || randomUUID());

      // 自动允许：除 AskUserQuestion 外的工具直接放行
      if (toolName !== 'AskUserQuestion') {
        const autoAllowBash = this.settingsStore.get('auto_allow_bash', false) as boolean;
        if (autoAllowBash) {
          getLogger().info(`[permission] auto-allowed tool=${toolName} sid=${sid.slice(0, 8)}`);
          return { id: reqId, allowed: true };
        }
      }

      const seq = permissionBroker.allocateSeq(reqId);
      const req: BrokerPermissionRequest = { id: reqId, sessionId: sid, workDir, toolName, toolInput };

      // 通知主窗口（保持兼容现有 PermissionToast）
      getBus().emit('permission:request', JSON.stringify({ ...req, seq }));
      getBus().emit(`hook:${sid}`, JSON.stringify(evt));

      // 通知所有通道展示审批 UI（带上预分配的 seq）
      try {
        this.dispatcher.dispatchHook({ kind: 'PermissionRequest', sessionId: sid, workDir, payload: { ...req, seq } });
      } catch {}

      // 阻塞等待
      const result = await permissionBroker.wait(req);
      return { id: reqId, allowed: result.decision === 'allow', answers: result.answers };
    });

    this.hookServer.onSend(async (sid, prompt) => {
      try {
        session.send(sid, prompt);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    });

    // broker resolve/cancel 回调 → 广播到通道 + 通知灵动岛关闭 UI
    permissionBroker.onResolve((id, decision, source, sessionId, toolName) => {
      // 通知灵动岛关闭权限 UI
      getBus().emit('permission:cancelled', JSON.stringify({ sessionId, toolName }));
      try {
        const workDir = session.lookup(sessionId)?.workDir ?? '';
        this.dispatcher.dispatchHook({ kind: 'PermissionResolved', sessionId, workDir, payload: { id, decision, source, toolName } });
      } catch {}
    });
    permissionBroker.onCancel((id, sessionId, toolName) => {
      try {
        // 带真实 sessionId 派发，StateChannel 才能清除 pendingPermission 并恢复状态
        const workDir = session.lookup(sessionId)?.workDir ?? '';
        this.dispatcher.dispatchHook({ kind: 'PermissionResolved', sessionId, workDir, payload: { id, source: 'terminal', toolName } });
      } catch {}
    });

    try {
      await this.hookServer.start();
      getLogger().info(`[app] hook server started on port ${this.hookServer.getPort()}`);
    } catch (err: any) {
      getLogger().error(`[app] hook server failed to start: ${err.message}`);
      return;
    }
    this.checkAndFixHooks();
  }

  private checkAndFixHooks(): boolean {
    const port = this.hookServer?.getPort() ?? 0;
    if (port === 0) {
      getLogger().error('[app] hook server not running, skip hook fix');
      return false;
    }

    const hookURL = `http://127.0.0.1:${port}/hook`;
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    let data: Record<string, any> = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.trim()) data = JSON.parse(raw);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        getLogger().error(`[app] read settings.json failed: ${err.message}`);
        return false;
      }
    }

    const hookTypes: Record<string, number> = {
      PermissionRequest: 7200,
      PreToolUse: 5,
      PostToolUse: 5,
      PostToolUseFailure: 5,
    };

    const hooksObj: Record<string, any> = {};
    for (const [name, timeout] of Object.entries(hookTypes)) {
      hooksObj[name] = [{ hooks: [{ type: 'http', url: hookURL, timeout }] }];
    }

    // 检查是否已正确配置，避免重复写入
    if (data.hooks && JSON.stringify(data.hooks) === JSON.stringify(hooksObj)) {
      getLogger().info('[app] hooks already configured correctly, skip');
      return true;
    }

    getLogger().info('[app] hooks config outdated or missing, fixing...');
    if (fs.existsSync(settingsPath)) {
      try {
        fs.copyFileSync(settingsPath, settingsPath + '.lynel-desktop.bak');
      } catch (err: any) {
        getLogger().warn(`[app] backup settings.json failed: ${err.message}`);
      }
    }

    data.hooks = hooksObj;

    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
      getLogger().info(`[app] hooks configured for ${hookURL}`);
      return true;
    } catch (err: any) {
      getLogger().error(`[app] write settings.json failed: ${err.message}`);
      return false;
    }
  }

  private applyActiveProvider(): boolean {
    const cfg = (this.providersStore.get('config', {}) as Record<string, any>) || {};
    const activeId = cfg.active_provider_id as string | undefined;
    if (!activeId) return false;
    const providers = cfg.providers as any[] | undefined;
    if (!Array.isArray(providers)) return false;
    const active = providers.find((p: any) => p.id === activeId);
    if (!active) return false;

    const envKeys: Record<string, string> = {
      base_url: 'ANTHROPIC_BASE_URL',
      auth_token: 'ANTHROPIC_AUTH_TOKEN',
      default_model: 'ANTHROPIC_MODEL',
      default_haiku_model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      default_sonnet_model: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      default_opus_model: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    };
    // 推理模型使用通用模型名
    const reasoningModel = active.reasoning_model as string | undefined;

    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let data: Record<string, any> = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.trim()) data = JSON.parse(raw);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        getLogger().error(`[app] read settings.json for provider failed: ${err.message}`);
        return false;
      }
    }

    if (!data.env) data.env = {};
    for (const [key, envName] of Object.entries(envKeys)) {
      const val = active[key] as string | undefined;
      if (val) data.env[envName] = val;
    }
    if (reasoningModel) {
      data.env['ANTHROPIC_REASONING_MODEL'] = reasoningModel;
    }

    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
      getLogger().info(`[app] applied provider "${active.name}" to settings.json`);
      return true;
    } catch (err: any) {
      getLogger().error(`[app] write settings.json for provider failed: ${err.message}`);
      return false;
    }
  }

  private async createSessionInternal(workDir: string, prompt: string, extraArgs: string[] = [], autoTrust = false, botId?: string): Promise<string> {
    const realId = randomUUID();
    const upstream = resolveAnthropicBaseUrl();
    const proxy = await startProxy(workDir, realId, (env) => this.dispatcher.dispatch(env), undefined, upstream);
    this.apiProxies.push(proxy);
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
    const allArgs = [...args, ...extraArgs];
    getLogger().info(`[app:createSession] proxyUrl=${proxyUrl} upstream=${upstream} workDir=${workDir} sessionId=${realId} extraArgs=${extraArgs.join(',')}`);
    const claudeBin = (this.settingsStore.get('claude_path', '') as string) || 'claude';
    const proc = startPty(workDir, realId, claudeBin, PtyMode.New, {}, { cols: 80, rows: 24 }, allArgs);
    const s = session.newSession(realId, workDir);
    s.process = proc;
    s.state = 'running';
    session.register(s);
    this.setSessionState(realId, 'running');
    this.wirePty(realId, proc);
    this.syncCloudSession(realId, workDir);
    proc.onExit(() => cleanup());

    getLogger().info(`[app:createSession] session created id=${realId} workDir=${workDir}`);
    // autoTrust：监听 PTY 输出，出现工作区信任确认时回车接受默认选项；
    // 等输入框就绪（"? for shortcuts"）再发提示词。提示词与回车分开写入，
    // 避免同一 chunk 被 ink 粘贴检测吞掉回车导致不执行。
    if (autoTrust) {
      let trusted = false;
      let promptSent = !prompt;
      let buffer = '';
      const sendPrompt = () => {
        if (promptSent) return;
        promptSent = true;
        try {
          proc.write(prompt);
          setTimeout(() => {
            try { proc.write('\r'); } catch { /* pty 已退出 */ }
          }, 300);
        } catch (err: any) {
          getLogger().error(`[app:createSession] autoTrust send prompt failed: ${err.message}`);
        }
      };
      // 兜底：15s 内没检测到就绪标志也强制发送，避免提示词丢失
      const fallback = setTimeout(sendPrompt, 15000);
      proc.onData((data) => {
        if (trusted && promptSent) return;
        buffer = (buffer + data).slice(-4000);
        if (!trusted && /trust the files|Do you trust/i.test(buffer)) {
          trusted = true;
          buffer = '';
          try { proc.write('\r'); } catch { /* pty 已退出 */ }
          return;
        }
        if (!promptSent && /\? for shortcuts/.test(buffer)) {
          clearTimeout(fallback);
          sendPrompt();
        }
      });
    } else if (prompt) {
      session.send(realId, prompt);
    }
    const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;
    // 延迟到首个 UserPromptSubmit hook 再写 recent 列表，
    // 避免新建后未发 prompt 就关闭/重启产生 phantom session（jsonl 永远不存在）。
    this.pendingRecentWrites.set(realId, {
      workdir: workDir,
      project,
      firstPrompt: prompt,
      botId,
    });
    if (botId) {
      this.wecomChannel.setSessionBot(realId, botId);
      this.wecomChannel.sendSessionStarted(realId, workDir);
    }
    return realId;
  }

  private withRecentLock<T>(fn: () => T): T {
    while (this.recentSessionsLock) {
      // spin-wait; Node is single-threaded so this only blocks async interleaving
    }
    this.recentSessionsLock = true;
    try {
      return fn();
    } finally {
      this.recentSessionsLock = false;
    }
  }

  private getCurrentUserAccount(): string {
    return (this.settingsStore.get('currentUser', '') as string) || os.userInfo().username;
  }

  private setCurrentUserAccount(account: string): void {
    this.settingsStore.set('currentUser', account);
    this.wecomChannel.setCurrentUserAccount(account);
  }

  private startAiTitleRefresh(): void {
    const FIVE_MIN = 5 * 60 * 1000;
    this.aiTitleRefreshTimer = setInterval(() => {
      void this.refreshAiTitles();
    }, FIVE_MIN);
  }

  private async refreshAiTitles(): Promise<void> {
    const list = this.withRecentLock(() => readRecentSessions());
    let changed = false;
    for (const record of list) {
      if (record.aiTitle || record.userTitle) continue;
      try {
        const filePath = jsonl.getSessionJsonlPath(record.sessionId, record.workdir);
        const aiTitle = await jsonl.scanFileAiTitle(filePath);
        if (aiTitle) {
          record.aiTitle = aiTitle;
          changed = true;
          getBus().emit('session:title:changed', record.sessionId, aiTitle, 'ai');
          getLogger().info(`[aiTitle] found for sid=${record.sessionId.slice(0, 8)}: ${aiTitle.slice(0, 40)}`);
        }
      } catch {
        // file may not exist yet
      }
    }
    if (changed) {
      this.withRecentLock(() => writeRecentSessions(list));
    }
  }

  private mergeRecentTitles(raw: jsonl.SessionMeta[]): jsonl.SessionMeta[] {
    const recents = this.withRecentLock(() => readRecentSessions());
    const map = new Map(recents.map((r) => [r.sessionId, r]));
    return raw.map((s) => {
      const r = map.get(s.id);
      if (!r) return s;
      if (r.userTitle) {
        return { ...s, user_title: r.userTitle, title_source: 'user' as jsonl.TitleSource };
      }
      if (r.aiTitle) {
        return { ...s, ai_title: r.aiTitle, title_source: 'ai' as jsonl.TitleSource };
      }
      return s;
    });
  }

  private watchJsonl(): void {
    this.watchCleanup = jsonl.watchProjects(() => {
      getBus().emit('sessions:list:changed');
    });
  }

  private registerIpcHandlers(): void {
    registerTraceIpc();
    // 系统剪贴板写入：渲染端 navigator.clipboard 在 file:// + contextIsolation 下
    // 经常静默失败（权限/激活上下文），改走主进程 electron.clipboard 模块，
    // 保证写出的内容能被企业微信、浏览器等外部应用读到。
    ipcMain.handle('app:clipboardWrite', (_event, text: string) => {
      clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''))
      return true
    })
    ipcMain.handle('app:isInitialized', () => {
      const hash = this.settingsStore.get('auth.hash', '');
      return auth.isInitialized(hash as string);
    });

    ipcMain.handle('app:verify', async (_event, pw: string) => {
      const hash = this.settingsStore.get('auth.hash', '') as string;
      const ok = await auth.verifyPassword(hash, pw);
      if (ok) {
        this.clearLockout();
      } else {
        this.recordFailedAttempt();
        getLogger().warn('[app] password verification failed');
      }
      return ok;
    });

    ipcMain.handle('app:lockoutState', () => {
      const attempts = (this.settingsStore.get('lockout.attempts', 0) as number) ?? 0;
      const until = (this.settingsStore.get('lockout.until', 0) as number) ?? 0;
      return [attempts, until > 0 ? until : null];
    });

    ipcMain.handle('app:setPassword', (_event, pw: string) => {
      this.clearLockout();
      return auth.hashPassword(pw).then((hash) => {
        this.settingsStore.set('auth.hash', hash);
      });
    });

    ipcMain.handle('app:clearPassword', () => {
      this.clearLockout();
      this.settingsStore.set('auth.hash', '');
    });

    ipcMain.handle('app:listSessions', async (_event, workDir?: string) => {
      const all = await jsonl.scanAll();
      const merged = this.mergeRecentTitles(all);
      if (!workDir) return merged;
      const normalized = path.normalize(workDir).toLowerCase();
      return merged.filter((s) => path.normalize(s.workdir).toLowerCase() === normalized);
    });

    ipcMain.handle('app:getSessionMessages', (_event, id: string, workDir: string, offset: number, limit: number) => {
      const filePath = jsonl.getSessionJsonlPath(id, workDir);
      return jsonl.parseMessages(filePath, offset, limit);
    });

    ipcMain.handle('app:createSession', async (_event, workDir: string, prompt: string, extraArgs: string[] = []) => {
      return this.createSessionInternal(workDir, prompt, extraArgs);
    });

    ipcMain.handle('app:sendMessage', (_event, id: string, prompt: string) => {
      try {
        session.send(id, prompt);
      } catch (err: any) {
        getLogger().error(`[app:sendMessage] failed for sid=${id}: ${err.message}`);
        throw err;
      }
    });

    ipcMain.handle('app:closeSession', (_event, id: string) => {
      getLogger().info(`[app:closeSession] closing sid=${id}`);
      session.close(id);
    });

    ipcMain.handle('app:getAppInfo', () => ({
      version: app.getVersion(),
      username: os.userInfo().username,
    }));

    ipcMain.handle('app:getSettings', () => this.settingsStore.store);
    ipcMain.handle('app:updateSettings', (_event, cfg: any) => {
      this.settingsStore.set(cfg);
      this.applyAutoSettings();
      this.applyPushSettings();
      this.applyCloudSettings();
      // 灵动岛开关已隐藏，强制保持关闭
      hideNotchWindow();
    });

    ipcMain.handle('app:getWeComConfig', () => {
      return this.settingsStore.get('wecom', {}) as WeComChannelConfig;
    });
    ipcMain.handle('app:updateWeComConfig', (_event, cfg: WeComChannelConfig) => {
      this.settingsStore.set('wecom', cfg);
      this.wecomChannel.updateConfig(cfg);
    });

    ipcMain.handle('app:getChannelsConfig', () => {
      const channels = (this.settingsStore.get('channels', {}) || {}) as Record<string, any>;
      let migrated = false;
      const result: Record<string, any> = {};
      for (const [id, val] of Object.entries(channels)) {
        const norm = this.normalizeChannelInstance(id, val);
        if (!norm) continue;
        result[id] = norm;
        if (norm !== val) {
          channels[id] = norm;
          migrated = true;
        }
      }
      if (!result.wecom) {
        const legacy = this.settingsStore.get('wecom', null) as WeComChannelConfig | null;
        if (legacy) {
          const wrapper = this.normalizeChannelInstance('wecom', legacy);
          if (wrapper) {
            result.wecom = wrapper;
            channels.wecom = wrapper;
            migrated = true;
            getLogger().info('[app] migrated legacy wecom config to channels');
          }
        }
      }
      if (migrated) {
        this.settingsStore.set('channels', channels);
      }
      return result;
    });

    ipcMain.handle('app:updateChannelConfig', (_event, id: string, wrapper: any) => {
      if (!id || typeof id !== 'string') {
        throw new Error('channel id is required');
      }
      const norm = this.normalizeChannelInstance(id, wrapper);
      if (!norm) {
        throw new Error(`invalid channel payload for ${id}`);
      }
      const channels = (this.settingsStore.get('channels', {}) || {}) as Record<string, any>;
      channels[id] = norm;
      this.settingsStore.set('channels', channels);
      this.applyChannelConfigToInstance(norm);
      getLogger().info(`[app] channel config updated: ${id}`);
    });

    ipcMain.handle('app:deleteChannelConfig', (_event, id: string) => {
      if (!id || typeof id !== 'string') return { ok: false, error: 'invalid id' };
      const channels = (this.settingsStore.get('channels', {}) || {}) as Record<string, any>;
      if (!channels[id]) {
        getLogger().info(`[app] channel delete skipped (not present): ${id}`);
        return { ok: true };
      }
      delete channels[id];
      this.settingsStore.set('channels', channels);
      // 重置通道实例：置 disabled + 关闭连接，避免 dispatcher 继续派发
      const instance = this.channelInstances.get(id);
      if (instance) {
        if (instance.updateConfig) {
          try {
            instance.updateConfig({ enabled: false });
          } catch (err) {
            getLogger().error(`[app] channel ${id} updateConfig(reset) failed:`, err);
          }
        }
        const closeResult = instance.close?.();
        if (closeResult && typeof (closeResult as Promise<void>).catch === 'function') {
          (closeResult as Promise<void>).catch((err: unknown) =>
            getLogger().warn(`[app] channel ${id} close failed:`, err),
          );
        }
      }
      getLogger().info(`[app] channel deleted: ${id}`);
      return { ok: true };
    });

    ipcMain.handle('app:getSessionStates', async () => {
      const states: Record<string, string> = {};
      const list = await jsonl.scanAll();
      for (const meta of list) {
        const state = this.instanceStore.get(`sessions.${meta.id}.state`, 'idle') as string;
        const hasProcess = !!session.lookup(meta.id)?.process;
        if (state === 'running' && !hasProcess) {
          states[meta.id] = 'idle';
        } else {
          states[meta.id] = state;
        }
      }
      return states;
    });

    ipcMain.handle('app:adoptSession', async (_event, id: string, workDir: string) => {
      if (!session.lookup(id)) {
        session.register(session.newSession(id, workDir));
        this.syncCloudSession(id, workDir);
        getLogger().info(`[app:adoptSession] adopted sid=${id} workDir=${workDir}`);
      }
      let title: string | null = null;
      let source: jsonl.TitleSource = 'first_prompt';
      this.withRecentLock(() => {
        const list = readRecentSessions();
        const record = list.find((r) => r.sessionId === id);
        if (record) {
          record.lastOpenedAt = Date.now();
          source = record.userTitle ? 'user' : (record.aiTitle ? 'ai' : 'first_prompt');
          title = record.userTitle || record.aiTitle || record.firstPrompt || id.slice(0, 8);
        } else {
          const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;
          list.unshift({
            sessionId: id,
            workdir: workDir,
            project,
            aiTitle: '',
            firstPrompt: '',
            lastOpenedAt: Date.now(),
            state: 'idle',
          });
        }
        writeRecentSessions(list);
      });
      return title ? { title, source } : null;
    });

    ipcMain.handle('app:renameSession', async (_event, id: string, workDir: string, title: string) => {
      const trimmed = (title || '').trim();
      if (!trimmed) throw new Error('title cannot be empty');
      this.withRecentLock(() => {
        const list = readRecentSessions();
        const record = list.find((r) => r.sessionId === id);
        if (record) {
          record.userTitle = trimmed;
        } else {
          list.unshift({
            sessionId: id,
            workdir: workDir,
            project: workDir.split(/[\\/]/).filter(Boolean).pop() || workDir,
            aiTitle: '',
            firstPrompt: '',
            userTitle: trimmed,
            lastOpenedAt: Date.now(),
            state: 'idle',
          });
        }
        writeRecentSessions(list);
      });
      getBus().emit('session:title:changed', id, trimmed, 'user');
      getLogger().info(`[app:renameSession] sid=${id.slice(0, 8)} title=${trimmed}`);
    });

    ipcMain.handle('app:getSessionTitle', async (_event, id: string, _workDir: string) => {
      const list = this.withRecentLock(() => readRecentSessions());
      const r = list.find((x) => x.sessionId === id);
      if (!r) return null;
      const source: jsonl.TitleSource = r.userTitle ? 'user' : (r.aiTitle ? 'ai' : 'first_prompt');
      return { title: r.userTitle || r.aiTitle || r.firstPrompt || id.slice(0, 8), source };
    });

    ipcMain.handle('app:openSessionTerminal', (_event, id: string, workDir: string) => {
      return this.openTerminal(id, workDir);
    });

    ipcMain.handle('app:openSessionTerminalSized', (_event, id: string, workDir: string, cols: number, rows: number) => {
      return this.openTerminal(id, workDir, { cols, rows });
    });

    ipcMain.handle('app:writeTerminalInput', (_event, id: string, data: string) => {
      session.writeInput(id, data);
      // /exit 检测：增量消化写入的字节，行内匹配到退出命令就标记 session。
      // 写入 PTY 之后再做 detect 是有意为之：PTY 已经把字符送给 claude 了，
      // 我们只是 side-channel 记录 intent，不影响输入流。
      const prev = this.inputLineBuffers.get(id) ?? '';
      const { line, detected } = consumeInputForExitDetect(prev, data);
      this.inputLineBuffers.set(id, line);
      if (detected) setTerminatedFlag(id);
    });

    ipcMain.handle('app:resizeTerminal', (_event, id: string, cols: number, rows: number) => {
      session.resize(id, cols, rows);
    });

    ipcMain.handle('app:pickDirectory', async () => {
      const result = await dialog.showOpenDialog(this.window!, { properties: ['openDirectory'] });
      return result.filePaths[0] ?? '';
    });

    ipcMain.handle('app:getRecentSessions', () => getRecentSessions());
    ipcMain.handle('app:addRecentSession', (_event, record: RecentSessionRecord) => addRecentSession(record));
    ipcMain.handle('app:removeRecentSession', (_event, sessionId: string) => removeRecentSession(sessionId));

    // Bot 管理
    ipcMain.handle('app:listBots', () => {
      const bots = this.settingsStore.get('wecomBots', {}) as Record<string, BotConfig>;
      return Object.values(bots);
    });
    ipcMain.handle('app:saveBot', (_event, bot: BotConfig) => {
      const bots = { ...(this.settingsStore.get('wecomBots', {}) as Record<string, BotConfig>) };
      const id = bot.id || randomUUID();
      const now = Date.now();
      const currentUser = this.getCurrentUserAccount();
      bots[id] = {
        ...bot,
        id,
        source: bot.source || 'wecom',
        chatId: bot.chatId || currentUser,
        createdAt: bot.createdAt || now,
        updatedAt: now,
      };
      this.settingsStore.set('wecomBots', bots);
      this.wecomChannel.updateBots(Object.values(bots));
      return bots[id];
    });
    ipcMain.handle('app:deleteBot', (_event, id: string) => {
      const bots = { ...(this.settingsStore.get('wecomBots', {}) as Record<string, BotConfig>) };
      if (!bots[id]) return { ok: false, error: 'not found' };
      delete bots[id];
      this.settingsStore.set('wecomBots', bots);
      this.wecomChannel.updateBots(Object.values(bots));
      // 清除使用该 bot 的 session 绑定
      this.withRecentLock(() => {
        const list = readRecentSessions();
        for (const r of list) {
          if (r.botId === id) {
            r.botId = undefined;
            this.wecomChannel.clearSessionBot(r.sessionId);
          }
        }
        writeRecentSessions(list);
      });
      return { ok: true };
    });
    ipcMain.handle('app:bindSessionBot', (_event, sessionId: string, botId: string | null) => {
      this.withRecentLock(() => {
        const list = readRecentSessions();
        const record = list.find((r) => r.sessionId === sessionId);
        if (record) {
          record.botId = botId ?? undefined;
        } else {
          list.unshift({
            sessionId, workdir: '', project: '', aiTitle: '',
            firstPrompt: '', lastOpenedAt: Date.now(), state: 'idle',
            botId: botId ?? undefined,
          });
        }
        writeRecentSessions(list);
      });
      if (botId) {
        this.wecomChannel.setSessionBot(sessionId, botId);
        // 绑定 bot 时如果会话已运行，也推送启动通知
        const s = session.lookup(sessionId);
        if (s?.process) {
          this.wecomChannel.sendSessionStarted(sessionId, s.workDir);
        }
      } else {
        this.wecomChannel.clearSessionBot(sessionId);
      }
      return { ok: true };
    });
    ipcMain.handle('app:getSessionBotBinding', (_event, sessionId: string) => {
      const list = this.withRecentLock(() => readRecentSessions());
      return list.find((r) => r.sessionId === sessionId)?.botId ?? null;
    });
    ipcMain.handle('app:getBotConnectionStatus', () => {
      return this.wecomChannel.getBotConnectionStatus();
    });
    ipcMain.handle('app:listBotBindings', () => {
      const list = this.withRecentLock(() => readRecentSessions());
      const map: Record<string, string> = {};
      for (const r of list) {
        if (r.botId) map[r.botId] = r.sessionId;
      }
      return map;
    });

    ipcMain.handle('app:setCurrentUser', (_event, account: string) => {
      this.setCurrentUserAccount(account);
      return { ok: true };
    });
    ipcMain.handle('app:getCurrentUser', () => this.getCurrentUserAccount());

    ipcMain.handle('app:getHookServerPort', () => this.hookServer?.getPort() ?? 0);

    ipcMain.handle('app:getProvidersConfig', () => {
      const cfg = (this.providersStore.get('config', {}) as Record<string, any>) || {};
      if (!Array.isArray(cfg.providers) || cfg.providers.length === 0) {
        // 首次使用：从 ~/.claude/settings.json 读取已有 env 配置作为默认供应商
        const defaultProvider = this.readDefaultProviderFromSettings();
        const newCfg = {
          active_provider_id: defaultProvider.id,
          providers: [defaultProvider],
        };
        this.providersStore.set('config', newCfg);
        getLogger().info('[app] auto-created default provider from settings.json');
        return newCfg;
      }
      return cfg;
    });

    ipcMain.handle('app:saveProvidersConfig', (_event, cfg: Record<string, any>) => {
      this.providersStore.set('config', cfg);
      this.applyActiveProvider();
    });

    ipcMain.handle('app:applyActiveProvider', () => {
      return this.applyActiveProvider();
    });

    ipcMain.handle('app:testProviderConnection', async (_event, baseUrl: string, authToken: string, defaultModel?: string) => {
      try {
        const trimmed = baseUrl.replace(/\/+$/, '');
        const model = defaultModel?.trim() || 'claude-sonnet-4-6-20251101';
        const base = trimmed.endsWith('/v1') ? trimmed : trimmed + '/v1';

        // 1. 先试 Anthropic 格式 /v1/messages
        const anthRes = await fetch(base + '/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': authToken,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(15000),
        });
        if (anthRes.ok) return { ok: true, format: 'anthropic' };

        // 2. 404 时回退试 OpenAI 格式 /v1/chat/completions
        if (anthRes.status === 404) {
          const oaiRes = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
            signal: AbortSignal.timeout(15000),
          });
          if (oaiRes.ok) {
            return {
              ok: true,
              format: 'openai',
              warning: '该供应商使用 OpenAI 格式，Claude CLI 需要代理才能使用',
            };
          }
          const oaiBody = await oaiRes.text().catch(() => '');
          return { ok: false, error: parseApiError(oaiBody, oaiRes.status) };
        }

        const anthBody = await anthRes.text().catch(() => '');
        return { ok: false, error: parseApiError(anthBody, anthRes.status) };
      } catch (err: any) {
        return { ok: false, error: err.message || String(err) };
      }
    });

    ipcMain.handle('app:fetchProviderModels', async (_event, baseUrl: string, authToken: string) => {
      try {
        const trimmed = baseUrl.replace(/\/+$/, '');
        // 兼容 base_url 已带 /v1 的情况
        const url = trimmed.endsWith('/v1')
          ? trimmed + '/models'
          : trimmed + '/v1/models';
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'x-api-key': authToken } : {}),
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
        const body = await res.json();
        // 兼容 OpenAI / LiteLLM / One API 等常见格式
        const data: Array<{ id?: string }> = body?.data ?? [];
        const models = data.map((m: any) => (typeof m === 'string' ? m : m.id)).filter(Boolean) as string[];
        return { ok: true, models };
      } catch (err: any) {
        return { ok: false, error: err.message || String(err), models: [] };
      }
    });

    // 解析 API 错误响应，提取人类可读的错误信息
    function parseApiError(body: string, status: number): string {
      const statusText: Record<number, string> = {
        400: '请求参数错误',
        401: '认证失败，请检查 Auth Token',
        403: '无权限访问',
        404: '接口不存在，请检查 Base URL',
        408: '请求超时',
        429: '请求过于频繁，请稍后再试',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务暂不可用',
      };
      const hint = statusText[status] || '';
      try {
        const obj = JSON.parse(body);
        // Anthropic 格式: { type: "error", error: { type: "...", message: "..." } }
        // OpenAI 兼容: { error: { message: "...", type: "...", code: "..." } }
        const err = obj?.error;
        if (err && typeof err === 'object') {
          const msg = typeof err.message === 'string' ? err.message : '';
          const type = typeof err.type === 'string' ? err.type : '';
          if (msg) return hint ? `${hint}：${msg}` : msg;
          if (type) return hint ? `${hint}（${type}）` : type;
        }
        // 兜底：直接取 message 字段
        if (typeof obj?.message === 'string') return obj.message;
        // 无已知结构，返回简化 JSON
        const short = body.length > 120 ? body.slice(0, 120) + '…' : body;
        return hint ? `${hint}\n${short}` : `HTTP ${status}\n${short}`;
      } catch {
        const short = body.length > 120 ? body.slice(0, 120) + '…' : body;
        return hint || `HTTP ${status}\n${short}`;
      }
    }

    ipcMain.handle('app:checkAndFixHooks', () => this.checkAndFixHooks());

    // 权限审批
    ipcMain.handle('permission:resolve', (_event, id: string, decision: 'allow' | 'deny', source: string, answers?: Record<string, string | string[]>) => {
      return permissionBroker.resolve(id, decision, source, answers);
    });

    ipcMain.handle('permission:isPending', (_event, id: string) => {
      return permissionBroker.isPending(id);
    });

    // 灵动岛窗口控制
    ipcMain.on('notch:setPassthrough', (_event, passthrough: boolean) => {
      setNotchMousePassthrough(passthrough);
    });
    ipcMain.on('notch:setSize', (_event, w: number, h: number) => {
      resizeNotchWindow(w, h);
    });
    ipcMain.on('notch:setVisibility', (_event, visible: boolean) => {
      if (visible) {
        showNotchWindow();
      } else {
        hideNotchWindow();
      }
    });

    // Window controls
    ipcMain.on('window:minimise', () => this.window?.minimize());
    ipcMain.on('window:maximise', () => this.window?.maximize());
    ipcMain.on('window:unmaximise', () => this.window?.unmaximize());
    ipcMain.on('window:unminimise', () => {
      if (this.window?.isMinimized()) this.window.restore();
      this.window?.show();
    });
    ipcMain.on('window:toggleMaximise', () => {
      if (this.window?.isMaximized()) this.window.unmaximize();
      else this.window?.maximize();
    });
    ipcMain.handle('window:isMaximised', () => this.window?.isMaximized() ?? false);
    ipcMain.on('window:show', () => this.window?.show());
    ipcMain.on('window:hide', () => this.window?.hide());
    ipcMain.on('window:setSize', (_event, w: number, h: number) => this.window?.setSize(w, h));
    ipcMain.on('window:setMinSize', (_event, w: number, h: number) => this.window?.setMinimumSize(w, h));
    ipcMain.on('window:setMaxSize', (_event, w: number, h: number) => this.window?.setMaximumSize(w, h));
    ipcMain.on('window:center', () => this.window?.center());
    ipcMain.on('window:quit', () => process.exit(0));
  }

  private wirePty(id: string, proc: import('./pty.js').PtyProcess): void {
    this.ptyCleanups.get(id)?.();
    let exited = false;
    const onData = (data: string) => {
      getBus().emit(`session:${id}`, data);
      session.appendBuffer(id, data);
    };
    const onExit = (code: number) => {
      if (exited) return;
      exited = true;
      getLogger().info(`[app:wirePty] pty exited sid=${id} code=${code}`);
      getBus().emit(`session:${id}`, JSON.stringify({ type: 'done' }));
      this.setSessionState(id, 'done');
      const s = session.lookup(id);
      if (s) {
        s.process = null;
        s.state = 'done';
      }
      // 进程已退出，丢掉未提交的输入行缓存，避免 /exit 误判串到下一次会话
      this.inputLineBuffers.delete(id);
      this.ptyCleanups.delete(id);
    };
    proc.onData(onData);
    proc.onExit(onExit);
    this.ptyCleanups.set(id, () => {
      proc.onData(() => {});
      proc.onExit(() => {});
    });
  }

  private openTerminal(id: string, workDir: string, size: PtySize = { cols: 80, rows: 24 }): Promise<boolean> {
    if (!session.lookup(id)) session.register(session.newSession(id, workDir));
    const s = session.lookup(id)!;
    if (s.process) {
      getLogger().info(`[app:openSessionTerminal] pty already running for sid=${id}`);
      const buf = session.getBuffer(id);
      if (buf) {
        // 回放缓冲内容到前端，避免新 xterm 实例白屏等待
        getBus().emit(`session:${id}`, buf);
      }
      return Promise.resolve(true);
    }
    const upstream = resolveAnthropicBaseUrl();
    // PTY spawn 完成后立即 resolve，让前端隐藏 loading；proxy 启动失败不阻塞 PTY
    return new Promise<boolean>((resolvePty) => {
      startProxy(workDir, id, (env) => this.dispatcher.dispatch(env), undefined, upstream).then((proxy) => {
        this.apiProxies.push(proxy);
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
        // 历史 session 重启时 jsonl 可能还没创建（用户新建后没发 prompt 就关闭），
        // 三种 fallback 触发 PtyMode.New：
        // 1) 用户主动 /exit（terminated 标志）：claude 内部已拒绝 --resume
        // 2) jsonl 不存在（phantom session 重启场景）
        // 3) 否则默认 Resume
        const jsonlPath = jsonl.getSessionJsonlPath(id, workDir);
        const hasJsonl = fs.existsSync(jsonlPath);
        const isTerminated = getTerminatedFlag(id);
        const mode = (isTerminated || !hasJsonl) ? PtyMode.New : PtyMode.Resume;
        if (isTerminated) {
          getLogger().info(`[app:openSessionTerminal] sid=${id.slice(0, 8)} marked terminated, force PtyMode.New`);
          // 已用 New 模式拉起，标志就完成了使命：清掉，让后续 reconnect 走正常 Resume
          clearTerminatedFlag(id);
        } else if (!hasJsonl) {
          getLogger().warn(`[app:openSessionTerminal] jsonl missing for sid=${id} at ${jsonlPath}, fallback to PtyMode.New`);
        }
        getLogger().info(`[app:openSessionTerminal] proxyUrl=${proxyUrl} upstream=${upstream} sid=${id} mode=${mode}`);
        try {
          const claudeBin = (this.settingsStore.get('claude_path', '') as string) || 'claude';
          const proc = startPty(workDir, id, claudeBin, mode, {}, size, args);
          session.setProcess(id, proc, size);
          proc.onExit(() => cleanup());
          this.setSessionState(id, 'running');
          this.wirePty(id, proc);
          this.syncCloudSession(id, workDir);
          // 有 bot 绑定的会话启动后推送通知
          this.wecomChannel.sendSessionStarted(id, workDir);
          // PTY 已 spawn，立即通知前端隐藏 loading
          resolvePty(false);
        } catch (err: any) {
          getLogger().error(`[app:openSessionTerminal] startPty failed for sid=${id}: ${err.message}`);
          getBus().emit(`session:${id}`, `\r\n启动终端失败：${err.message}\r\n`);
          this.setSessionState(id, 'done');
          resolvePty(false);
        }
      }).catch((err: any) => {
        getLogger().error(`[app:openSessionTerminal] proxy failed for sid=${id}: ${err?.message ?? err}`);
        getBus().emit(`session:${id}`, `\r\n启动终端失败：${err?.message ?? err}\r\n`);
        this.setSessionState(id, 'done');
        // proxy 启动失败也 resolve，让前端能继续（终端内会显示错误）
        resolvePty(false);
      });
    });
  }
}
