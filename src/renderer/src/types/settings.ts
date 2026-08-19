import type { BuddyEye, BuddyHat, BuddyRarity } from '../data/buddies/types'

export type Theme = 'light' | 'dark' | 'system'

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
  codex_path: string
  opencode_path: string
  omp_path: string
  codex_enabled: boolean
  opencode_enabled: boolean
  omp_enabled: boolean
  log_enabled: boolean
  auto_lock_minutes: number
  auto_start: boolean
  minimize_on_start: boolean
  cloud_service_enabled: boolean
  cloud_service_url: string
  push_thinking: boolean
  push_tool_calls: boolean
  prevent_sleep: boolean
  terminal: TerminalConfig
  /** 是否启用 ASCII 电子宠物（buddy） */
  buddyEnabled: boolean
  /** buddy 物种 ID */
  buddyRoleId: string
  /** 眼睛字符 */
  buddyEye: BuddyEye
  /** 帽子 id */
  buddyHat: BuddyHat
  /** 是否 shiny（金色 + 光晕） */
  buddyShiny: boolean
  /** 稀有度（null = 使用物种固有稀有度） */
  buddyRarity: BuddyRarity | null
  /** 3D hover 倾斜角度（0 = 关闭 3D 旋转） */
  buddy3DTilt: number
  /** 呼吸浮动幅度 px（0 = 静止） */
  buddyFloatAmp: number
  /** 自定义 ASCII 宠物内容 */
  buddyCustomAscii: string
}

export const DEFAULT_TERMINAL_FONT = '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace'

export function defaultTerminalConfig(): TerminalConfig {
  return {
    theme: 'default-dark',
    fontFamily: DEFAULT_TERMINAL_FONT,
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: 'bar',
    cursorBlink: true,
    scrollback: 1000,
  }
}
