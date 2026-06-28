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
          RespondPermission: (id: string, reqId: string, allow: boolean) => Promise<void>
          CloseSession: (id: string) => Promise<void>
          GetSettings: () => Promise<any>
          UpdateSettings: (cfg: any) => Promise<void>
          GetHooksConfig: () => Promise<any>
          SaveHooksConfig: (cfg: any) => Promise<void>
          OpenInTerminal: (workdir: string, sessionId: string, binPath: string) => Promise<void>
          GetSessionMessages: (id: string, workdir: string, offset: number, limit: number) => Promise<Array<{Role: string; Content: string; Type: string}>>
          PickDirectory: () => Promise<string>
          GetHookServerPort: () => Promise<number>
          CheckAndFixHooks: () => Promise<boolean>
          GetSessionStates: () => Promise<Record<string, string>>
          SwitchOwner: (id: string, target: string, prompt: string) => Promise<void>
        }
      }
      main?: any
    }
    runtime?: {
      EventsOn: (event: string, cb: (...args: any[]) => void) => () => void
      EventsOff: (event: string) => void
      WindowMinimise: () => void
      WindowToggleMaximise: () => void
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

// Re-exported bindings
export const IsInitialized    = () => app().IsInitialized()
export const Verify           = (pw: string) => app().Verify(pw)
export const LockoutState     = () => app().LockoutState()
export const SetPassword      = (pw: string) => app().SetPassword(pw)
export const ClearPassword    = () => app().ClearPassword()
export const ListSessions     = () => app().ListSessions()
export const CreateSession    = (workdir: string, prompt: string) => app().CreateSession(workdir, prompt)
export const SendMessage      = (id: string, prompt: string) => app().SendMessage(id, prompt)
export const RespondPermission = (id: string, reqId: string, allow: boolean) => app().RespondPermission(id, reqId, allow)
export const CloseSession     = (id: string) => app().CloseSession(id)
export const GetSettings      = () => app().GetSettings()
export const UpdateSettings   = (cfg: any) => app().UpdateSettings(cfg)
export const GetHooksConfig   = () => app().GetHooksConfig()
export const SaveHooksConfig  = (cfg: any) => app().SaveHooksConfig(cfg)
export const OpenInTerminal   = (workdir: string, sessionId: string, binPath: string) => app().OpenInTerminal(workdir, sessionId, binPath)
export const GetSessionMessages = (id: string, workdir: string, offset: number, limit: number) => app().GetSessionMessages(id, workdir, offset, limit)
export const PickDirectory     = () => app().PickDirectory()
export const GetHookServerPort  = () => app().GetHookServerPort()
export const CheckAndFixHooks   = () => app().CheckAndFixHooks()
export const GetSessionStates  = () => app().GetSessionStates()
export const SwitchOwner       = (id: string, target: string, prompt: string) => app().SwitchOwner(id, target, prompt)

// runtime helpers
export const EventsOn           = (event: string, cb: (...args: any[]) => void) => runtime().EventsOn(event, cb)
export const WindowMinimise     = () => runtime().WindowMinimise()
export const WindowToggleMaximise = () => runtime().WindowToggleMaximise()
export const WindowQuit         = () => runtime().Quit()

export const isWailsDev = isDev
