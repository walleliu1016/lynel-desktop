// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'
import { ListSessions, AdoptSession, CreateSession } from '../composables/useElectron'

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
}))

import { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList } from './sessions'
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
      botId: 'bot-1',
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
      bot_id: 'bot-1',
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

describe('recentToMeta agent', () => {
  it('透传 agent', () => {
    const m = recentToMeta({ sessionId: 's', workdir: '/w', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle', agent: 'omp' })
    expect(m.agent).toBe('omp')
  })
  it('缺省 agent 为 undefined（前端回退 claude）', () => {
    const m = recentToMeta({ sessionId: 's', workdir: '/w', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' })
    expect(m.agent).toBeUndefined()
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

  it('重开已存在会话移到列表头部且长度不变', () => {
    const store = useSessionsStore()
    store.open(mkRecent(1, 1000))
    store.open(mkRecent(2, 2000))
    expect(store.list.map((s) => s.id)).toEqual(['s-2', 's-1'])
    // 重开 s-1（lastOpenedAt 更大），应移到列表头部
    store.open(mkRecent(1, 999999))
    expect(store.list.map((s) => s.id)).toEqual(['s-1', 's-2'])
    expect(store.list.length).toBe(2)
    // mtime 随最新 lastOpenedAt 更新（秒级归一化后再转秒）
    expect(store.list[0].mtime).toBe(999999)
  })

  it('refreshList 同步 user_title/msg_count 等权威字段，修复 resume 后标题陈旧', async () => {
    const store = useSessionsStore()
    await store.open(mkRecent(1, 1000))
    // 初始 item：mkRecent 仅提供 aiTitle，无 user_title
    expect(store.list[0].user_title).toBeUndefined()
    vi.mocked(ListSessions).mockResolvedValueOnce([
      {
        id: 's-1',
        workdir: '/p1',
        project: 'p1',
        mtime: 2000,
        msg_count: 7,
        first_prompt: '',
        ai_title: '',
        size: 100,
        user_title: '用户改名',
        title_source: 'user',
      },
    ] as any)
    await store.refreshList()
    expect(store.list[0].user_title).toBe('用户改名')
    expect(store.list[0].msg_count).toBe(7)
    expect(store.list[0].mtime).toBe(2000)
    expect(store.list[0].title_source).toBe('user')
    expect(store.list[0].ai_title).toBe('T1') // 权威 ai_title 为空时保留本地已有值
  })

  it('create 透传 agent 到 CreateSession，并用返回的归一化 workdir 写入列表', async () => {
    const store = useSessionsStore()
    vi.mocked(CreateSession).mockResolvedValue({ id: 's-new', workdir: '/real/dir' } as any)
    await store.create('', 'p', [], undefined, 'omp')
    expect(CreateSession).toHaveBeenCalledWith('', 'p', [], 'omp')
    expect(store.list[0].workdir).toBe('/real/dir')
    expect(store.list[0].project).toBe('dir')
    expect(store.activeId).toBe('s-new')
  })

  it('select 时 AdoptSession 抛错仍执行 refreshList，列表不保持陈旧', async () => {
    const store = useSessionsStore()
    await store.open(mkRecent(1, 1000))
    vi.mocked(AdoptSession).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(ListSessions).mockResolvedValueOnce([
      { id: 's-1', workdir: '/p1', project: 'p1', mtime: 2000, msg_count: 5, first_prompt: '', ai_title: '', size: 100 },
    ] as any)
    await store.select('s-1')
    expect(store.list[0].msg_count).toBe(5)
  })

  it('applyRebind 后列表仍不超过 MAX_SIDEBAR_SESSIONS', () => {
    const store = useSessionsStore()
    for (let i = 0; i < MAX_SIDEBAR_SESSIONS; i++) store.open(mkRecent(i, 1000 + i))
    expect(store.list.length).toBe(MAX_SIDEBAR_SESSIONS)
    store.applyRebind('s-29', 'rebound-1', '/newproj')
    expect(store.list.length).toBeLessThanOrEqual(MAX_SIDEBAR_SESSIONS)
    expect(store.list.some((s) => s.id === 'rebound-1')).toBe(true)
    expect(store.list.some((s) => s.id === 's-29')).toBe(false)
  })
})
