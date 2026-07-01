// Wails runtime is exposed at window.runtime in dev. We declare a small typed
// surface so the rest of the app does not depend on `any`.
//
// In `wails dev` and the production build, bindings and runtime are added
// automatically by Wails. The functions below mirror `internal/app` methods.

declare global {
  interface Window {
    go?: {
      app: {
        App: {
          IsInitialized: () => Promise<boolean>
          Verify: (pw: string) => Promise<void>
          LockoutState: () => Promise<[number, string]>
          SetPassword: (pw: string) => Promise<void>
          ClearPassword: () => Promise<void>
          ListSessions: () => Promise<any[]>
          CreateSession: (workdir: string, prompt: string) => Promise<string>
          SendMessage: (id: string, prompt: string) => Promise<void>
          RespondHookPermission: (reqId: string, decision: any) => Promise<void>
          CloseSession: (id: string) => Promise<void>
          GetSettings: () => Promise<any>
          UpdateSettings: (cfg: any) => Promise<void>
          GetHooksConfig: () => Promise<any>
          SaveHooksConfig: (cfg: any) => Promise<void>
          OpenInTerminal: (workdir: string, sessionId: string, binPath: string) => Promise<void>
          GetSessionMessages: (id: string, workdir: string, offset: number, limit: number) => Promise<Array<{Role: string; Content: string; Type: string; Timestamp: number}>>
          GetToolExecutions: (id: string, workdir: string) => Promise<Array<{ id: string; kind: string; name: string; startedAt: number; endedAt: number; durationMs: number; status: string; input: string; output: string; exitCode: number }>>
          PickDirectory: () => Promise<string>
          GetHookServerPort: () => Promise<number>
          CheckAndFixHooks: () => Promise<boolean>
          GetSessionStates: () => Promise<Record<string, string>>
          SwitchOwner: (id: string, target: string, prompt: string) => Promise<void>
          AdoptSession: (id: string, workDir: string) => Promise<void>
          GetProvidersConfig: () => Promise<import('../types/providers').ProvidersConfig>
          SaveProvidersConfig: (cfg: import('../types/providers').ProvidersConfig) => Promise<void>
          ApplyActiveProvider: () => Promise<void>
        }
      }
      main?: any
    }
    runtime?: {
      EventsOn: (event: string, cb: (...args: any[]) => void) => () => void
      EventsOff: (event: string) => void
      WindowMinimise: () => void
      WindowMaximise: () => void
      WindowUnmaximise: () => void
      WindowUnminimise: () => void
      WindowToggleMaximise: () => void
      WindowIsMaximised: () => Promise<boolean>
      WindowIsMinimised: () => Promise<boolean>
      WindowShow: () => void
      WindowHide: () => void
      WindowSetSize: (width: number, height: number) => void
      WindowSetMinSize: (width: number, height: number) => void
      WindowSetMaxSize: (width: number, height: number) => void
      WindowSetAlwaysOnTop: (b: boolean) => void
      WindowCenter: () => void
      Quit: () => void
    }
  }
}

const isDev = import.meta.env.DEV

function app() {
  if (!window.go?.app?.App) throw new Error('Wails bindings not available (need wails dev or build)')
  return window.go.app.App
}

function runtime() {
  if (!window.runtime) throw new Error('Wails runtime not available')
  return window.runtime
}

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

/**
 * 安全地重置窗口尺寸约束并居中。
 *
 * Wails runtime 的同步调用在内部是异步提交到主线程的；如果连续调用
 * SetMinSize / SetMaxSize / SetSize / Center，后一个调用可能基于旧的
 * 约束/尺寸计算，导致窗口先被旧 minSize 限制、再被新 minSize 撑大，
 * 出现分阶段放大或居中不准。这里用显式延迟把调用阶段隔开。
 */
export async function ResetAndResizeWindow(
  width: number,
  height: number,
  minWidth: number = 0,
  minHeight: number = 0,
  maxWidth: number = 0,
  maxHeight: number = 0
) {
  const rt = runtime()
  rt.WindowSetMinSize(0, 0)
  rt.WindowSetMaxSize(0, 0)
  await delay(60)
  rt.WindowSetSize(width, height)
  await delay(80)
  if (minWidth > 0 && minHeight > 0) rt.WindowSetMinSize(minWidth, minHeight)
  if (maxWidth > 0 && maxHeight > 0) rt.WindowSetMaxSize(maxWidth, maxHeight)
  await delay(60)
  rt.WindowCenter()
}

// Re-exported bindings
export const IsInitialized    = () => app().IsInitialized()
export const Verify           = (pw: string) => app().Verify(pw)
export const LockoutState     = () => app().LockoutState()
export const SetPassword      = (pw: string) => app().SetPassword(pw)
export const ClearPassword    = () => app().ClearPassword()
export const ListSessions     = () => app().ListSessions()
export const CreateSession    = (workdir: string, prompt: string) => app().CreateSession(workdir, prompt)
export const SendMessage      = (id: string, prompt: string) => app().SendMessage(id, prompt)
export const RespondHookPermission = (reqId: string, decision: any) => app().RespondHookPermission(reqId, decision)
export const CloseSession     = (id: string) => app().CloseSession(id)
export const GetSettings      = () => app().GetSettings()
export const UpdateSettings   = (cfg: any) => app().UpdateSettings(cfg)
export const GetHooksConfig   = () => app().GetHooksConfig()
export const SaveHooksConfig  = (cfg: any) => app().SaveHooksConfig(cfg)
export const OpenInTerminal   = (workdir: string, sessionId: string, binPath: string) => app().OpenInTerminal(workdir, sessionId, binPath)
export const GetSessionMessages = (id: string, workdir: string, offset: number, limit: number) => app().GetSessionMessages(id, workdir, offset, limit)
export const GetToolExecutions  = (id: string, workdir: string) => app().GetToolExecutions(id, workdir)
export const PickDirectory      = () => app().PickDirectory()
export const GetHookServerPort  = () => app().GetHookServerPort()
export const CheckAndFixHooks   = () => app().CheckAndFixHooks()
export const GetSessionStates  = () => app().GetSessionStates()
export const SwitchOwner       = (id: string, target: string, prompt: string) => app().SwitchOwner(id, target, prompt)
export const AdoptSession      = (id: string, workDir: string) => app().AdoptSession(id, workDir)
export const GetProvidersConfig = () => app().GetProvidersConfig()
export const SaveProvidersConfig = (cfg: import('../types/providers').ProvidersConfig) => app().SaveProvidersConfig(cfg)
export const ApplyActiveProvider = () => app().ApplyActiveProvider()

// runtime helpers
export const EventsOn           = (event: string, cb: (...args: any[]) => void) => runtime().EventsOn(event, cb)
export const WindowMinimise     = () => runtime().WindowMinimise()
export const WindowMaximise     = () => runtime().WindowMaximise()
export const WindowUnmaximise   = () => runtime().WindowUnmaximise()
export const WindowUnminimise   = () => runtime().WindowUnminimise()
export const WindowToggleMaximise = () => runtime().WindowToggleMaximise()
export const WindowIsMaximised  = () => runtime().WindowIsMaximised()
export const WindowIsMinimised  = () => runtime().WindowIsMinimised()
export const WindowShow         = () => runtime().WindowShow()
export const WindowHide         = () => runtime().WindowHide()
export const WindowSetSize      = (width: number, height: number) => runtime().WindowSetSize(width, height)
export const WindowSetMinSize   = (width: number, height: number) => runtime().WindowSetMinSize(width, height)
export const WindowSetMaxSize   = (width: number, height: number) => runtime().WindowSetMaxSize(width, height)
export const WindowSetAlwaysOnTop = (b: boolean) => runtime().WindowSetAlwaysOnTop(b)
export const WindowCenter       = () => runtime().WindowCenter()
export const WindowQuit         = () => runtime().Quit()

export const isWailsDev = isDev
