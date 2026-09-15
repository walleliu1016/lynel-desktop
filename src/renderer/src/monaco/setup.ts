// Monaco 共享初始化 / 主题构建模块。
// 编辑器（CodeEditor.vue）与 diff 视图（CodeDiffView.vue）共用同一份实例与主题逻辑。
// 注意：self.MonacoEnvironment 是全局一次性设置，必须在这里统一初始化，
// 否则后挂载的 Monaco 实例（如 diff 视图单独打开时）拿不到 worker，语言功能会失效。

// 注意：monaco-editor 0.56 的 exports 映射为 "./*" -> "./esm/vs/*.js"，会在 `*` 前拼接 esm/vs 前缀。
// Vite 8（Rolldown）严格按 exports 解析，`monaco-editor/esm/vs/...` 会被解析成不存在的 `esm/vs/esm/vs/...` 而报错。
// 因此这里去掉 `esm/vs` 前缀，让 `*` 捕获 `editor/editor.worker`，解析到 `./esm/vs/editor/editor.worker.js`。
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

export type Monaco = typeof import('monaco-editor')

// 懒加载单例：monaco 模块只在首次需要时 import，全局共享同一份实例
let monacoModule: Monaco | null = null

/** 读 CSS 变量值（html 上全局 --term-*）。未定义时回退黑色，避免 Monaco 报非法色值 */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000'
}

/** 当前终端主题 id：优先 data-term-theme 属性，缺省回退 default-dark */
export function currentThemeId(): string {
  return document.documentElement.getAttribute('data-term-theme') || 'default-dark'
}

/** 由 --term-* 构建 Monaco 主题（运行时读 CSS，单一色源）。返回主题名。 */
export function buildMonacoTheme(monaco: Monaco, themeId: string): string {
  const themeName = `code-${themeId}`
  const fg = cssVar('--term-fg')
  const bg = cssVar('--term-bg')
  const selection = cssVar('--term-selection')
  const cursor = cssVar('--term-cursor')
  const brightBlack = cssVar('--term-bright-black')
  // 亮色终端（solarized-light / warm-light）用浅色 base，保证未映射 token 有足够对比度
  const base = themeId === 'solarized-light' || themeId === 'warm-light' ? 'vs' : 'vs-dark'
  monaco.editor.defineTheme(themeName, {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: brightBlack },
      { token: 'keyword', foreground: cssVar('--term-magenta') },
      { token: 'string', foreground: cssVar('--term-green') },
      { token: 'number', foreground: cssVar('--term-yellow') },
      { token: 'type', foreground: cssVar('--term-blue') },
      { token: 'identifier', foreground: fg },
      { token: 'function', foreground: cssVar('--term-cyan') },
      { token: 'delimiter.bracket', foreground: cssVar('--term-magenta') },
      { token: 'operator', foreground: cssVar('--term-red') },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': brightBlack,
      'editor.selectionBackground': selection,
      'editorCursor.foreground': cursor,
    },
  })
  return themeName
}

/** 应用终端主题：先把 data-term-theme 同步为目标主题（幂等，与 XtermTerminal 同源），
 *  再 getComputedStyle 读新色值构建 Monaco 主题。返回主题名，由调用方决定是否应用到 live 编辑器。
 *  theme 由调用方从 settings.cfg.terminal.theme 取；未加载时回退 currentThemeId()。 */
export function applyMonacoTheme(monaco: Monaco, theme: string): string {
  document.documentElement.setAttribute('data-term-theme', theme)
  return buildMonacoTheme(monaco, theme)
}

export async function ensureMonaco(): Promise<Monaco | null> {
  if (monacoModule) return monacoModule
  const m = await import('monaco-editor')
  self.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
  monacoModule = m
  return m
}
