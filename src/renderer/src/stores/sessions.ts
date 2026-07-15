import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, ChatMessage, SessionState } from '../types/session'
import type { RecentSession } from '../types/recent'
import type { ContentBlock, ToolResultBlock, RawContent } from '../types/blocks'
import { CreateSession, SendMessage, GetSessionMessages, AdoptSession } from '../composables/useElectron'

export interface HookPermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  toolInput: any
}

// parseBlocks 把 Wails 序列化后的 m.content 归一化成 ContentBlock[]。
// m.content 可能是 JSON 字符串、对象/数组、null/undefined。
function parseBlocks(raw: RawContent): ContentBlock[] {
  let parsed: any = raw
  if (typeof parsed === 'string') {
    if (!parsed) return []
    try { parsed = JSON.parse(parsed) } catch { return [{ type: 'text', text: parsed }] }
  }
  if (!Array.isArray(parsed)) {
    if (parsed && typeof parsed === 'object' && (parsed as any).type) {
      return [parseBlock(parsed) || { type: 'text', text: String(JSON.stringify(parsed)) }]
    }
    return parsed == null ? [] : [{ type: 'text', text: String(parsed) }]
  }
  const out: ContentBlock[] = []
  for (const item of parsed) {
    const b = parseBlock(item)
    if (b) out.push(b)
  }
  return out
}

function parseBlock(b: any): ContentBlock | null {
  if (!b || typeof b !== 'object') return null
  const t = b.type
  switch (t) {
    case 'text':
      return typeof b.text === 'string' ? { type: 'text', text: b.text } : null
    case 'thinking':
      return b.thinking ? { type: 'thinking', text: b.thinking } : null
    case 'image': {
      const src = b.source || {}
      const mediaType = src.media_type || src.mediaType || 'image/png'
      const data = src.data || ''
      if (!data) return null
      return { type: 'image', mediaType, data }
    }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: b.id,
        name: b.name || 'Unknown',
        input: b.input && typeof b.input === 'object' ? b.input : {},
      }
    case 'tool_result': {
      const isError = !!b.is_error
      const content = parseToolResultContent(b.content)
      return { type: 'tool_result', toolUseId: b.tool_use_id, content, isError }
    }
    case 'toolUseResult':
      return null
    default:
      if (typeof b.name === 'string' || typeof t === 'string') {
        return {
          type: 'tool_use',
          id: b.id,
          name: (b.name as string) || (t as string),
          input: (b.input && typeof b.input === 'object') ? b.input : b,
        }
      }
      return null
  }
}

function parseToolResultContent(raw: any): ToolResultBlock[] {
  if (raw == null) return []
  if (typeof raw === 'string') return raw ? [{ type: 'text', text: raw }] : []
  if (Array.isArray(raw)) {
    const out: ToolResultBlock[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'text' && typeof item.text === 'string') {
        out.push({ type: 'text', text: item.text })
      } else if (item.type === 'image') {
        const src = item.source || {}
        const mediaType = src.media_type || src.mediaType || 'image/png'
        if (src.data) out.push({ type: 'image', mediaType, data: src.data })
      }
    }
    return out
  }
  if (typeof raw === 'object') return [{ type: 'text', text: JSON.stringify(raw, null, 2) }]
  return []
}

const PAGE_SIZE = 100

export const useSessionsStore = defineStore('sessions', () => {
  const list = ref<SessionMeta[]>([])
  const activeId = ref<string | null>(null)
  const messages = ref<Record<string, ChatMessage[]>>({})
  const streaming = ref<Record<string, boolean>>({})
  const state = ref<Record<string, SessionState>>({})
  const historyOffset = ref<Record<string, number>>({})
  const hasMore = ref<Record<string, boolean>>({})
  const creating = ref(false)
  const adopted = ref<Record<string, boolean>>({})
  const drafts = ref<Record<string, string>>({})
  const hookPermissions = ref<Record<string, HookPermissionRequest | null>>({})
  const opened = ref<Record<string, boolean>>({})
  const loading = ref(false)

  const active = computed(() => list.value.find((s) => s.id === activeId.value) ?? null)

  function toolInputSummary(name: string, input: Record<string, unknown>): string {
    if (!input || typeof input !== 'object') return ''
    switch (name) {
      case 'Bash':
        return truncate(String(input.command || ''), 120)
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return truncate(String(input.file_path || ''), 120)
      case 'Glob':
        return truncate(String(input.pattern || ''), 120)
      case 'Grep': {
        const pat = String(input.pattern || '')
        const path = String(input.path || '')
        if (!pat) return ''
        return path ? `${truncate(pat, 60)} in ${path}` : truncate(pat, 120)
      }
      case 'WebFetch':
        return truncate(String(input.url || ''), 120)
      case 'WebSearch':
        return truncate(String(input.query || ''), 120)
      case 'Skill':
        return truncate(String(input.skill || ''), 120)
    }
    for (const v of Object.values(input)) {
      if (typeof v === 'string' && v) return truncate(v, 120)
    }
    return ''
  }

  function llmOutputSummary(blocks: ContentBlock[]): string {
    const parts: string[] = []
    for (const b of blocks) {
      if (b.type === 'text' && (b as any).text) {
        parts.push((b as any).text)
      } else if (b.type === 'thinking' && (b as any).text) {
        parts.push((b as any).text)
      }
    }
    return truncate(parts.join(' '), 200)
  }

  function truncate(s: string, max: number): string {
    if (!s) return ''
    if (s.length <= max) return s
    return s.slice(0, max) + '…'
  }

  async function create(workdir: string, prompt: string, extraArgs: string[] = []) {
    creating.value = true
    try {
      const id = await CreateSession(workdir, prompt, extraArgs)
      adopted.value = { ...adopted.value, [id]: true }
      state.value = { ...state.value, [id]: 'waiting' }
      if (!list.value.find(s => s.id === id)) {
        const project = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
        list.value = [{
          id, workdir, project, mtime: Math.floor(Date.now() / 1000), msg_count: 0,
          first_prompt: prompt, ai_title: '', size: 0,
        }, ...list.value]
      }
      activeId.value = id
      await select(id)
      return id
    } finally {
      creating.value = false
    }
  }

  function open(record: RecentSession) {
    if (!list.value.find((s) => s.id === record.sessionId)) {
      list.value = [{
        id: record.sessionId,
        workdir: record.workdir,
        project: record.project,
        mtime: Math.floor(record.lastOpenedAt / 1000),
        msg_count: 0,
        first_prompt: record.firstPrompt,
        ai_title: record.aiTitle,
        size: 0,
      }, ...list.value]
    }
    activeId.value = record.sessionId
    opened.value = { ...opened.value, [record.sessionId]: true }
    const st = record.state === 'running' ? 'waiting' : (record.state || 'idle')
    state.value = { ...state.value, [record.sessionId]: st as SessionState }
  }

  async function select(id: string) {
    activeId.value = id
    opened.value = { ...opened.value, [id]: true }
    const meta = list.value.find((s) => s.id === id)
    if (!meta) return
    await AdoptSession(id, meta.workdir)
    if (!messages.value[id]) {
      const total = meta.msg_count
      await loadHistory(id, meta.workdir, Math.max(0, total - PAGE_SIZE), PAGE_SIZE, true)
    }
  }

  async function loadHistory(sid: string, workdir: string, offset: number, limit: number, isFirst: boolean) {
    try {
      const raw = await GetSessionMessages(sid, workdir, offset, limit)
      const msgs = (raw || []).map((m: any, i: number) => ({
        id: `${sid}-${offset + i}`,
        msgId: m.msgId,
        role: m.role || m.Role || 'assistant',
        blocks: parseBlocks(m.content || m.Content),
        ts: m.Timestamp || m.timestamp || Date.now(),
      } as ChatMessage))
      if (isFirst) {
        messages.value = { ...messages.value, [sid]: msgs }
      } else {
        const prev = messages.value[sid] || []
        messages.value = { ...messages.value, [sid]: [...msgs, ...prev] }
      }
      historyOffset.value = { ...historyOffset.value, [sid]: offset + (raw?.length || 0) }
      hasMore.value = { ...hasMore.value, [sid]: offset > 0 }
    } catch (e: any) {
      console.error('[sessions] loadHistory failed:', e?.message || e)
    }
  }

  async function loadMore() {
    const id = activeId.value
    if (!id) return
    const meta = list.value.find((s) => s.id === id)
    if (!meta) return
    const loaded = historyOffset.value[id] || meta.msg_count
    const nextStart = Math.max(0, loaded - PAGE_SIZE)
    if (nextStart >= loaded) return
    await loadHistory(id, meta.workdir, nextStart, loaded - nextStart, false)
  }

  async function reloadFromJsonl(sid: string) {
    const meta = list.value.find((s) => s.id === sid)
    if (!meta) return
    try {
      const raw = await GetSessionMessages(sid, meta.workdir, 0, 0)
      const msgs = (raw || []).map((m: any, i: number) => ({
        id: `${sid}-${i}`,
        msgId: m.msgId,
        role: m.role || m.Role || 'assistant',
        blocks: parseBlocks(m.content || m.Content),
        ts: m.Timestamp || m.timestamp || Date.now(),
      } as ChatMessage))
      historyOffset.value = { ...historyOffset.value, [sid]: raw?.length || 0 }
      hasMore.value = { ...hasMore.value, [sid]: false }
      messages.value = { ...messages.value, [sid]: msgs }
    } catch (e: any) {
      console.error('[sessions] reloadFromJsonl failed:', e?.message || e)
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

  return { list, activeId, active, messages, streaming, state,
    hasMore, creating, loading, adopted, drafts, hookPermissions, opened,
    setDraft, create, open, select, send, setHookPermission,
    reloadFromJsonl, handleHookEvent, loadMore }
})
