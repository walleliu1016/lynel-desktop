import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/** app:openTerminalPath 的返回值：渲染层据 kind 决定动作 */
export interface OpenTerminalPathResult {
  kind: 'workdir-file' | 'external' | 'none'
  relPath?: string
}

const api = {
  getAppInfo: () => ipcRenderer.invoke('app:getAppInfo'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('app:clipboardWrite', text),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  openTerminalPath: (workdir: string, rawPath: string) =>
    ipcRenderer.invoke('app:openTerminalPath', workdir, rawPath) as Promise<OpenTerminalPathResult>,
  loginWithToken: (userId: string, token: string, remember: boolean) =>
    ipcRenderer.invoke('app:loginWithToken', userId, token, remember),
  logout: () => ipcRenderer.invoke('app:logout'),
  authRestoreState: () => ipcRenderer.invoke('app:auth:restoreState'),
  listSessions: (workDir?: string) => ipcRenderer.invoke('app:listSessions', workDir),
  createSession: (workDir: string, prompt: string, extraArgs: string[] = [], agent?: string) =>
    ipcRenderer.invoke('app:createSession', workDir, prompt, extraArgs, agent),
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
  getFavorites: () => ipcRenderer.invoke('app:getFavorites'),
  addFavorite: (record: any) => ipcRenderer.invoke('app:addFavorite', record),
  removeFavorite: (sessionId: string) => ipcRenderer.invoke('app:removeFavorite', sessionId),
  getHookServerPort: () => ipcRenderer.invoke('app:getHookServerPort'),
  getSessionSettingsPath: (sessionId: string) => ipcRenderer.invoke('app:getSessionSettingsPath', sessionId),
  cloudConnectionState: () => ipcRenderer.invoke('app:cloud:connectionState'),
  listBots: () => ipcRenderer.invoke('app:listBots'),
  saveBot: (bot: any) => ipcRenderer.invoke('app:saveBot', bot),
  deleteBot: (id: string) => ipcRenderer.invoke('app:deleteBot', id),
  getBotThreshold: () => ipcRenderer.invoke('app:getBotThreshold'),
  setBotThreshold: (value: number) => ipcRenderer.invoke('app:setBotThreshold', value),
  bindSessionBot: (sessionId: string, botId: string | null) =>
    ipcRenderer.invoke('app:bindSessionBot', sessionId, botId),
  getSessionBotBinding: (sessionId: string) =>
    ipcRenderer.invoke('app:getSessionBotBinding', sessionId),
  getBotConnectionStatus: () => ipcRenderer.invoke('app:getBotConnectionStatus'),
  listBotBindings: () => ipcRenderer.invoke('app:listBotBindings'),
  startWecomScan: () => ipcRenderer.invoke('bot:startScan'),
  cancelWecomScan: () => ipcRenderer.invoke('bot:cancelScan'),
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
  openUpdateFolder: () => ipcRenderer.invoke('app:openUpdateFolder'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  getUpdateConfig: () => ipcRenderer.invoke('app:getUpdateConfig'),
  updateUpdateConfig: (cfg: any) => ipcRenderer.invoke('app:updateUpdateConfig', cfg),

  // DeepSeek Harness（dsh）
  dshEnsure: () => ipcRenderer.invoke('dsh:ensure'),
  dshShutdown: () => ipcRenderer.invoke('dsh:shutdown'),
  dshRestart: () => ipcRenderer.invoke('dsh:restart'),
  dshVersion: () => ipcRenderer.invoke('dsh:version'),
  dshUpdate: () => ipcRenderer.invoke('dsh:update'),

  // 右侧文件编辑器侧栏
  fileListDir: (workDir: string, relPath?: string) =>
    ipcRenderer.invoke('file:listDir', workDir, relPath),
  fileRead: (workDir: string, relPath: string) =>
    ipcRenderer.invoke('file:read', workDir, relPath),
  fileWrite: (workDir: string, relPath: string, content: string) =>
    ipcRenderer.invoke('file:write', workDir, relPath, content),
  fileCreate: (workDir: string, relPath: string, isDir: boolean) =>
    ipcRenderer.invoke('file:create', workDir, relPath, isDir),
  fileRename: (workDir: string, oldRel: string, newRel: string) =>
    ipcRenderer.invoke('file:rename', workDir, oldRel, newRel),
  fileDelete: (workDir: string, relPath: string) =>
    ipcRenderer.invoke('file:delete', workDir, relPath),
  fileWatch: (workDir: string) => ipcRenderer.invoke('file:watch', workDir),
  fileUnwatch: (workDir: string) => ipcRenderer.invoke('file:unwatch', workDir),

  shellEnsure: (sessionId: string, workDir: string, cols: number, rows: number) =>
    ipcRenderer.invoke('shell:ensure', sessionId, workDir, cols, rows),
  shellWrite: (sessionId: string, data: string) =>
    ipcRenderer.invoke('shell:write', sessionId, data),
  shellResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('shell:resize', sessionId, cols, rows),
  shellClose: (sessionId: string) => ipcRenderer.invoke('shell:close', sessionId),

  gitStatus: (workDir: string) => ipcRenderer.invoke('git:status', workDir),
  gitStage: (workDir: string, paths: string[]) => ipcRenderer.invoke('git:stage', workDir, paths),
  gitUnstage: (workDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:unstage', workDir, paths),
  gitDiscard: (workDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:discard', workDir, paths),
  gitCommit: (workDir: string, message: string) => ipcRenderer.invoke('git:commit', workDir, message),
  gitRemoteOp: (workDir: string, op: string) => ipcRenderer.invoke('git:remoteOp', workDir, op),
  gitFileAtRev: (workDir: string, rev: string, relPath: string) =>
    ipcRenderer.invoke('git:fileAtRev', workDir, rev, relPath),
  gitLogGraph: (workDir: string, max?: number) =>
    ipcRenderer.invoke('git:logGraph', workDir, max),
  gitCommitDetail: (workDir: string, hash: string) =>
    ipcRenderer.invoke('git:commitDetail', workDir, hash),
  gitBranchList: (workDir: string, includeRemote?: boolean) =>
    ipcRenderer.invoke('git:branchList', workDir, includeRemote),
  gitBranchCreate: (workDir: string, name: string, startPoint?: string) =>
    ipcRenderer.invoke('git:branchCreate', workDir, name, startPoint),
  gitBranchCheckout: (workDir: string, name: string) =>
    ipcRenderer.invoke('git:branchCheckout', workDir, name),
  gitBranchDelete: (workDir: string, name: string, force?: boolean) =>
    ipcRenderer.invoke('git:branchDelete', workDir, name, force),
  gitStashList: (workDir: string) => ipcRenderer.invoke('git:stashList', workDir),
  gitStashPush: (workDir: string, message?: string) =>
    ipcRenderer.invoke('git:stashPush', workDir, message),
  gitStashPop: (workDir: string, index?: number) =>
    ipcRenderer.invoke('git:stashPop', workDir, index),
  gitStashDrop: (workDir: string, index?: number) =>
    ipcRenderer.invoke('git:stashDrop', workDir, index),
  gitBlame: (workDir: string, relPath: string) =>
    ipcRenderer.invoke('git:blame', workDir, relPath),
  gitResetTo: (workDir: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    ipcRenderer.invoke('git:resetTo', workDir, hash, mode),
  gitWatch: (workDir: string) => ipcRenderer.invoke('git:watch', workDir),
  gitUnwatch: (workDir: string) => ipcRenderer.invoke('git:unwatch', workDir),

  // ---- 定时任务 ----
  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksGet: (id: string) => ipcRenderer.invoke('tasks:get', id),
  tasksCreate: (input: unknown) => ipcRenderer.invoke('tasks:create', input),
  tasksUpdate: (id: string, patch: unknown) => ipcRenderer.invoke('tasks:update', id, patch),
  tasksDelete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
  tasksSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('tasks:setEnabled', id, enabled),
  tasksRunNow: (id: string) => ipcRenderer.invoke('tasks:runNow', id),
  tasksCancel: (runId: string) => ipcRenderer.invoke('tasks:cancel', runId),
  tasksRuns: (taskId: string, opts: unknown) => ipcRenderer.invoke('tasks:runs', taskId, opts),
  tasksRun: (runId: string) => ipcRenderer.invoke('tasks:run', runId),
  tasksRunEvents: (runId: string, opts: unknown) => ipcRenderer.invoke('tasks:runEvents', runId, opts),
  tasksPreview: (schedule: unknown) => ipcRenderer.invoke('tasks:preview', schedule),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
