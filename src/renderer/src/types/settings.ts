export type Theme = 'dark-pro' | 'light-pro'

/**
 * 终端配色预设。终端配色与 UI 主题解耦：
 * UI 主题控制窗口/侧栏/卡片外观，终端配色只影响 xterm 内部。
 * 预设 id 在 theme.css 中以 `[data-term-theme="<id>"]` 形式定义。
 */
export type TerminalTheme =
  | 'default-dark'
  | 'solarized-dark'
  | 'one-half-dark'
  | 'gruvbox-dark'
  | 'monokai'
  | 'dracula'
  | 'solarized-light'
  | 'warm-light'

export type TerminalCursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalConfig {
  /** 终端配色预设 */
  theme: TerminalTheme
  /** 字体族（已用 CSS font-family 串，含 fallback） */
  fontFamily: string
  /** 字号 px，10-24 */
  fontSize: number
  /** 行高倍率，1.0-2.0 */
  lineHeight: number
  /** 光标样式 */
  cursorStyle: TerminalCursorStyle
  /** 光标是否闪烁 */
  cursorBlink: boolean
  /** 回滚行数 */
  scrollback: number
}

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
  terminal: TerminalConfig
}

export const DEFAULT_TERMINAL_FONT = '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace'

export function defaultTerminalConfig(): TerminalConfig {
  return {
    theme: 'default-dark',
    fontFamily: DEFAULT_TERMINAL_FONT,
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 1000,
  }
}
