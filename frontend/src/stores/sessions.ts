import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, ChatMessage, SessionState } from '../types/session'
import type { ContentBlock, ToolResultBlock, RawContent } from '../types/blocks'
import { ListSessions, CreateSession, SendMessage, GetSessionMessages, GetSessionStates, SwitchOwner, AdoptSession } from '../composables/useWails'

export interface PendingPerm {
  tool: string
  args: unknown
  reqId: string
}

// parseBlocks 把 Wails 序列化后的 m.content 归一化成 ContentBlock[]。
// m.content 可能是 JSON 字符串、对象/数组、null/undefined。
// 这是 sessions.ts 里 formatContent 的结构化版本 —— 关键变化是保留每个 block 的
// 原始 type / fields,不再被 formatBlock 拍扁成 markdown 文本。
//
// 已知类型(text / thinking / tool_use / tool_result / image)精确解析;
// 其他 / 缺字段的降级为 tool_use generic(给 GenericTool 用 JSON 兜底)。
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
      // Claude image block: { type:'image', source:{type:'base64', media_type, data} }
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
      // 未知类型 —— 已知 tool_use 变体(AskUserQuestion / ExitPlanMode 等)在 Claude CLI
      // stream-json 里通常以 type='tool_use' + name 区分。但历史/自定义 jsonl 偶尔
      // 会直接 type='AskUserQuestion' 这种;统一降级为 tool_use 通用块。
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
  const pending = ref<Record<string, PendingPerm | null>>({})
  const historyOffset = ref<Record<string, number>>({})
  const hasMore = ref<Record<string, boolean>>({})
  const owner = ref<Record<string, 'app' | 'terminal'>>({})
  const mode  = ref<Record<string, 'stream' | 'resume'>>({})
  const terminalLoading = ref<Record<string, boolean>>({})
  const switchingToApp = ref<Record<string, boolean>>({})
  const creating = ref(false)
  const adopted = ref<Record<string, boolean>>({})
  const drafts = ref<Record<string, string>>({})

  const active = computed(() => list.value.find((s) => s.id === activeId.value) ?? null)

  async function refresh() {
    list.value = await ListSessions()
    try {
      const states = await GetSessionStates()
      for (const [id, st] of Object.entries(states)) {
        state.value = { ...state.value, [id]: st as SessionState }
      }
    } catch {}
  }

  async function create(workdir: string, prompt: string) {
    creating.value = true
    try {
      const id = await CreateSession(workdir, prompt)
      adopted.value = { ...adopted.value, [id]: true }
      owner.value = { ...owner.value, [id]: 'app' }
      mode.value  = { ...mode.value,  [id]: 'stream' }
      if (!list.value.find(s => s.id === id)) {
        list.value = [...list.value, {
          id, workdir, mtime: Date.now(), msg_count: 0,
          first_prompt: prompt, ai_title: '', size: 0,
        }]
      }
      activeId.value = id
      return id
    } finally {
      creating.value = false
    }
  }

  function select(id: string) {
    activeId.value = id
    const meta = list.value.find((s) => s.id === id)
    if (meta && !messages.value[id]) {
      const total = meta.msg_count
      loadHistory(id, meta.workdir, Math.max(0, total - PAGE_SIZE), PAGE_SIZE, true)
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
        ts: Date.now() - ((raw?.length || 0) - i) * 1000,
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
    try {
      await refresh()
      const meta = list.value.find((s) => s.id === sid)
      if (!meta) return
      const total = meta.msg_count
      if (total === 0) return
      const offset = Math.max(0, total - PAGE_SIZE)
      const raw = await GetSessionMessages(sid, meta.workdir, offset, PAGE_SIZE)
      const msgs = (raw || []).map((m: any, i: number) => ({
        id: `${sid}-${offset + i}`,
        msgId: m.msgId,
        role: m.role || m.Role || 'assistant',
        blocks: parseBlocks(m.content || m.Content),
        ts: Date.now() - ((raw?.length || 0) - i) * 1000,
      } as ChatMessage))
      historyOffset.value = { ...historyOffset.value, [sid]: offset + (raw?.length || 0) }
      hasMore.value = { ...hasMore.value, [sid]: offset > 0 }
      messages.value = { ...messages.value, [sid]: msgs }
    } catch (e: any) {
      console.error('[sessions] reloadFromJsonl failed:', e?.message || e)
    }
  }

  async function send(id: string, prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) return

    // 乐观插入用户消息，立即在对话框回显
    const optimisticId = crypto.randomUUID()
    const prev = messages.value[id] || []
    messages.value = { ...messages.value, [id]: [...prev, {
      id: optimisticId,
      role: 'user',
      blocks: [{ type: 'text', text: trimmed }],
      ts: Date.now(),
      optimistic: true,
    } as ChatMessage] }

    streaming.value = { ...streaming.value, [id]: true }
    state.value = { ...state.value, [id]: 'waiting' }

    const fromTerminal = owner.value[id] === 'terminal'
    if (fromTerminal) {
      switchingToApp.value = { ...switchingToApp.value, [id]: true }
    }
    try {
      if (fromTerminal) {
        await SwitchOwner(id, 'app', trimmed)
        owner.value = { ...owner.value, [id]: 'app' }
        mode.value  = { ...mode.value,  [id]: 'stream' }
      } else {
        const meta = list.value.find((s) => s.id === id)
        if (!meta) throw new Error('session not found in list')
        await AdoptSession(id, meta.workdir)
        owner.value = { ...owner.value, [id]: 'app' }
        mode.value  = { ...mode.value,  [id]: 'stream' }
        await SendMessage(id, trimmed)
      }
    } catch (e: any) {
      // 发送失败：移除乐观消息并恢复状态
      const list = messages.value[id] || []
      messages.value = { ...messages.value, [id]: list.filter(m => m.id !== optimisticId) }
      state.value = { ...state.value, [id]: 'idle' }
      streaming.value = { ...streaming.value, [id]: false }
      throw e
    } finally {
      if (fromTerminal) {
        switchingToApp.value = { ...switchingToApp.value, [id]: false }
      }
    }
  }

  // 根据消息 blocks 推导活跃状态
  function updateStateFromBlocks(sid: string, blocks: ContentBlock[]) {
    const hasToolUse = blocks.some((b) => b.type === 'tool_use')
    const hasText = blocks.some((b) => b.type === 'text')
    const hasThinking = blocks.some((b) => b.type === 'thinking')

    if (hasToolUse) {
      state.value = { ...state.value, [sid]: 'running_tool' }
    } else if (hasThinking && !hasText) {
      state.value = { ...state.value, [sid]: 'thinking' }
    } else if (hasText) {
      state.value = { ...state.value, [sid]: 'streaming' }
    }
  }

  function handleEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }

    switch (evt.type) {
      case 'user': {
        const msg = evt.message
        if (!msg) break
        const blocks = parseBlocks(msg.content)
        const prev = messages.value[sid] || []
        const msgId = msg.id
        if (msgId && prev.some(m => (m as any).msgId === msgId)) break

        // 尝试替换最近的乐观 user 消息（按内容匹配）
        const text = blocks.find((b) => b.type === 'text')?.text || ''
        const optimisticIdx = text
          ? [...prev].reverse().findIndex(
              (m) => m.role === 'user' && m.optimistic && (m.blocks.find((b) => b.type === 'text') as any)?.text === text
            )
          : -1

        if (optimisticIdx >= 0) {
          const idx = prev.length - 1 - optimisticIdx
          const replaced = [...prev]
          replaced[idx] = { ...replaced[idx], msgId, blocks, ts: Date.now(), optimistic: false }
          messages.value = { ...messages.value, [sid]: replaced }
        } else {
          messages.value = { ...messages.value, [sid]: [...prev, {
            id: crypto.randomUUID(),
            msgId,
            role: msg.role || 'user',
            blocks,
            ts: Date.now(),
          } as ChatMessage] }
        }

        // 若收到的是 tool_result 回复，工具执行结束，回到 streaming
        const isAllToolResult = blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')
        if (isAllToolResult && state.value[sid] === 'running_tool') {
          state.value = { ...state.value, [sid]: 'streaming' }
        }
        break
      }
      case 'assistant': {
        const msg = evt.message
        if (!msg) break
        const blocks = parseBlocks(msg.content)
        const prev = messages.value[sid] || []
        const msgId = msg.id
        if (msgId && prev.some(m => (m as any).msgId === msgId)) break
        messages.value = { ...messages.value, [sid]: [...prev, {
          id: crypto.randomUUID(),
          msgId,
          role: msg.role || 'assistant',
          blocks,
          ts: Date.now(),
        } as ChatMessage] }
        updateStateFromBlocks(sid, blocks)
        break
      }
      case 'tool_use': {
        // 旧 stream-event 类型，blocks 通常已包含在 assistant/user message 里
        break
      }
      case 'tool_result': {
        // 独立的 tool_result 事件：工具执行结束
        if (state.value[sid] === 'running_tool') {
          state.value = { ...state.value, [sid]: 'streaming' }
        }
        break
      }
      case 'permission_request': {
        const d = evt.data || evt
        pending.value = { ...pending.value, [sid]: { tool: d.tool, args: d.args, reqId: d.request_id } }
        state.value = { ...state.value, [sid]: 'awaiting_permission' }
        streaming.value = { ...streaming.value, [sid]: false }
        break
      }
      case 'result':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        break
      case 'done':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        adopted.value = { ...adopted.value, [sid]: false }
        reloadFromJsonl(sid)
        break
    }
  }

  function handleHookEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }
    const tp = evt.hook_event_name || evt.type
    switch (tp) {
      case 'SessionStart':
        if (owner.value[sid] !== 'app') {
          owner.value = { ...owner.value, [sid]: 'terminal' }
          mode.value  = { ...mode.value,  [sid]: 'resume' }
          state.value = { ...state.value, [sid]: 'idle' }
          terminalLoading.value = { ...terminalLoading.value, [sid]: false }
        }
        break
      case 'SessionEnd':
        // 外部终端退出后回归 App 控制；加载过渡期内旧 stream 进程的 SessionEnd 忽略
        if (owner.value[sid] === 'terminal' && !terminalLoading.value[sid]) {
          owner.value = { ...owner.value, [sid]: 'app' }
          mode.value  = { ...mode.value,  [sid]: 'stream' }
          switchingToApp.value = { ...switchingToApp.value, [sid]: false }
        }
        state.value = { ...state.value, [sid]: 'done' }
        break
      case 'PreToolUse':
      case 'PostToolUse':
      case 'UserPromptSubmit':
        // 这些 hook 只在已确认是外部终端控制时保持 terminal；
        // App 控制期间自己的 stream 进程也会发这些 hook，不能误切。
        if (owner.value[sid] === 'terminal' || terminalLoading.value[sid]) {
          owner.value = { ...owner.value, [sid]: 'terminal' }
          mode.value  = { ...mode.value,  [sid]: 'resume' }
        }
        break
      case 'idle_timeout':
        // 活跃状态不收 idle_timeout
        if (state.value[sid] === 'idle' || state.value[sid] === 'done' || state.value[sid] === 'ended') {
          state.value = { ...state.value, [sid]: 'idle' }
        }
        break
    }
  }

  function setDraft(sid: string, text: string) {
    drafts.value = { ...drafts.value, [sid]: text }
  }

  return { list, activeId, active, messages, streaming, state, pending,
    hasMore, owner, mode, terminalLoading, switchingToApp, creating, adopted, drafts, setDraft, refresh, create, select, send,
    reloadFromJsonl, handleEvent, handleHookEvent, loadMore }
})
