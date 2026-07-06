import { ipcMain, BrowserWindow, dialog } from 'electron';
import { getStore } from './store.js';
import { getBus } from './events.js';
import { getLogger } from './log.js';
import * as auth from './auth.js';
import * as jsonl from './jsonl.js';
import * as session from './session.js';
import { HookServer } from './hookserver.js';
import { ChannelDispatcher } from './channels/registry.js';
import { SSEChannel } from './channels/sse-channel.js';
import { WeComChannel } from './channels/wecom-channel.js';
import { startProxy, newCallID } from './apiproxy.js';
import { start as startPty, PtyMode, PtySize } from './pty.js';

export class App {
  private window: BrowserWindow | null = null;
  private settingsStore = getStore('settings');
  private instanceStore = getStore('instance');
  private hookServer: HookServer | null = null;
  private dispatcher = new ChannelDispatcher();
  private sseChannel = new SSEChannel();
  private wecomChannel = new WeComChannel({ enabled: false });
  private pendingSession: { resolve: (id: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
  }

  private registerPending(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingSession) {
        this.pendingSession.reject(new Error('new session creation started'));
        clearTimeout(this.pendingSession.timer);
      }
      const timer = setTimeout(() => {
        this.pendingSession = null;
        reject(new Error('session start timeout (15s)'));
      }, 15000);
      this.pendingSession = { resolve, reject, timer };
    });
  }

  private deliverSessionID(realId: string): void {
    const pending = this.pendingSession;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSession = null;
    pending.resolve(realId);
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  async init(): Promise<void> {
    await this.ensureHookServer();
    this.watchJsonl();
    this.registerIpcHandlers();
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
    await this.hookServer.start();
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

    ipcMain.handle('app:verify', (_event, pw: string) => {
      const hash = this.settingsStore.get('auth.hash', '') as string;
      return auth.verifyPassword(hash, pw);
    });

    ipcMain.handle('app:setPassword', (_event, pw: string) => {
      return auth.hashPassword(pw).then((hash) => {
        this.settingsStore.set('auth.hash', hash);
      });
    });

    ipcMain.handle('app:clearPassword', () => {
      this.settingsStore.set('auth.hash', '');
    });

    ipcMain.handle('app:listSessions', () => jsonl.scanAll());

    ipcMain.handle('app:createSession', async (_event, workDir: string, prompt: string) => {
      const token = newCallID();
      const proxy = await startProxy(workDir, token, this.dispatcher);
      const env = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` };
      const proc = startPty(workDir, '', 'claude', PtyMode.Auto, env);
      const tmpId = `tmp-${proc.pid}`;
      const s = session.newSession(tmpId, workDir);
      session.register(s);
      session.setProcess(tmpId, proc);

      const realId = await this.registerPending();
      proxy.setSessionID(realId);
      // migrate tmp session to real id
      session.remove(tmpId);
      const realSession = session.newSession(realId, workDir);
      realSession.process = proc;
      realSession.state = 'running';
      session.register(realSession);
      this.instanceStore.set(`sessions.${realId}.state`, 'running');

      if (prompt) session.send(realId, prompt);
      return realId;
    });

    ipcMain.handle('app:sendMessage', (_event, id: string, prompt: string) => {
      session.send(id, prompt);
    });

    ipcMain.handle('app:closeSession', (_event, id: string) => {
      session.close(id);
    });

    ipcMain.handle('app:getSettings', () => this.settingsStore.store);
    ipcMain.handle('app:updateSettings', (_event, cfg: any) => {
      this.settingsStore.set(cfg);
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

  private openTerminal(id: string, workDir: string, size: PtySize = { cols: 80, rows: 24 }): void {
    if (!session.lookup(id)) session.register(session.newSession(id, workDir));
    const s = session.lookup(id)!;
    if (s.process) return;
    const token = newCallID();
    startProxy(workDir, token, this.dispatcher).then((proxy) => {
      proxy.setSessionID(id);
      const env = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` };
      const proc = startPty(workDir, id, 'claude', PtyMode.Resume, env, size);
      session.setProcess(id, proc);
    });
  }
}
