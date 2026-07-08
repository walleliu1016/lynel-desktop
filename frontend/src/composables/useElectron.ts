import type { ElectronAPI } from '../../../electron/preload.js';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function api(): ElectronAPI {
  if (!window.electronAPI) throw new Error('Electron API not available');
  return window.electronAPI;
}

export const IsInitialized = () => api().isInitialized();
export const Verify = (pw: string) => api().verify(pw);
export const LockoutState = () => api().lockoutState();
export const SetPassword = (pw: string) => api().setPassword(pw);
export const ClearPassword = () => api().clearPassword();
export const ListSessions = () => api().listSessions();
export const CreateSession = (workDir: string, prompt: string) => api().createSession(workDir, prompt);
export const SendMessage = (id: string, prompt: string) => api().sendMessage(id, prompt);
export const CloseSession = (id: string) => api().closeSession(id);
export const GetSettings = () => api().getSettings();
export const UpdateSettings = (cfg: any) => api().updateSettings(cfg);
export const GetWeComConfig = () => api().getWeComConfig();
export const UpdateWeComConfig = (cfg: any) => api().updateWeComConfig(cfg);
export const GetHooksConfig = () => api().getHooksConfig();
export const SaveHooksConfig = (cfg: any) => api().saveHooksConfig(cfg);
export const GetSessionMessages = (id: string, workDir: string, offset: number, limit: number) => api().getSessionMessages(id, workDir, offset, limit);
export const GetToolExecutions = (id: string, workDir: string) => api().getToolExecutions(id, workDir);
export const PickDirectory = () => api().pickDirectory();
export const GetHookServerPort = () => api().getHookServerPort();
export const CheckAndFixHooks = () => api().checkAndFixHooks();
export const GetSessionStates = () => api().getSessionStates();
export const AdoptSession = (id: string, workDir: string) => api().adoptSession(id, workDir);
export const OpenSessionTerminal = (id: string, workDir: string) => api().openSessionTerminal(id, workDir);
export const OpenSessionTerminalSized = (id: string, workDir: string, cols: number, rows: number) => api().openSessionTerminalSized(id, workDir, cols, rows);
export const WriteTerminalInput = (id: string, data: string) => api().writeTerminalInput(id, data);
export const ResizeTerminal = (id: string, cols: number, rows: number) => api().resizeTerminal(id, cols, rows);
export const GetProvidersConfig = () => api().getProvidersConfig();
export const SaveProvidersConfig = (cfg: any) => api().saveProvidersConfig(cfg);
export const ApplyActiveProvider = () => api().applyActiveProvider();

export const EventsOn = (channel: string, cb: (...args: any[]) => void) => api().eventsOn(channel, cb);

export const WindowMinimise = () => api().windowMinimise();
export const WindowMaximise = () => api().windowMaximise();
export const WindowUnmaximise = () => api().windowUnmaximise();
export const WindowUnminimise = () => api().windowUnminimise();
export const WindowToggleMaximise = () => api().windowToggleMaximise();
export const WindowIsMaximised = () => api().windowIsMaximised();
export const WindowShow = () => api().windowShow();
export const WindowHide = () => api().windowHide();
export const WindowSetSize = (w: number, h: number) => api().windowSetSize(w, h);
export const WindowSetMinSize = (w: number, h: number) => api().windowSetMinSize(w, h);
export const WindowSetMaxSize = (w: number, h: number) => api().windowSetMaxSize(w, h);
export const WindowCenter = () => api().windowCenter();
export const WindowQuit = () => api().windowQuit();

export const isElectronDev = import.meta.env.DEV;
