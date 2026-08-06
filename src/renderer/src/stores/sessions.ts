import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, SessionState } from '../types/session'
import type { RecentSession } from '../types/recent'
import { CreateSession, ListSessions, SendMessage, AdoptSession, RenameSession, BindSessionBot, ListBots, ListBotBindings } from '../composables/useElectron'

export interface HookPermissionRequest {
  id: string
  sessionId: string
  toolName: string
  toolInput: any
}

function omit<T extends Record<string, any>>(obj: T, key: string): T {
  const { [key]: _, ...rest } = obj
  return rest as T
}

// lastOpenedAt 可能被旧代码写成秒级时间戳，统一归一化为毫秒
function normalizeLastOpenedAt(v: number | undefined): number {
  if (!v || v <= 0) return Date.now()
  // 秒级时间戳 < 1e10（约 2286 年），毫秒级 > 1e12
  return v < 10_000_000_000 ? v * 1000 : v
}

const MAX_SIDEBAR_SESSIONS = 30

/** RecentSession → SessionMeta 映射（供 open 复用）。 */
function recentToMeta(record: RecentSession): SessionMeta {
  const source: 'user' | 'ai' | 'first_prompt' = record.userTitle
    ? 'user'
    : record.aiTitle
      ? 'ai'
      : 'first_prompt'
  return {
    id: record.sessionId,
    workdir: record.workdir,
    project: record.project,
    mtime: Math.floor(normalizeLastOpenedAt(record.lastOpenedAt) / 1000),
    msg_count: 0,
    first_prompt: record.firstPrompt,
    ai_title: record.aiTitle,
    size: 0,
    user_title: record.userTitle,
    title_source: source,
    bot_id: record.botId,
  }
}

/** 列表始终保留最近 MAX_SIDEBAR_SESSIONS 条（插入都是头部最新，末尾即最旧）。 */
function trimList(items: SessionMeta[]): SessionMeta[] {
  return items.length > MAX_SIDEBAR_SESSIONS ? items.slice(0, MAX_SIDEBAR_SESSIONS) : items
}

export const useSessionsStore = defineStore('sessions', () => {
  const list = ref<SessionMeta[]>([])
  const activeId = ref<string | null>(null)
  const streaming = ref<Record<string, boolean>>({})
  const state = ref<Record<string, SessionState>>({})
  const creating = ref(false)
  const adopted = ref<Record<string, boolean>>({})
  const drafts = ref<Record<string, string>>({})
  const hookPermissions = ref<Record<string, HookPermissionRequest | null>>({})
  const opened = ref<Record<string, boolean>>({})
  const loading = ref(false)
  const userTitles = ref<Record<string, string>>({})
  const titleSources = ref<Record<string, 'user' | 'ai' | 'first_prompt'>>({})
  const sessionBots = ref<Record<string, string>>({})
  const botNames = ref<Record<string, string>>({})
  const botBindings = ref<Record<string, string>>({})

  const active = computed(() => list.value.find((s) => s.id === activeId.value) ?? null)

  function getBotBoundSessionName(botId: string): string | undefined {
    const sessionId = botBindings.value[botId] || sessionBots.value[botId]
    if (!sessionId) return undefined
    const meta = list.value.find((s) => s.id === sessionId)
    if (meta) return sessionDisplayTitle(meta)
    return sessionId.slice(0, 8)
  }

  async function loadBotBindings() {
    try {
      const map = (await ListBotBindings()) as Record<string, string>
      botBindings.value = map
    } catch (e: any) {
      console.error('[sessions] loadBotBindings failed:', e)
    }
  }

  function applyTitleChange(id: string, title: string, source: 'user' | 'ai' | 'first_prompt') {
    titleSources.value = { ...titleSources.value, [id]: source }
    if (source === 'user') {
      userTitles.value = { ...userTitles.value, [id]: title }
    }
    const idx = list.value.findIndex((s) => s.id === id)
    if (idx >= 0) {
      const updated = { ...list.value[idx] }
      if (source === 'user') {
        updated.user_title = title
      } else if (source === 'ai') {
        updated.ai_title = title
      } else if (source === 'first_prompt') {
        updated.first_prompt = title
      }
      updated.title_source = source
      list.value = [...list.value.slice(0, idx), updated, ...list.value.slice(idx + 1)]
    }
  }

  /** Claude /clear 后主进程把当前 PTY 迁移到新 sessionId：把旧 id 的所有状态 key 换成新 id。 */
  function applyRebind(oldId: string, newId: string, workdir: string) {
    const idx = list.value.findIndex((s) => s.id === oldId)
    if (idx >= 0) {
      const item = list.value[idx]
      // /clear 后是全新会话，清空继承的旧标题（user/ai/first_prompt）与旧消息数，
      // 等新会话自己的标题生成后由 refreshList / session:title:changed 更新。
      list.value = trimList([
        ...list.value.slice(0, idx),
        {
          ...item,
          id: newId,
          workdir,
          project: workdir.split(/[\\/]/).filter(Boolean).pop() || workdir,
          user_title: undefined,
          ai_title: '',
          first_prompt: '',
          title_source: undefined,
          msg_count: 0,
        },
        ...list.value.slice(idx + 1),
      ])
    }
    const move = <T extends Record<string, unknown>>(map: T): T => {
      const v = map[oldId]
      if (v === undefined) return map
      return omit({ ...map, [newId]: v }, oldId) as T
    }
    streaming.value = move(streaming.value)
    state.value = move(state.value)
    adopted.value = move(adopted.value)
    drafts.value = move(drafts.value)
    hookPermissions.value = move(hookPermissions.value)
    opened.value = move(opened.value)
    userTitles.value = move(userTitles.value)
    titleSources.value = move(titleSources.value)
    sessionBots.value = move(sessionBots.value)
    // botBindings 是 botId → sessionId 的映射，value 指向旧 id 的也要迁移
    for (const [botId, sid] of Object.entries(botBindings.value)) {
      if (sid === oldId) botBindings.value = { ...botBindings.value, [botId]: newId }
    }
    if (activeId.value === oldId) activeId.value = newId
  }

  async function create(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string) {
    creating.value = true
    try {
      const id = await CreateSession(workdir, prompt, extraArgs)
      adopted.value = { ...adopted.value, [id]: true }
      state.value = { ...state.value, [id]: 'waiting' }
      if (!list.value.find(s => s.id === id)) {
        const project = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
        list.value = trimList([{
          id, workdir, project, mtime: Math.floor(Date.now() / 1000), msg_count: 0,
          first_prompt: prompt, ai_title: '', size: 0,
          user_title: undefined, title_source: 'first_prompt',
        }, ...list.value])
      }
      titleSources.value = { ...titleSources.value, [id]: 'first_prompt' }
      // 绑定 bot（如果有）
      if (botId) {
        await BindSessionBot(id, botId)
        sessionBots.value = { ...sessionBots.value, [id]: botId }
      }
      activeId.value = id
      await select(id)
      return id
    } finally {
      creating.value = false
    }
  }

  async function open(record: RecentSession) {
    const idx = list.value.findIndex((s) => s.id === record.sessionId)
    const meta = recentToMeta(record)
    if (idx >= 0) {
      // 会话已存在：从原位置移除，用最新 lastOpenedAt 的 meta 替换后移到列表头部
      list.value = trimList([meta, ...list.value.slice(0, idx), ...list.value.slice(idx + 1)])
    } else {
      list.value = trimList([meta, ...list.value])
    }
    activeId.value = record.sessionId
    opened.value = { ...opened.value, [record.sessionId]: true }
    const st = record.state === 'running' ? 'waiting' : (record.state || 'idle')
    state.value = { ...state.value, [record.sessionId]: st as SessionState }
    if (record.userTitle) {
      userTitles.value = { ...userTitles.value, [record.sessionId]: record.userTitle }
      titleSources.value = { ...titleSources.value, [record.sessionId]: 'user' }
    } else if (record.aiTitle) {
      titleSources.value = { ...titleSources.value, [record.sessionId]: 'ai' }
    } else {
      titleSources.value = { ...titleSources.value, [record.sessionId]: 'first_prompt' }
    }
    // recentToMeta 硬编码 msg_count: 0，resume 后主动刷新一次拿到真实消息数与标题，
    // 与 /clear 后 refreshList 的效果保持一致（fsnotify 事件不一定在 resume 后触发）。
    await refreshList()
  }

  async function select(id: string) {
    activeId.value = id
    opened.value = { ...opened.value, [id]: true }
    const meta = list.value.find((s) => s.id === id)
    if (!meta) return
    try {
      const titleInfo = await AdoptSession(id, meta.workdir) as { title: string; source: 'user' | 'ai' | 'first_prompt' } | undefined
      if (titleInfo) {
        applyTitleChange(id, titleInfo.title, titleInfo.source)
      }
    } catch (e: any) {
      // adopt 失败不应阻断列表刷新，否则 resume 后 msg_count / 标题仍是旧的
      console.error('[sessions] select adopt failed:', e?.message || e)
    }
    // resume / 重开会话后同步 msg_count / mtime / ai_title，左侧列表展示实时数据
    await refreshList()
  }

  async function refreshList() {
    try {
      const all = await ListSessions()
      if (!all) return
      // 只更新已有条目的数据，不追加新条目（列表仅由 open/create 控制）
      const map = new Map<string, any>(all.map((s: any) => [s.id, s]))
      for (let i = 0; i < list.value.length; i++) {
        const cur = list.value[i]
        const fresh = map.get(cur.id) as Record<string, any> | undefined
        if (!fresh) continue
        // 主进程 listSessions（含 mergeRecentTitles 的 user_title/ai_title）是标题权威来源，
        // 全量同步标题字段：create / applyRebind / 外部入口等路径可能留下缺失或过期的标题，
        // 只同步 msg_count 无法修复（此前 user_title 一直不被刷新，resume 后列表项仍显示旧标题）。
        const user_title = fresh.user_title !== undefined ? fresh.user_title : cur.user_title
        const ai_title = fresh.ai_title || cur.ai_title
        const first_prompt = fresh.first_prompt || cur.first_prompt
        const title_source: SessionMeta['title_source'] =
          user_title ? 'user' : ai_title ? 'ai' : first_prompt ? 'first_prompt' : cur.title_source
        list.value[i] = {
          ...cur,
          msg_count: fresh.msg_count,
          mtime: fresh.mtime,
          user_title,
          ai_title,
          first_prompt,
          title_source,
        }
      }
    } catch (e: any) {
      console.error('[sessions] refreshList failed:', e?.message || e)
    }
  }

  async function send(id: string, prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) return

    streaming.value = { ...streaming.value, [id]: true }
    state.value = { ...state.value, [id]: 'waiting' }

    try {
      const meta = list.value.find((s) => s.id === id)
      if (!meta) throw new Error('session not found in list')
      await AdoptSession(id, meta.workdir)
      await SendMessage(id, trimmed)
    } catch (e: any) {
      state.value = { ...state.value, [id]: 'idle' }
      streaming.value = { ...streaming.value, [id]: false }
      throw e
    }
  }

  function handleHookEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }
    const tp = evt.hook_event_name || evt.type
    switch (tp) {
      case 'SessionStart':
        state.value = { ...state.value, [sid]: 'idle' }
        break
      case 'SessionEnd':
        state.value = { ...state.value, [sid]: 'done' }
        break
      case 'UserPromptSubmit':
        break
      case 'idle_timeout':
        if (state.value[sid] === 'idle' || state.value[sid] === 'done' || state.value[sid] === 'ended') {
          state.value = { ...state.value, [sid]: 'idle' }
        }
        break
    }
  }

  function remove(id: string) {
    list.value = list.value.filter((s) => s.id !== id)
    if (activeId.value === id) {
      activeId.value = null
    }
    streaming.value = omit(streaming.value, id)
    state.value = omit(state.value, id)
    adopted.value = omit(adopted.value, id)
    drafts.value = omit(drafts.value, id)
    hookPermissions.value = omit(hookPermissions.value, id)
    opened.value = omit(opened.value, id)
    userTitles.value = omit(userTitles.value, id)
    titleSources.value = omit(titleSources.value, id)
  }

  function setDraft(sid: string, text: string) {
    drafts.value = { ...drafts.value, [sid]: text }
  }

  function setHookPermission(sid: string, req: HookPermissionRequest | null) {
    if (req) {
      let input = req.toolInput
      if (typeof input === 'string' && input) {
        try { input = JSON.parse(input) } catch {}
      }
      req = { ...req, toolInput: input }
      console.log('[permission] request', sid, req.toolName, input)
    }
    hookPermissions.value = { ...hookPermissions.value, [sid]: req }
    if (req) {
      state.value = { ...state.value, [sid]: 'awaiting_permission' }
    } else if (state.value[sid] === 'awaiting_permission') {
      state.value = { ...state.value, [sid]: 'waiting' }
    }
  }

  async function renameSession(id: string, title: string) {
    const meta = list.value.find((s) => s.id === id)
    if (!meta) throw new Error('session not found')
    const trimmed = title.trim()
    if (!trimmed) throw new Error('title cannot be empty')
    await RenameSession(id, meta.workdir, trimmed)
    applyTitleChange(id, trimmed, 'user')
  }

  async function loadBotNames() {
    try {
      const bots = (await ListBots()) as any[]
      const map: Record<string, string> = {}
      for (const b of bots) { map[b.id] = b.name }
      botNames.value = map
    } catch {}
  }

  async function bindBot(id: string, botId: string | null) {
    console.log('[sessions] bindBot called', id.slice(0, 8), botId)
    await BindSessionBot(id, botId)
    if (botId) {
      sessionBots.value = { ...sessionBots.value, [id]: botId }
      botBindings.value = { ...botBindings.value, [botId]: id }
    } else {
      const prevBotId = sessionBots.value[id]
      sessionBots.value = { ...sessionBots.value, [id]: undefined! }
      sessionBots.value = Object.fromEntries(Object.entries(sessionBots.value).filter(([, v]) => v !== undefined))
      if (prevBotId) {
        botBindings.value = { ...botBindings.value, [prevBotId]: undefined! }
        botBindings.value = Object.fromEntries(Object.entries(botBindings.value).filter(([, v]) => v !== undefined))
      }
    }
    await loadBotNames()
    console.log('[sessions] bindBot done, sessionBots:', sessionBots.value)
  }

  function getSessionBotName(id: string): string | undefined {
    const botId = sessionBots.value[id]
    return botId ? botNames.value[botId] : undefined
  }

  function reset() {
    list.value = []
    activeId.value = null
    streaming.value = {}
    state.value = {}
    creating.value = false
    adopted.value = {}
    drafts.value = {}
    hookPermissions.value = {}
    opened.value = {}
    userTitles.value = {}
    titleSources.value = {}
    sessionBots.value = {}
  }

  // 左侧列表只显示手动打开/创建的会话，启动时不做历史自动填充；
  // 打开会话（open/select）时通过 refreshList 同步消息数/标题等实时数据。

  return { list, activeId, active, streaming, state,
    creating, loading, adopted, drafts, hookPermissions, opened,
    userTitles, titleSources, sessionBots, botNames, botBindings,
    setDraft, create, open, select, send, setHookPermission,
    refreshList, handleHookEvent, remove, renameSession, applyTitleChange,
    applyRebind,
    loadBotNames, bindBot, getSessionBotName, loadBotBindings, getBotBoundSessionName,
    reset }
})

export function sessionDisplayTitle(meta?: { id?: string; user_title?: string; ai_title?: string; first_prompt?: string; project?: string } | null): string {
  if (!meta) return '新会话'
  return meta.user_title || meta.ai_title || meta.first_prompt || meta.project || meta.id?.slice(0, 8) || '新会话'
}

// 供单测使用（同 sessionDisplayTitle 导出模式）
export { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList }
