import { ipcMain, BrowserWindow, dialog } from 'electron';
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
import { startProxy, newCallID } from './apiproxy.js';
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
  const settings = JSON.stringify({ env: { ANTHROPIC_BASE_URL: proxyUrl } }, null, 2);
  const tmpDir = path.join(os.tmpdir(), 'ease-ui');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `claude-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmpFile, settings, 'utf8');
    getLogger().info(`[app] created settings override: ${tmpFile}`);
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

function sessionStartScriptUnix(hookURL: string): string {
  return `#!/bin/bash
# Ease UI SessionStart hook
INPUT=$(cat)
curl -s -X POST ${hookURL} \\
  -H "Content-Type: application/json" \\
  -d "$INPUT" \\
  > /dev/null 2>&1
`;
}

function sessionStartScriptWin(hookURL: string): string {
  return `<#
.SYNOPSIS
    Ease UI SessionStart hook
.DESCRIPTION
    Forwards session start event to Ease UI HTTP server with user account header
#>

$headers = @{
    "Content-Type" = "application/json"
    "X-UM-ACCOUNT" = "$env:USERNAME"
}

$jsonInput = $null
try {
    $jsonInput = [System.Console]::In.ReadToEnd()
} catch {
}
if (-not $jsonInput) {
    $jsonInput = '{"hook_event_name":"SessionStart"}'
}

try {
    Invoke-RestMethod -Uri "${hookURL}" -Method POST -Headers $headers -Body $jsonInput -ErrorAction SilentlyContinue | Out-Null
} catch {
}
`;
}

function ensureSessionStartScript(hookURL: string): string | null {
  const easeDir = path.join(os.homedir(), '.ease-app');
  try {
    fs.mkdirSync(easeDir, { recursive: true });
    if (process.platform === 'win32') {
      const scriptPath = path.join(easeDir, 'session-start.ps1');
      fs.writeFileSync(scriptPath, sessionStartScriptWin(hookURL), 'utf8');
      getLogger().info(`[app] SessionStart script created: ${scriptPath}`);
      return 'powershell -NoProfile -ExecutionPolicy Bypass -Command . $HOME/.ease-app/session-start.ps1';
    }
    const scriptPath = path.join(easeDir, 'session-start.sh');
    fs.writeFileSync(scriptPath, sessionStartScriptUnix(hookURL), { mode: 0o755 });
    getLogger().info(`[app] SessionStart script created: ${scriptPath}`);
    return '~/.ease-app/session-start.sh';
  } catch (err: any) {
    getLogger().error(`[app] failed to create SessionStart script: ${err.message}`);
    return null;
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
  private pendingSession: { resolve: (id: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  private ptyCleanups = new Map<string, (() => void) | null>();

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
  }

  private registerPending(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingSession) {
        getLogger().warn('[app] replacing stale pending session registration');
        this.pendingSession.reject(new Error('new session creation started'));
        clearTimeout(this.pendingSession.timer);
      }
      const timer = setTimeout(() => {
        this.pendingSession = null;
        getLogger().error('[app] SessionStart timeout: no hook response in 15s');
        reject(new Error('session start timeout (15s)'));
      }, 15000);
      this.pendingSession = { resolve, reject, timer };
    });
  }

  private deliverSessionID(realId: string): void {
    const pending = this.pendingSession;
    if (!pending) {
      getLogger().warn(`[app] received SessionStart id=${realId} but no pending registration`);
      return;
    }
    clearTimeout(pending.timer);
    this.pendingSession = null;
    getLogger().info(`[app] SessionStart delivered: id=${realId}`);
    pending.resolve(realId);
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
      if (name === 'SessionStart' && sid) {
        this.deliverSessionID(sid);
      }
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

    const scriptCommand = ensureSessionStartScript(hookURL);
    if (!scriptCommand) {
      getLogger().warn('[app] SessionStart script unavailable, hooks config will not include SessionStart');
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

    if (scriptCommand) {
      hooksObj['SessionStart'] = [
        { matcher: '', hooks: [{ type: 'command', command: scriptCommand, timeout: 5 }] },
      ];
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
      const token = newCallID();
      const upstream = resolveAnthropicBaseUrl();
      const proxy = await startProxy(workDir, token, this.dispatcher, upstream);
      const proxyUrl = `http://127.0.0.1:${proxy.port}`;
      const env = { ANTHROPIC_BASE_URL: proxyUrl };
      const { args: extraArgs, cleanup: settingsCleanup } = createSettingsOverrideFile(proxyUrl);
      getLogger().info(`[app:createSession] proxyUrl=${proxyUrl} upstream=${upstream} workDir=${workDir}`);
      const proc = startPty(workDir, '', 'claude', PtyMode.Auto, env, { cols: 80, rows: 24 }, extraArgs);
      proc.onExit(settingsCleanup);
      const tmpId = `tmp-${proc.pid}`;
      const s = session.newSession(tmpId, workDir);
      session.register(s);
      session.setProcess(tmpId, proc);

      let realId: string;
      try {
        realId = await this.registerPending();
      } catch (err: any) {
        proc.kill();
        session.remove(tmpId);
        getLogger().error(`[app:createSession] timeout waiting for SessionStart, workDir=${workDir}: ${err?.message ?? err}`);
        throw new Error('Claude 未在 15 秒内返回会话 ID，请检查 SessionStart hook 配置');
      }
      proxy.setSessionID(realId);
      session.remove(tmpId);
      const realSession = session.newSession(realId, workDir);
      realSession.process = proc;
      realSession.state = 'running';
      session.register(realSession);
      this.instanceStore.set(`sessions.${realId}.state`, 'running');
      this.wirePty(realId, proc);

      getLogger().info(`[app:createSession] session created id=${realId} workDir=${workDir}`);
      if (prompt) session.send(realId, prompt);
      return realId;
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
    const token = newCallID();
    const upstream = resolveAnthropicBaseUrl();
    startProxy(workDir, token, this.dispatcher, upstream).then((proxy) => {
      proxy.setSessionID(id);
      const proxyUrl = `http://127.0.0.1:${proxy.port}`;
      const env = { ANTHROPIC_BASE_URL: proxyUrl };
      const { args: extraArgs, cleanup: settingsCleanup } = createSettingsOverrideFile(proxyUrl);
      getLogger().info(`[app:openSessionTerminal] proxyUrl=${proxyUrl} upstream=${upstream} sid=${id}`);
      try {
        const proc = startPty(workDir, id, 'claude', PtyMode.Resume, env, size, extraArgs);
        proc.onExit(settingsCleanup);
        session.setProcess(id, proc);
        this.instanceStore.set(`sessions.${id}.state`, 'running');
        this.wirePty(id, proc);
      } catch (err: any) {
        getLogger().error(`[app:openSessionTerminal] startPty failed for sid=${id}: ${err.message}`);
        getBus().emit(`session:${id}`, `\r\n启动终端失败：${err.message}\r\n`);
        this.instanceStore.set(`sessions.${id}.state`, 'done');
        settingsCleanup();
      }
    }).catch((err: any) => {
      getLogger().error(`[app:openSessionTerminal] proxy failed for sid=${id}: ${err?.message ?? err}`);
      getBus().emit(`session:${id}`, `\r\n启动终端失败：${err?.message ?? err}\r\n`);
      this.instanceStore.set(`sessions.${id}.state`, 'done');
    });
  }
}
