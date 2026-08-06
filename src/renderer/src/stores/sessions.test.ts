// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'

// mock IPC 转发层，避免依赖 window.electronAPI
vi.mock('../composables/useElectron', () => ({
  CreateSession: vi.fn(),
  ListSessions: vi.fn().mockResolvedValue([]),
  SendMessage: vi.fn(),
  AdoptSession: vi.fn().mockResolvedValue(undefined),
  RenameSession: vi.fn(),
  BindSessionBot: vi.fn(),
  ListBots: vi.fn().mockResolvedValue([]),
  ListBotBindings: vi.fn().mockResolvedValue({}),
  GetRecentSessions: vi.fn().mockResolvedValue([]),
}))

import { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList } from './sessions'
import { GetRecentSessions } from '../composables/useElectron'
import { useSessionsStore } from './sessions'

describe('recentToMeta', () => {
  it('把 RecentSession 映射为 SessionMeta（毫秒时间戳转秒）', () => {
    const record: RecentSession = {
      sessionId: 'sid-1',
      workdir: '/proj',
      project: 'proj',
      aiTitle: 'AI 标题',
      firstPrompt: '第一条 prompt',
      lastOpenedAt: 1750000000000,
      state: 'idle',
    }
    const meta = recentToMeta(record)
    expect(meta).toEqual({
      id: 'sid-1',
      workdir: '/proj',
      project: 'proj',
      mtime: 1750000000,
      msg_count: 0,
      first_prompt: '第一条 prompt',
      ai_title: 'AI 标题',
      size: 0,
      user_title: undefined,
      title_source: 'ai',
    } satisfies SessionMeta)
  })

  it('userTitle 存在时 title_source 为 user，否则按 ai > first_prompt 推导', () => {
    const userRecord = recentToMeta({ sessionId: 'a', workdir: '/a', project: 'a', userTitle: '用户标题', aiTitle: 'AI', firstPrompt: 'FP', lastOpenedAt: 1000, state: 'idle' })
    expect(userRecord.title_source).toBe('user')
    expect(userRecord.user_title).toBe('用户标题')

    const fpRecord = recentToMeta({ sessionId: 'b', workdir: '/b', project: 'b', aiTitle: '', firstPrompt: '仅 prompt', lastOpenedAt: 1000, state: 'idle' })
    expect(fpRecord.title_source).toBe('first_prompt')
  })

  it('旧版秒级 lastOpenedAt 会被归一化为毫秒再换算', () => {
    // 注：补充 aiTitle/firstPrompt 必填字段以满足 RecentSession 类型（brief 原用例缺失）
    const meta = recentToMeta({ sessionId: 'c', workdir: '/c', project: 'c', aiTitle: '', firstPrompt: '', lastOpenedAt: 1750000000, state: 'idle' })
    expect(meta.mtime).toBe(1750000000) // 秒级 * 1000 再 /1000 还原
  })
})

describe('trimList', () => {
  const mk = (n: number): SessionMeta[] =>
    Array.from({ length: n }, (_, i) => ({ id: `s-${i}` } as unknown as SessionMeta))

  it('超过 MAX_SIDEBAR_SESSIONS 时裁剪到 30 条', () => {
    expect(trimList(mk(35)).length).toBe(MAX_SIDEBAR_SESSIONS)
    expect(trimList(mk(35))[0].id).toBe('s-0') // 保留头部（最新）
  })

  it('不足 30 条时原样返回', () => {
    const five = mk(5)
    expect(trimList(five)).toBe(five)
  })
})

describe('store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mkRecent(i: number, lastOpenedAt = 1750000000000 + i): RecentSession {
    return {
      sessionId: `s-${i}`,
      workdir: `/p${i}`,
      project: `p${i}`,
      aiTitle: `T${i}`,
      firstPrompt: '',
      lastOpenedAt,
      state: 'idle',
    }
  }

  it('initFromRecent 用最近会话填充列表（最新在前）', async () => {
    vi.mocked(GetRecentSessions).mockResolvedValueOnce([
      mkRecent(0, 2000),
      mkRecent(1, 1000),
    ])
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.map((s) => s.id)).toEqual(['s-0', 's-1'])
    expect(store.list[0].ai_title).toBe('T0')
  })

  it('initFromRecent 超过 30 条时裁剪', async () => {
    const recents = Array.from({ length: 35 }, (_, i) => mkRecent(i))
    vi.mocked(GetRecentSessions).mockResolvedValueOnce(recents)
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.length).toBe(MAX_SIDEBAR_SESSIONS)
    expect(store.list[0].id).toBe('s-34') // lastOpenedAt 最大者最新，排最前
  })

  it('initFromRecent 返回空数组时列表保持为空', async () => {
    vi.mocked(GetRecentSessions).mockResolvedValueOnce([])
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.length).toBe(0)
  })

  it('open 已满 30 条时插入头部并挤出最旧一条', () => {
    const store = useSessionsStore()
    for (let i = 0; i < 30; i++) store.open(mkRecent(i, 1000 + i))
    expect(store.list.length).toBe(30)
    store.open(mkRecent(99, 999999))
    expect(store.list.length).toBe(30)
    expect(store.list[0].id).toBe('s-99')
    expect(store.list.some((s) => s.id === 's-0')).toBe(false)
  })

  it('open 重复会话不重复插入', () => {
    const store = useSessionsStore()
    store.open(mkRecent(1, 1000))
    store.open(mkRecent(1, 2000))
    expect(store.list.filter((s) => s.id === 's-1').length).toBe(1)
  })
})
