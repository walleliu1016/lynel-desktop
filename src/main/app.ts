import { ipcMain, BrowserWindow, dialog } from 'electron';
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
  const tmpDir = path.join(os.tmpdir(), 'ease-ui');
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

export class App {
  private window: BrowserWindow | null = null;
  private settingsStore = getStore('settings');
  private instanceStore = getStore('instance');
  private providersStore = getStore('providers');
  private hookServer: HookServer | null = null;
  private dispatcher = new ChannelDispatcher();
  private sseChannel = new SSEChannel();
  private wecomChannel = new WeComChannel({ enabled: false });
  private ptyCleanups = new Map<string, (() => void) | null>();

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
    const bus = getBus();
    const originalEmit = bus.emit.bind(bus);
    bus.emit = (event: string | symbol, ...args: any[]) => {
      if (typeof event === 'string' && !this.window?.isDestroyed()) {
        this.window?.webContents.send(event, ...args);
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

  private recordFailedAttempt(): void {
    const attempts = ((this.settingsStore.get('lockout.attempts', 0) as number) ?? 0) + 1;
    this.settingsStore.set('lockout.attempts', attempts);
    if (attempts >= 5) {
      this.settingsStore.set('lockout.until', Date.now() + 5 * 60 * 1000);
      getLogger().warn('[app] lockout triggered: 5 failed attempts');
    }
  }

  async init(): Promise<void> {
    this.applyWeComConfig();
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
    this.registerIpcHandlers();
  }

  private applyWeComConfig(): void {
    const cfg = this.settingsStore.get('wecom', {}) as WeComChannelConfig;
    this.wecomChannel.updateConfig(cfg);
  }

  private async ensureHookServer(): Promise<void> {
    this.hookServer = new HookServer(this.sseChannel);
    this.hookServer.onEvent((evt) => {
      const sid = evt.session_id ?? '';
      const name = evt.hook_event_name ?? evt.type ?? '';
      getBus().emit(`hook:${sid}`, JSON.stringify(evt));
    });
    this.hookServer.onSend(async (sid, prompt) => {
      try {
        session.send(sid, prompt);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
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

  private async createSessionInternal(workDir: string, prompt: string): Promise<string> {
    const realId = randomUUID();
    const upstream = resolveAnthropicBaseUrl();
    const proxy = await startProxy(workDir, realId, this.dispatcher, upstream);
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
    getLogger().info(`[app:createSession] proxyUrl=${proxyUrl} upstream=${upstream} workDir=${workDir} sessionId=${realId}`);
    const proc = startPty(workDir, realId, 'claude', PtyMode.New, {}, { cols: 80, rows: 24 }, args);
    const s = session.newSession(realId, workDir);
    s.process = proc;
    s.state = 'running';
    session.register(s);
    this.instanceStore.set(`sessions.${realId}.state`, 'running');
    this.wirePty(realId, proc);
    proc.onExit(() => cleanup());

    getLogger().info(`[app:createSession] session created id=${realId} workDir=${workDir}`);
    if (prompt) session.send(realId, prompt);
    return realId;
  }

  private watchJsonl(): void {
    jsonl.watchProjects(() => {
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

    ipcMain.handle('app:listSessions', () => jsonl.scanAll());

    ipcMain.handle('app:getSessionMessages', (_event, id: string, workDir: string, offset: number, limit: number) => {
      const filePath = jsonl.getSessionJsonlPath(id, workDir);
      return jsonl.parseMessages(filePath, offset, limit);
    });

    ipcMain.handle('app:createSession', async (_event, workDir: string, prompt: string) => {
      return this.createSessionInternal(workDir, prompt);
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

    ipcMain.handle('app:getSettings', () => this.settingsStore.store);
    ipcMain.handle('app:updateSettings', (_event, cfg: any) => {
      this.settingsStore.set(cfg);
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
      if (!channels.wecom) {
        const legacy = this.settingsStore.get('wecom', null) as WeComChannelConfig | null;
        if (legacy) {
          channels.wecom = { enabled: legacy.enabled, chatId: legacy.chatId || '', botId: legacy.botId || '', secret: legacy.secret || '' };
          this.settingsStore.set('channels', channels);
          getLogger().info('[app] migrated legacy wecom config to channels');
        }
      }
      return channels;
    });

    ipcMain.handle('app:updateChannelConfig', (_event, id: string, config: any) => {
      const channels = (this.settingsStore.get('channels', {}) || {}) as Record<string, any>;
      channels[id] = config;
      this.settingsStore.set('channels', channels);
      if (id === 'wecom') {
        this.wecomChannel.updateConfig(config);
      }
      getLogger().info(`[app] channel config updated: ${id}`);
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

    ipcMain.handle('app:adoptSession', (_event, id: string, workDir: string) => {
      if (!session.lookup(id)) {
        session.register(session.newSession(id, workDir));
        getLogger().info(`[app:adoptSession] adopted sid=${id} workDir=${workDir}`);
      }
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

    ipcMain.handle('app:getHookServerPort', () => this.hookServer?.getPort() ?? 0);

    ipcMain.handle('app:getProvidersConfig', () => {
      const cfg = (this.providersStore.get('config', {}) as Record<string, any>) || {};
      if (!Array.isArray(cfg.providers)) {
        cfg.providers = [];
      }
      return cfg;
    });

    ipcMain.handle('app:saveProvidersConfig', (_event, cfg: Record<string, any>) => {
      this.providersStore.set('config', cfg);
    });

    ipcMain.handle('app:applyActiveProvider', () => {
      // TODO: 将当前供应商环境变量写入 Claude 配置
      return true;
    });

    ipcMain.handle('app:checkAndFixHooks', () => this.checkAndFixHooks());

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
      this.instanceStore.set(`sessions.${id}.state`, 'done');
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
      const proxyUrl = `http://127.0.0.1:${proxy.port}`;
      const { args, cleanup } = createSettingsOverrideFile(proxyUrl);
      getLogger().info(`[app:openSessionTerminal] proxyUrl=${proxyUrl} upstream=${upstream} sid=${id}`);
      try {
        const proc = startPty(workDir, id, 'claude', PtyMode.Resume, {}, size, args);
        session.setProcess(id, proc);
        proc.onExit(() => cleanup());
        this.instanceStore.set(`sessions.${id}.state`, 'running');
        this.wirePty(id, proc);
      } catch (err: any) {
        getLogger().error(`[app:openSessionTerminal] startPty failed for sid=${id}: ${err.message}`);
        getBus().emit(`session:${id}`, `\r\n启动终端失败：${err.message}\r\n`);
        this.instanceStore.set(`sessions.${id}.state`, 'done');
      }
    }).catch((err: any) => {
      getLogger().error(`[app:openSessionTerminal] proxy failed for sid=${id}: ${err?.message ?? err}`);
      getBus().emit(`session:${id}`, `\r\n启动终端失败：${err?.message ?? err}\r\n`);
      this.instanceStore.set(`sessions.${id}.state`, 'done');
    });
  }
}
