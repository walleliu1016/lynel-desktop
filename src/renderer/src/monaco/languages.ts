// 文件路径 → Monaco 语言 id（带 Monaco 索引构建）。
//
// 索引直接从 `monaco.languages.getLanguages()` 构建，不手写映射表：手写的既覆盖不全
// （原先只有 10 条扩展名），又会随 Monaco 升级漂移，而且原先 CodeEditor 与
// CodeDiffView 各写了一份，已经漂移过一次（diff 那份漏了 yaml）。
// Monaco 自带 70+ 语言的 Monarch 语法，把路径正确映射过去就能白拿这些高亮。
//
// 纯匹配逻辑在 `langIndex.ts`，这里只负责构建索引与缓存。

import { ensureMonaco, type Monaco } from './setup'
import { matchLanguage, type LangIndex } from './langIndex'

let index: LangIndex | null = null

function buildIndex(monaco: Monaco): LangIndex {
  const byExt = new Map<string, string>()
  const byFile = new Map<string, string>()
  for (const lang of monaco.languages.getLanguages()) {
    // 注意：Monaco 的 extensions 自带前导点（'.ts'），不要重复拼
    for (const ext of lang.extensions ?? []) byExt.set(ext.toLowerCase(), lang.id)
    for (const name of lang.filenames ?? []) byFile.set(name.toLowerCase(), lang.id)
  }
  return { byExt, byFile }
}

/** 推断文件应使用的 Monaco 语言 id；认不出时返回 'plaintext'。 */
export async function languageForPath(relPath: string): Promise<string> {
  const monaco = await ensureMonaco()
  if (!monaco) return 'plaintext'
  if (!index) index = buildIndex(monaco)
  return matchLanguage(index, relPath)
}
