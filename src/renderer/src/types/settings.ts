export type Theme = 'dark-pro' | 'light-pro'

export interface Settings {
  theme: Theme
  claude_path: string
  auto_allow_bash: boolean
  log_enabled: boolean
  auto_lock_minutes: number
  auto_start: boolean
  minimize_on_start: boolean
  notch_enabled: boolean
  cloud_service_enabled: boolean
  cloud_service_url: string
  cloud_service_token: string
  push_thinking: boolean
  push_tool_calls: boolean
  prevent_sleep: boolean
}
