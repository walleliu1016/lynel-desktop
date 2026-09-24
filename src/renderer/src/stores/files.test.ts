// 验证分屏展开态：openInSplit 打开文件并展开右栏；展开态按会话记忆
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFilesStore } from './files'

vi.mock('../composables/useElectron', () => ({
  FileListDir: vi.fn(() => Promise.resolve([])),
  FileRead: vi.fn((_wd: string, rel: string) =>
    Promise.resolve({ content: `// ${rel}`, binary: false, truncated: false })),
  FileWrite: vi.fn(() => Promise.resolve({ ok: true })),
  FileCreate: vi.fn(() => Promise.resolve({ ok: true })),
  FileRename: vi.fn(() => Promise.resolve({ ok: true })),
  FileDelete: vi.fn(() => Promise.resolve({ ok: true })),
  FileWatch: vi.fn(() => Promise.resolve()),
  FileUnwatch: vi.fn(() => Promise.resolve()),
  FileChanged: vi.fn(() => vi.fn()),
}))

describe('files store · 分屏展开态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认不展开', () => {
    expect(useFilesStore().splitOpen).toBe(false)
  })

  it('openInSplit 打开文件并展开右栏', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    expect(store.splitOpen).toBe(true)
    expect(store.activeRelPath).toBe('src/main/app.ts')
    expect(store.openFiles.map((f) => f.relPath)).toEqual(['src/main/app.ts'])
  })

  it('切走再切回恢复该会话的展开态', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    await store.setSession('s2', '/other')
    expect(store.splitOpen).toBe(false)
    await store.setSession('s1', '/repo')
    expect(store.splitOpen).toBe(true)
    expect(store.activeRelPath).toBe('src/main/app.ts')
  })

  it('展开态但没有任何打开文件时不恢复展开（避免空右栏）', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    store.closeFile('src/main/app.ts')
    await store.setSession('s2', '/other')
    await store.setSession('s1', '/repo')
    expect(store.splitOpen).toBe(false)
  })
})

describe('files store · 文件树折叠态按会话记忆', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('首次进入默认展开文件树', async () => {
    const store = useFilesStore()
    expect(store.collapsed).toBe(false)
    store.collapsed = true // 模拟进过别的地方被折叠
    await store.setSession('s1', '/repo')
    expect(store.collapsed).toBe(false)
  })

  it('折叠树后切走再切回，恢复该会话的折叠状态', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    store.collapsed = true
    await store.setSession('s2', '/other')
    // 无现场的新会话：默认展开，不继承上一个会话的折叠残留
    expect(store.collapsed).toBe(false)
    await store.setSession('s1', '/repo')
    expect(store.collapsed).toBe(true)
  })

  it('同一会话内折叠后切到别的会话再切回仍记住折叠（splitOpen 守卫不影响它）', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    store.collapsed = true
    await store.setSession('s2', '/other')
    await store.setSession('s1', '/repo')
    expect(store.collapsed).toBe(true)
    // 恢复展开后树仍折叠 = 以用户上一次状态为准
    store.splitOpen = true
    expect(store.collapsed).toBe(true)
  })
})
