import { describe, it, expect } from 'vitest'
import { matchLanguage, type LangIndex } from './langIndex'

/** 建测试用索引。刻意不加载真的 Monaco —— 匹配逻辑本来就与它解耦 */
function idx(exts: Record<string, string>, files: Record<string, string> = {}): LangIndex {
  return {
    byExt: new Map(Object.entries(exts)),
    byFile: new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v])),
  }
}

describe('matchLanguage', () => {
  const index = idx(
    {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.d.ts': 'typescript',
      '.json': 'json',
      '.py': 'python',
    },
    { Dockerfile: 'dockerfile' },
  )

  it('按扩展名命中', () => {
    expect(matchLanguage(index, 'src/main/app.ts')).toBe('typescript')
    expect(matchLanguage(index, 'a/b/c.py')).toBe('python')
  })

  it('不区分大小写', () => {
    expect(matchLanguage(index, 'README.TS')).toBe('typescript')
    expect(matchLanguage(index, 'Dockerfile')).toBe('dockerfile')
  })

  it('最长后缀优先：api.d.ts 命中 .d.ts 而不是 .ts', () => {
    const i = idx({ '.ts': 'shorter', '.d.ts': 'longer' })
    expect(matchLanguage(i, 'types/api.d.ts')).toBe('longer')
  })

  it('复合后缀里的更短后缀仍能命中：a.test.ts → .ts', () => {
    expect(matchLanguage(index, 'a.test.ts')).toBe('typescript')
  })

  it('按完整文件名命中（Dockerfile 这类没有扩展名）', () => {
    expect(matchLanguage(index, 'path/to/Dockerfile')).toBe('dockerfile')
  })

  it('以点开头的文件也能查表', () => {
    expect(matchLanguage(idx({ '.gitignore': 'ini' }), '.gitignore')).toBe('ini')
  })

  it('认不出时返回 plaintext', () => {
    expect(matchLanguage(index, 'notes.unknownext')).toBe('plaintext')
    expect(matchLanguage(index, 'noextension')).toBe('plaintext')
    expect(matchLanguage(index, '')).toBe('plaintext')
  })

  it('Monaco 没注册的后缀走项目自定义回退（.vue → html）', () => {
    expect(matchLanguage(idx({}), 'App.vue')).toBe('html')
    expect(matchLanguage(idx({}), 'a/b/Comp.svelte')).toBe('html')
  })

  it('索引里有就优先用索引，而不是回退', () => {
    expect(matchLanguage(idx({ '.vue': 'custom-vue' }), 'App.vue')).toBe('custom-vue')
  })
})
