// TextMate 语法高亮：把 Monaco 内置的 Monarch tokenizer 换成 vscode-textmate。
//
// 为什么只对少数语言启用：Monaco 自带 70+ 语言的 Monarch 语法，对大多数语言够用；
// 而 textmate 是逐行拿 oniguruma 正则扫的，比 Monarch 慢。所以这里只覆盖
// Monarch 明显不足（markdown 不做围栏代码块里的嵌套高亮）或压根没有的语言。
//
// 语法文件取自 VSCode 仓库（MIT），放在 ./syntaxes/ 下，用动态 import 按需加载
// —— 没打开过对应语言的文件就不会加载那部分 chunk。

import * as oniguruma from 'vscode-oniguruma'
import * as vsctm from 'vscode-textmate'
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url'
import type { Monaco } from './setup'

interface GrammarEntry {
  /** tmLanguage 里的 scopeName */
  scope: string
  /** 动态 import 语法 JSON */
  load: () => Promise<unknown>
}

const GRAMMARS: Record<string, GrammarEntry> = {
  markdown: {
    scope: 'text.html.markdown',
    load: () => import('./syntaxes/markdown.tmLanguage.json'),
  },
  yaml: {
    scope: 'source.yaml',
    load: () => import('./syntaxes/yaml.tmLanguage.json'),
  },
  ini: {
    scope: 'source.ini',
    load: () => import('./syntaxes/ini.tmLanguage.json'),
  },
}

let onigReady: Promise<void> | null = null
let registry: vsctm.Registry | null = null
/** 已装过 token provider 的语言，避免重复安装 */
const installed = new Set<string>()

function ensureOniguruma(): Promise<void> {
  if (!onigReady) {
    onigReady = (async () => {
      const res = await fetch(onigWasmUrl)
      if (!res.ok) throw new Error(`onig.wasm 加载失败: HTTP ${res.status}`)
      await oniguruma.loadWASM(await res.arrayBuffer())
    })()
  }
  return onigReady
}

function ensureRegistry(): vsctm.Registry {
  if (!registry) {
    registry = new vsctm.Registry({
      onigLib: ensureOniguruma().then(() => ({
        createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s: string) => new oniguruma.OnigString(s),
      })),
      loadGrammar: async (scopeName: string) => {
        const entry = Object.values(GRAMMARS).find((g) => g.scope === scopeName)
        if (!entry) return null
        const mod = (await entry.load()) as { default?: unknown }
        // 动态 import JSON 在不同打包器下可能给 default 包裹，两种都兼容
        const raw = mod.default ?? mod
        return vsctm.parseRawGrammar(JSON.stringify(raw), `${scopeName}.json`)
      },
    })
  }
  return registry
}

/** 给指定语言装上 TextMate tokenizer。
 *
 *  不在白名单、已经装过、或加载失败时都是 no-op —— 调用方无需自行判断。
 *  失败会静默退回 Monarch（高亮粗一点，但不影响可用性）。 */
export async function installTextMate(monaco: Monaco, languageId: string): Promise<void> {
  const entry = GRAMMARS[languageId]
  if (!entry || installed.has(languageId)) return
  installed.add(languageId)
  try {
    const grammar = await ensureRegistry().loadGrammar(entry.scope)
    if (!grammar) {
      installed.delete(languageId)
      return
    }
    monaco.languages.setTokensProvider(languageId, {
      getInitialState: () => vsctm.INITIAL,
      tokenize: (line: string, state: vsctm.StateStack) => {
        const r = grammar.tokenizeLine(line, state)
        return {
          // Monaco 的 IToken.scopes 要求空格分隔的字符串，textmate 给的是数组
          tokens: r.tokens.map((t) => ({ startIndex: t.startIndex, scopes: t.scopes.join(' ') })),
          endState: r.ruleStack,
        }
      },
    })
  } catch (err) {
    // 撤销登记，下次打开还能再试（例如 wasm 那次是网络抖动）
    installed.delete(languageId)
    console.warn(`[textmate] ${languageId} 安装失败，继续用 Monarch:`, err)
  }
}

/** 仅测试用：清掉安装登记与缓存 */
export function __resetTextMate(): void {
  installed.clear()
  registry = null
  onigReady = null
}
