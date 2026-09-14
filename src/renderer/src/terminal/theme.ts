// 终端主题工具：从 CSS 变量（html 上的 --term-*）读取颜色构建 xterm theme 对象。
// XtermTerminal.vue（Claude 会话终端）与 ProjectTerminal.vue（项目终端）共用同一份实现，
// 保证两个终端的配色永远一致。
import type { Terminal } from '@xterm/xterm'
import type { TerminalTheme } from '../types/settings'

/** 一次 getComputedStyle 内读全部 xterm 主题变量，合并多次 layout 为 1 次 */
export const THEME_VARS = [
  ['background', '--term-bg'],
  ['foreground', '--term-fg'],
  ['cursor', '--term-cursor'],
  ['cursorAccent', '--term-cursor-accent'],
  ['selectionBackground', '--term-selection'],
  ['selectionForeground', '--term-fg'],
  ['selectionInactiveBackground', '--term-selection'],
  ['black', '--term-black'],
  ['red', '--term-red'],
  ['green', '--term-green'],
  ['yellow', '--term-yellow'],
  ['blue', '--term-blue'],
  ['magenta', '--term-magenta'],
  ['cyan', '--term-cyan'],
  ['white', '--term-white'],
  ['brightBlack', '--term-bright-black'],
  ['brightRed', '--term-bright-red'],
  ['brightGreen', '--term-bright-green'],
  ['brightYellow', '--term-bright-yellow'],
  ['brightBlue', '--term-bright-blue'],
  ['brightMagenta', '--term-bright-magenta'],
  ['brightCyan', '--term-bright-cyan'],
  ['brightWhite', '--term-bright-white'],
] as const

/**
 * 同步应用 theme：setAttribute data-term-theme + 一次 getComputedStyle 读全部主题变量。
 * 给 init（同步用）和 scheduleThemeSync（rAF 内用）共用，避免两处重复实现。
 */
export function applyThemeSync(theme: TerminalTheme): Record<string, string> {
  document.documentElement.setAttribute('data-term-theme', theme)
  const style = getComputedStyle(document.documentElement)
  const themeObj: Record<string, string> = {}
  for (const [key, varName] of THEME_VARS) {
    themeObj[key] = style.getPropertyValue(varName).trim() || '#000'
  }
  return themeObj
}

/** 等待指定字体可用。否则 fitAddon 测出来的 char width 是回退字体的，会算出错误的 cols/rows */
export async function waitForFontReady(family: string, size: number): Promise<void> {
  if (!document.fonts?.load) return
  // 解析 font-family 字符串，取第一个引号名作为优先字体
  const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (!first || first === 'monospace') return
  try {
    await document.fonts.load(`${size}px ${first}`)
  } catch {
    // 字体加载失败也不阻塞终端初始化，用回退字体也能用
  }
}

/** rAF 节流：按 Terminal 实例分片，合并同一帧内的多次 theme 同步。
 *  不能只用一个 pending 槽：多个 XtermTerminal 会同时挂载（HomeView 用
 *  v-for + v-show），单槽会让先到的实例被后到的覆盖，只有最后一个终端换色。
 *  用 WeakMap 按实例分片，各实例都拿到更新；同一实例在一帧内的多次调用仍被合并，
 *  避免快速点击触发连续 22 次 reflow。 */
const pendingThemeSync = new WeakMap<Terminal, TerminalTheme>()
let pendingTerminals: Terminal[] = []
let themeSyncRaf = 0
export function scheduleThemeSync(t: Terminal, theme: TerminalTheme) {
  pendingThemeSync.set(t, theme)
  if (!pendingTerminals.includes(t)) pendingTerminals.push(t)
  if (themeSyncRaf) return
  themeSyncRaf = requestAnimationFrame(() => {
    themeSyncRaf = 0
    const list = pendingTerminals
    pendingTerminals = []
    for (const term of list) {
      const th = pendingThemeSync.get(term)
      if (!th) continue
      pendingThemeSync.delete(term)
      try {
        term.options.theme = applyThemeSync(th) as any
        // xterm 不会自动用新 theme 重绘已有 buffer；必须显式 refresh 才能让已显示的字符换色
        term.refresh(0, term.rows - 1)
      } catch {
        // 实例可能已在同一帧内被销毁，跳过
      }
    }
  })
}
