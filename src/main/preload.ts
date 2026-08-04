import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const api = {
  getAppInfo: () => ipcRenderer.invoke('app:getAppInfo'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('app:clipboardWrite', text),
  loginWithToken: (userId: string, token: string) =>
    ipcRenderer.invoke('app:loginWithToken', userId, token),
  logout: () => ipcRenderer.invoke('app:logout'),
  listSessions: (workDir?: string) => ipcRenderer.invoke('app:listSessions', workDir),
  createSession: (workDir: string, prompt: string, extraArgs: string[] = []) =>
    ipcRenderer.invoke('app:createSession', workDir, prompt, extraArgs),
  sendMessage: (id: string, prompt: string) => ipcRenderer.invoke('app:sendMessage', id, prompt),
  closeSession: (id: string) => ipcRenderer.invoke('app:closeSession', id),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  updateSettings: (cfg: any) => ipcRenderer.invoke('app:updateSettings', cfg),
  updateCloudSettings: (enabled: boolean, url: string) =>
    ipcRenderer.invoke('app:cloud:updateSettings', enabled, url),
  getWeComConfig: () => ipcRenderer.invoke('app:getWeComConfig'),
  updateWeComConfig: (cfg: any) => ipcRenderer.invoke('app:updateWeComConfig', cfg),
  getChannelsConfig: () => ipcRenderer.invoke('app:getChannelsConfig'),
  updateChannelConfig: (id: string, cfg: any) => ipcRenderer.invoke('app:updateChannelConfig', id, cfg),
  deleteChannelConfig: (id: string) => ipcRenderer.invoke('app:deleteChannelConfig', id),
  getSessionMessages: (id: string, workDir: string, offset: number, limit: number) =>
    ipcRenderer.invoke('app:getSessionMessages', id, workDir, offset, limit),
  pickDirectory: () => ipcRenderer.invoke('app:pickDirectory'),
  getRecentSessions: () => ipcRenderer.invoke('app:getRecentSessions'),
  addRecentSession: (record: any) => ipcRenderer.invoke('app:addRecentSession', record),
  removeRecentSession: (sessionId: string) => ipcRenderer.invoke('app:removeRecentSession', sessionId),
  getHookServerPort: () => ipcRenderer.invoke('app:getHookServerPort'),
  getSessionSettingsPath: (sessionId: string) => ipcRenderer.invoke('app:getSessionSettingsPath', sessionId),
  cloudConnectionState: () => ipcRenderer.invoke('app:cloud:connectionState'),
  listBots: () => ipcRenderer.invoke('app:listBots'),
  saveBot: (bot: any) => ipcRenderer.invoke('app:saveBot', bot),
  deleteBot: (id: string) => ipcRenderer.invoke('app:deleteBot', id),
  bindSessionBot: (sessionId: string, botId: string | null) =>
    ipcRenderer.invoke('app:bindSessionBot', sessionId, botId),
  getSessionBotBinding: (sessionId: string) =>
    ipcRenderer.invoke('app:getSessionBotBinding', sessionId),
  getBotConnectionStatus: () => ipcRenderer.invoke('app:getBotConnectionStatus'),
  listBotBindings: () => ipcRenderer.invoke('app:listBotBindings'),
  setCurrentUser: (account: string) => ipcRenderer.invoke('app:setCurrentUser', account),
  getCurrentUser: () => ipcRenderer.invoke('app:getCurrentUser'),
  getSessionStates: () => ipcRenderer.invoke('app:getSessionStates'),
  adoptSession: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:adoptSession', id, workDir),
  renameSession: (id: string, workDir: string, title: string) =>
    ipcRenderer.invoke('app:renameSession', id, workDir, title),
  getSessionTitle: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:getSessionTitle', id, workDir),
  openSessionTerminal: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:openSessionTerminal', id, workDir),
  openSessionTerminalSized: (id: string, workDir: string, cols: number, rows: number) =>
    ipcRenderer.invoke('app:openSessionTerminalSized', id, workDir, cols, rows),
  writeTerminalInput: (id: string, data: string) =>
    ipcRenderer.invoke('app:writeTerminalInput', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('app:resizeTerminal', id, cols, rows),
  getProvidersConfig: () => ipcRenderer.invoke('app:getProvidersConfig'),
  saveProvidersConfig: (cfg: any) => ipcRenderer.invoke('app:saveProvidersConfig', cfg),
  applyActiveProvider: () => ipcRenderer.invoke('app:applyActiveProvider'),
  testProviderConnection: (baseUrl: string, authToken: string, defaultModel?: string) =>
    ipcRenderer.invoke('app:testProviderConnection', baseUrl, authToken, defaultModel),
  fetchProviderModels: (baseUrl: string, authToken: string) =>
    ipcRenderer.invoke('app:fetchProviderModels', baseUrl, authToken),

  resolvePermission: (id: string, decision: 'allow' | 'deny', source: string, answers?: Record<string, string | string[]>) =>
    ipcRenderer.invoke('permission:resolve', id, decision, source, answers),
  isPermissionPending: (id: string) => ipcRenderer.invoke('permission:isPending', id),

  eventsOn: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: IpcRendererEvent, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  windowMinimise: () => ipcRenderer.send('window:minimise'),
  windowMaximise: () => ipcRenderer.send('window:maximise'),
  windowUnmaximise: () => ipcRenderer.send('window:unmaximise'),
  windowUnminimise: () => ipcRenderer.send('window:unminimise'),
  windowToggleMaximise: () => ipcRenderer.send('window:toggleMaximise'),
  windowIsMaximised: () => ipcRenderer.invoke('window:isMaximised'),
  windowShow: () => ipcRenderer.send('window:show'),
  windowHide: () => ipcRenderer.send('window:hide'),
  windowSetSize: (width: number, height: number) =>
    ipcRenderer.send('window:setSize', width, height),
  windowSetMinSize: (width: number, height: number) =>
    ipcRenderer.send('window:setMinSize', width, height),
  windowSetMaxSize: (width: number, height: number) =>
    ipcRenderer.send('window:setMaxSize', width, height),
  windowCenter: () => ipcRenderer.send('window:center'),
  windowQuit: () => ipcRenderer.send('window:quit'),

  // trace: 完整 ccglass 式分析面板（v2 分页）
  listTraceSessions: (workDir: string) =>
    ipcRenderer.invoke('trace:listSessions', workDir),
  listTraceRequests: (workDir: string, sessionId: string, opts?: any) =>
    ipcRenderer.invoke('trace:listRequests', workDir, sessionId, opts),
  getTraceRequest: (workDir: string, sessionId: string, seq: number) =>
    ipcRenderer.invoke('trace:request', workDir, sessionId, seq),
  diffTraceRequests: (workDir: string, sessionId: string, seqA: number, seqB: number) =>
    ipcRenderer.invoke('trace:diff', workDir, sessionId, seqA, seqB),
  exportTraceRequest: (workDir: string, sessionId: string, seq: number, format: 'raw' | 'md' | 'json' | 'har') =>
    ipcRenderer.invoke('trace:export', workDir, sessionId, seq, format),
  watchTraceSession: (workDir: string, sessionId: string) =>
    ipcRenderer.invoke('trace:watch', workDir, sessionId),
  unwatchTraceSession: (workDir: string, sessionId: string) =>
    ipcRenderer.invoke('trace:unwatch', workDir, sessionId),

  // 在线升级
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: (info: any) => ipcRenderer.invoke('app:downloadUpdate', info),
  quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  getUpdateConfig: () => ipcRenderer.invoke('app:getUpdateConfig'),
  updateUpdateConfig: (cfg: any) => ipcRenderer.invoke('app:updateUpdateConfig', cfg),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
