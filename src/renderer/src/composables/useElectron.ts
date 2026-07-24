import type { ElectronAPI } from '../../../main/preload.js';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function api(): ElectronAPI {
  if (!window.electronAPI) throw new Error('Electron API not available');
  return window.electronAPI;
}

export const GetAppInfo = () => api().getAppInfo();
export const ClipboardWrite = (text: string) => api().clipboardWrite(text);
export const IsInitialized = () => api().isInitialized();
export const Verify = (pw: string) => api().verify(pw);
export const LockoutState = () => api().lockoutState();
export const SetPassword = (pw: string) => api().setPassword(pw);
export const ClearPassword = () => api().clearPassword();
export const ListSessions = (workDir?: string) => api().listSessions(workDir);
export const CreateSession = (workDir: string, prompt: string, extraArgs: string[] = []) => api().createSession(workDir, prompt, extraArgs);
export const SendMessage = (id: string, prompt: string) => api().sendMessage(id, prompt);
export const CloseSession = (id: string) => api().closeSession(id);
export const GetSettings = () => api().getSettings();
export const UpdateSettings = (cfg: any) => api().updateSettings(cfg);
export const GetWeComConfig = () => api().getWeComConfig();
export const UpdateWeComConfig = (cfg: any) => api().updateWeComConfig(cfg);
export const GetChannelsConfig = () => api().getChannelsConfig();
export const UpdateChannelConfig = (id: string, cfg: any) => api().updateChannelConfig(id, cfg);
export const DeleteChannelConfig = (id: string) => api().deleteChannelConfig(id);
export const GetSessionMessages = (id: string, workDir: string, offset: number, limit: number) => api().getSessionMessages(id, workDir, offset, limit);
export const PickDirectory = () => api().pickDirectory();
export const GetRecentSessions = () => api().getRecentSessions();
export const AddRecentSession = (record: any) => api().addRecentSession(record);
export const RemoveRecentSession = (sessionId: string) => api().removeRecentSession(sessionId);
export const GetHookServerPort = () => api().getHookServerPort();
export const CheckAndFixHooks = () => api().checkAndFixHooks();
export const ListBots = () => api().listBots();
export const SaveBot = (bot: any) => api().saveBot(bot);
export const DeleteBot = (id: string) => api().deleteBot(id);
export const BindSessionBot = (sessionId: string, botId: string | null) => api().bindSessionBot(sessionId, botId);
export const GetSessionBotBinding = (sessionId: string) => api().getSessionBotBinding(sessionId);
export const GetBotConnectionStatus = () => api().getBotConnectionStatus();
export const ListBotBindings = () => api().listBotBindings();
export const SetCurrentUser = (account: string) => api().setCurrentUser(account);
export const GetCurrentUser = () => api().getCurrentUser();
export const GetSessionStates = () => api().getSessionStates();
export const AdoptSession = (id: string, workDir: string) => api().adoptSession(id, workDir);
export const RenameSession = (id: string, workDir: string, title: string) => api().renameSession(id, workDir, title);
export const GetSessionTitle = (id: string, workDir: string) => api().getSessionTitle(id, workDir);
export const OpenSessionTerminal = (id: string, workDir: string) => api().openSessionTerminal(id, workDir);
export const OpenSessionTerminalSized = (id: string, workDir: string, cols: number, rows: number) => api().openSessionTerminalSized(id, workDir, cols, rows);
export const WriteTerminalInput = (id: string, data: string) => api().writeTerminalInput(id, data);
export const ResizeTerminal = (id: string, cols: number, rows: number) => api().resizeTerminal(id, cols, rows);
export const GetProvidersConfig = () => api().getProvidersConfig();
export const SaveProvidersConfig = (cfg: any) => api().saveProvidersConfig(cfg);
export const ApplyActiveProvider = () => api().applyActiveProvider();
export const TestProviderConnection = (baseUrl: string, authToken: string, defaultModel?: string) => api().testProviderConnection(baseUrl, authToken, defaultModel);
export const FetchProviderModels = (baseUrl: string, authToken: string) => api().fetchProviderModels(baseUrl, authToken);

export const ResolvePermission = (id: string, decision: 'allow' | 'deny', source: string, answers?: Record<string, string | string[]>) => api().resolvePermission(id, decision, source, answers);
export const IsPermissionPending = (id: string) => api().isPermissionPending(id);

export const SetNotchPassthrough = (passthrough: boolean) => api().setNotchPassthrough(passthrough);
export const SetNotchSize = (w: number, h: number) => api().setNotchSize(w, h);
export const SetNotchVisibility = (visible: boolean) => api().setNotchVisibility(visible);

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

// trace / cost 面板
export const ListTraceSessions = (workDir: string) => api().listTraceSessions(workDir);
export const ListTraceRequests = (workDir: string, sessionId: string, modelFilter?: string) =>
  api().listTraceRequests(workDir, sessionId, modelFilter);
export const GetSessionTraceStats = (workDir: string, sessionId: string, modelFilter?: string) =>
  api().getSessionTraceStats(workDir, sessionId, modelFilter);
export const GetTraceRequest = (workDir: string, sessionId: string, seq: number) =>
  api().getTraceRequest(workDir, sessionId, seq);
export const DiffTraceRequests = (workDir: string, sessionId: string, seqA: number, seqB: number) =>
  api().diffTraceRequests(workDir, sessionId, seqA, seqB);
export const GetUsageSummary = () => api().getUsageSummary();
export const ExportTraceRequest = (workDir: string, sessionId: string, seq: number, format: 'raw' | 'md' | 'json' | 'har') =>
  api().exportTraceRequest(workDir, sessionId, seq, format);
export const ListHappyEnvelopes = (workDir: string, sessionId: string) =>
  api().listHappyEnvelopes(workDir, sessionId);
export const WatchTraceSession = (workDir: string, sessionId: string) =>
  api().watchTraceSession(workDir, sessionId);
export const UnwatchTraceSession = (workDir: string, sessionId: string) =>
  api().unwatchTraceSession(workDir, sessionId);

export const isElectronDev = import.meta.env.DEV;
