export type HookType = 'shell' | 'python'

export interface HookEntry {
  matcher?: string
  command: string
  type: HookType
}

export interface HooksConfig {
  PreToolUse: HookEntry[]
  PermissionRequest: HookEntry[]
  PostToolUse: HookEntry[]
  Notification: HookEntry[]
  Stop: HookEntry[]
}
