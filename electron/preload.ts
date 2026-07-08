import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const api = {
  isInitialized: () => ipcRenderer.invoke('app:isInitialized'),
  verify: (pw: string) => ipcRenderer.invoke('app:verify', pw),
  lockoutState: () => ipcRenderer.invoke('app:lockoutState'),
  setPassword: (pw: string) => ipcRenderer.invoke('app:setPassword', pw),
  clearPassword: () => ipcRenderer.invoke('app:clearPassword'),
  listSessions: () => ipcRenderer.invoke('app:listSessions'),
  createSession: (workDir: string, prompt: string) =>
    ipcRenderer.invoke('app:createSession', workDir, prompt),
  sendMessage: (id: string, prompt: string) => ipcRenderer.invoke('app:sendMessage', id, prompt),
  closeSession: (id: string) => ipcRenderer.invoke('app:closeSession', id),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  updateSettings: (cfg: any) => ipcRenderer.invoke('app:updateSettings', cfg),
  getWeComConfig: () => ipcRenderer.invoke('app:getWeComConfig'),
  updateWeComConfig: (cfg: any) => ipcRenderer.invoke('app:updateWeComConfig', cfg),
  getHooksConfig: () => ipcRenderer.invoke('app:getHooksConfig'),
  saveHooksConfig: (cfg: any) => ipcRenderer.invoke('app:saveHooksConfig', cfg),
  getSessionMessages: (id: string, workDir: string, offset: number, limit: number) =>
    ipcRenderer.invoke('app:getSessionMessages', id, workDir, offset, limit),
  getToolExecutions: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:getToolExecutions', id, workDir),
  pickDirectory: () => ipcRenderer.invoke('app:pickDirectory'),
  getHookServerPort: () => ipcRenderer.invoke('app:getHookServerPort'),
  checkAndFixHooks: () => ipcRenderer.invoke('app:checkAndFixHooks'),
  getSessionStates: () => ipcRenderer.invoke('app:getSessionStates'),
  adoptSession: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:adoptSession', id, workDir),
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
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
