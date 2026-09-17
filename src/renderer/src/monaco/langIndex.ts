// 文件路径 → Monaco 语言 id 的**纯匹配逻辑**。
//
// 刻意与 `setup.ts` 解耦（不 import 它）：setup 顶部有 `?worker` 形式的 Vite 资源
// import，在 node 环境下跑单测会炸。这里只做字符串匹配，可以直接单测。

/** 「扩展名 / 文件名 → 语言 id」索引，由调用方从 Monaco 的 getLanguages() 构建 */
export interface LangIndex {
  /** 扩展名（带点、小写）→ 语言 id */
  byExt: Map<string, string>
  /** 完整文件名（小写）→ 语言 id，用于 Dockerfile / Makefile 这类特殊文件 */
  byFile: Map<string, string>
}

/** Monaco 没注册、但项目里常见的后缀 → 借用的语言 id。
 *  例如 Monaco 没有 vue 语法，退回 html 至少能把标签和属性上色 ——
 *  这比直接掉到 plaintext（完全无高亮）好。Monaco 已注册的后缀不会走到这里。 */
const FALLBACK: Record<string, string> = {
  '.vue': 'html',
  '.svelte': 'html',
  '.astro': 'html',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
}

/** 匹配优先级：完整文件名 → 最长后缀 → 更短后缀 → 项目自定义回退。
 *  最长后缀优先是为了让 `foo.d.ts` 命中 '.d.ts' 而不是 '.ts'。 */
export function matchLanguage(idx: LangIndex, relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase()
  if (!base) return 'plaintext'

  const byName = idx.byFile.get(base)
  if (byName) return byName

  // 以点开头的文件（.gitignore）会让 indexOf 返回 0，此时 parts 就是 ['gitignore']，
  // 后续按 '.gitignore' 查表，逻辑与普通文件一致。
  const dot = base.indexOf('.')
  if (dot < 0) return 'plaintext'

  const parts = base.slice(dot + 1).split('.')
  for (let i = 0; i < parts.length; i++) {
    const suffix = `.${parts.slice(i).join('.')}`
    const hit = idx.byExt.get(suffix) ?? FALLBACK[suffix]
    if (hit) return hit
  }
  return 'plaintext'
}
