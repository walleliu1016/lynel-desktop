import { app, ipcMain, BrowserWindow, dialog } from 'electron';
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
import { makeHookEvent, ProxyStageKind, OutputChannel } from './channels/channel.js';
import { permissionBroker, PermissionRequest as BrokerPermissionRequest } from './permission-broker.js';
import { setNotchMousePassthrough, resizeNotchWindow, showNotchWindow, hideNotchWindow, getNotchWindow } from './notch-window.js';
import { startProxy } from './apiproxy.js';
import { start as startPty, PtyMode, PtySize } from './pty.js';

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

function mapHookToKind(name: string): ProxyStageKind | null {
  switch (name) {
    case 'SessionStart': return 'session_start';
    case 'SessionEnd': return 'SessionEnd';
    case 'UserPromptSubmit': return 'prompt';
    case 'Stop': return 'session_idle';
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
    case 'UserPromptSubmit':
      return { phase: 'thinking' };
    case 'Stop':
    case 'SessionEnd':
      return { phase: 'idle' };
    case 'Notification':
      return { phase: 'idle' };
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

export class App {
  private window: BrowserWindow | null = null;
  private settingsStore = getStore('settings');
  private instanceStore = getStore('instance');
  private providersStore = getStore('providers');
  private hookServer: HookServer | null = null;
  private dispatcher = new ChannelDispatcher();
  private sseChannel = new SSEChannel();
  private wecomChannel = new WeComChannel({ enabled: false });
  private localFileChannel = new LocalFileChannel();
  private stateChannel = new StateChannel({
    onStableState: (id, state, persist = true) => this.setSessionState(id, state, persist),
    onActivity: (id, activity) =>
      getBus().emit('sessions:activity', JSON.stringify({ sessionId: id, ...activity })),
  });
  // type → singleton 通道实例；与 settingsStore.channels 的 key 对齐（key === type）
  private channelInstances = new Map<string, OutputChannel>([
    ['wecom', this.wecomChannel],
    ['localfile', this.localFileChannel],
  ]);
  private ptyCleanups = new Map<string, (() => void) | null>();
  private recentSessionsLock = false;
  private aiTitleRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private apiProxies: import('./apiproxy.js').Proxy[] = [];
  private watchCleanup: (() => void) | null = null;

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
    this.dispatcher.register(this.localFileChannel);
    this.dispatcher.register(this.stateChannel);
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
    session.setOnRemove((id) => this.wecomChannel.clearSessionMappings(id));
    this.wecomChannel.setCreateSessionHandler(async () => {
      const projects = await jsonl.scanAll();
      const workDir = projects.length > 0 ? projects[0].workdir : process.cwd();
      try {
        const id = await this.createSessionInternal(workDir, '');
        return { id, workDir };
      } catch (err: any) {
        return { error: err.message };
      }
    });
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
    if (migrated) {
      this.settingsStore.set('channels', channels);
    }
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
          this.dispatcher.dispatch(makeHookEvent(kind, sid, workDir, evt));
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
        this.dispatcher.dispatch(makeHookEvent('PermissionRequest', sid, workDir, { ...req, seq }));
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
        this.dispatcher.dispatch(makeHookEvent('PermissionResolved', sessionId, workDir, { id, decision, source, toolName }));
      } catch {}
    });
    permissionBroker.onCancel((id) => {
      try {
        this.dispatcher.dispatch(makeHookEvent('PermissionResolved', '', '', { id, decision: 'deny', source: 'timeout' }));
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
      Notification: 120,
      PermissionRequest: 300,
      PreToolUse: 5,
      PostToolUse: 5,
      PostToolUseFailure: 5,
      PostCompact: 5,
      PreCompact: 5,
      SessionEnd: 5,
      Stop: 5,
      SubagentStart: 5,
      SubagentStop: 5,
      UserPromptSubmit: 5,
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

  private async createSessionInternal(workDir: string, prompt: string, extraArgs: string[] = []): Promise<string> {
    const realId = randomUUID();
    const upstream = resolveAnthropicBaseUrl();
    const proxy = await startProxy(workDir, realId, this.dispatcher, upstream);
    this.apiProxies.push(proxy);
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
    const allArgs = [...args, ...extraArgs];
    getLogger().info(`[app:createSession] proxyUrl=${proxyUrl} upstream=${upstream} workDir=${workDir} sessionId=${realId} extraArgs=${extraArgs.join(',')}`);
    const proc = startPty(workDir, realId, 'claude', PtyMode.New, {}, { cols: 80, rows: 24 }, allArgs);
    const s = session.newSession(realId, workDir);
    s.process = proc;
    s.state = 'running';
    session.register(s);
    this.setSessionState(realId, 'running');
    this.wirePty(realId, proc);
    proc.onExit(() => cleanup());

    getLogger().info(`[app:createSession] session created id=${realId} workDir=${workDir}`);
    if (prompt) session.send(realId, prompt);
    const project = workDir.split(/[\\/]/).filter(Boolean).pop() || workDir;
    await addRecentSession({
      sessionId: realId,
      workdir: workDir,
      project,
      aiTitle: '',
      firstPrompt: prompt,
      lastOpenedAt: Date.now(),
      state: 'running',
    });
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
      const notchEnabled = (cfg?.notch_enabled ?? true) as boolean;
      if (notchEnabled) {
        showNotchWindow();
      } else {
        hideNotchWindow();
      }
    });

    ipcMain.handle('app:getWeComConfig', () => {
      return this.settingsStore.get('wecom', { enabled: false }) as WeComChannelConfig;
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

    ipcMain.handle('app:testProviderConnection', async (_event, baseUrl: string, authToken: string) => {
      try {
        const url = baseUrl.replace(/\/+$/, '') + '/v1/messages';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': authToken,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6-20251101',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.text().catch(() => '');
        if (res.ok) return { ok: true };
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      } catch (err: any) {
        return { ok: false, error: err.message || String(err) };
      }
    });

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
      this.ptyCleanups.delete(id);
    };
    proc.onData(onData);
    proc.onExit(onExit);
    this.ptyCleanups.set(id, () => {
      proc.onData(() => {});
      proc.onExit(() => {});
    });
  }

  private openTerminal(id: string, workDir: string, size: PtySize = { cols: 80, rows: 24 }): void {
    if (!session.lookup(id)) session.register(session.newSession(id, workDir));
    const s = session.lookup(id)!;
    if (s.process) {
      getLogger().info(`[app:openSessionTerminal] pty already running for sid=${id}`);
      return;
    }
    const upstream = resolveAnthropicBaseUrl();
    startProxy(workDir, id, this.dispatcher, upstream).then((proxy) => {
      this.apiProxies.push(proxy);
      const proxyUrl = `http://127.0.0.1:${proxy.port}`;
      const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
      getLogger().info(`[app:openSessionTerminal] proxyUrl=${proxyUrl} upstream=${upstream} sid=${id}`);
      try {
        const proc = startPty(workDir, id, 'claude', PtyMode.Resume, {}, size, args);
        session.setProcess(id, proc);
        proc.onExit(() => cleanup());
        this.setSessionState(id, 'running');
        this.wirePty(id, proc);
      } catch (err: any) {
        getLogger().error(`[app:openSessionTerminal] startPty failed for sid=${id}: ${err.message}`);
        getBus().emit(`session:${id}`, `\r\n启动终端失败：${err.message}\r\n`);
        this.setSessionState(id, 'done');
      }
    }).catch((err: any) => {
      getLogger().error(`[app:openSessionTerminal] proxy failed for sid=${id}: ${err?.message ?? err}`);
      getBus().emit(`session:${id}`, `\r\n启动终端失败：${err?.message ?? err}\r\n`);
      this.setSessionState(id, 'done');
    });
  }
}
