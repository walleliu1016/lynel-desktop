import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, ChatMessage, SessionState, ToolExecution } from '../types/session'
import type { ContentBlock, ToolResultBlock, RawContent } from '../types/blocks'
import { ListSessions, CreateSession, SendMessage, GetSessionMessages, GetToolExecutions, GetSessionStates, SwitchOwner, AdoptSession } from '../composables/useWails'

export interface HookPermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  toolInput: any
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
  const historyOffset = ref<Record<string, number>>({})
  const hasMore = ref<Record<string, boolean>>({})
  const owner = ref<Record<string, 'app' | 'terminal'>>({})
  const mode  = ref<Record<string, 'stream' | 'resume'>>({})
  const terminalLoading = ref<Record<string, boolean>>({})
  const switchingToApp = ref<Record<string, boolean>>({})
  const creating = ref(false)
  const adopted = ref<Record<string, boolean>>({})
  const drafts = ref<Record<string, string>>({})
  const executions = ref<Record<string, ToolExecution[]>>({})
  const hookPermissions = ref<Record<string, HookPermissionRequest | null>>({})

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

  async function refresh(options?: { sort?: boolean }) {
    const backend = await ListSessions()
    try {
      const states = await GetSessionStates()
      for (const [id, st] of Object.entries(states)) {
        // 后端持久化状态用 'running' 表示活跃，前端状态机统一成 'waiting'
        const normalized = st === 'running' ? 'waiting' : st
        state.value = { ...state.value, [id]: normalized as SessionState }
      }
    } catch {}

    if (options?.sort !== false) {
      list.value = backend
      return
    }

    // 背景刷新：保持现有顺序，静默更新字段；只有新增/删除/字段变更时才操作。
    // 这样可以避免每次 jsonl 写入都替换整个列表导致左侧会话区闪烁/跳动。
    const existingMap = new Map(list.value.map(s => [s.id, s]))
    const added: SessionMeta[] = []
    const changed: SessionMeta[] = []
    for (const s of backend) {
      const cur = existingMap.get(s.id)
      if (!cur) {
        added.push(s)
      } else if (
        cur.workdir !== s.workdir ||
        cur.mtime !== s.mtime ||
        cur.msg_count !== s.msg_count ||
        cur.first_prompt !== s.first_prompt ||
        cur.ai_title !== s.ai_title ||
        cur.size !== s.size
      ) {
        changed.push(s)
      }
    }
    const removed = list.value.some(s => !backend.some(b => b.id === s.id))
    if (added.length === 0 && !removed && changed.length === 0) return

    // 仅字段变更时原地替换，不重建整个数组，保持滚动位置和选中状态稳定。
    if (added.length === 0 && !removed) {
      for (const s of changed) {
        const idx = list.value.findIndex(x => x.id === s.id)
        if (idx >= 0) list.value[idx] = s
      }
      return
    }

    const preserved = list.value
      .filter(s => backend.some(b => b.id === s.id))
      .map(s => changed.find(b => b.id === s.id) || s)
    list.value = [...added, ...preserved]
  }

  async function create(workdir: string, prompt: string) {
    creating.value = true
    try {
      const id = await CreateSession(workdir, prompt)
      adopted.value = { ...adopted.value, [id]: true }
      owner.value = { ...owner.value, [id]: 'app' }
      mode.value  = { ...mode.value,  [id]: 'stream' }
      state.value = { ...state.value, [id]: 'waiting' }
      if (!list.value.find(s => s.id === id)) {
        // 新建会话按 mtime 倒序应排在最前
        const project = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
        list.value = [{
          id, workdir, project, mtime: Date.now(), msg_count: 0,
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

  async function select(id: string) {
    activeId.value = id
    const meta = list.value.find((s) => s.id === id)
    if (!meta) return
    if (!messages.value[id]) {
      const total = meta.msg_count
      await loadHistory(id, meta.workdir, Math.max(0, total - PAGE_SIZE), PAGE_SIZE, true)
    }
    await loadExecutions(id, meta.workdir)
  }

  async function loadExecutions(sid: string, workdir: string) {
    try {
      const raw = await GetToolExecutions(sid, workdir)
      const list = (raw || []).map(normalizeExecution)
      executions.value = { ...executions.value, [sid]: list }
    } catch (e: any) {
      console.error('[sessions] loadExecutions failed:', e?.message || e)
    }
  }

  function normalizeExecution(m: any): ToolExecution {
    return {
      id: m.id || m.ID || '',
      kind: (m.kind || m.Kind || 'tool') as 'tool' | 'llm',
      name: m.name || m.Name || '',
      startedAt: m.startedAt || m.StartedAt || 0,
      endedAt: m.endedAt || m.EndedAt || 0,
      durationMs: m.durationMs || m.DurationMs || 0,
      status: (m.status || m.Status || 'running') as 'running' | 'success' | 'error',
      input: m.input || m.Input || '',
      output: m.output || m.Output || '',
      exitCode: m.exitCode || m.ExitCode || 0,
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
        ts: m.Timestamp || m.timestamp || Date.now(),
      } as ChatMessage))
      historyOffset.value = { ...historyOffset.value, [sid]: offset + (raw?.length || 0) }
      hasMore.value = { ...hasMore.value, [sid]: offset > 0 }
      messages.value = { ...messages.value, [sid]: msgs }
      await loadExecutions(sid, meta.workdir)
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

        // 从 assistant 消息里的 tool_use block 补全工具执行 input
        for (const b of blocks) {
          if (b.type !== 'tool_use') continue
          const toolId = b.id || crypto.randomUUID()
          const toolName = b.name || 'Unknown'
          const exList = executions.value[sid] || []
          const idx = exList.findIndex((e) => e.id === toolId)
          const input = toolInputSummary(toolName, b.input)
          if (idx >= 0) {
            const next = [...exList]
            next[idx] = { ...next[idx], name: toolName, input }
            executions.value = { ...executions.value, [sid]: next }
          } else {
            executions.value = { ...executions.value, [sid]: [...exList, {
              id: toolId,
              kind: 'tool',
              name: toolName,
              startedAt: Date.now(),
              endedAt: 0,
              durationMs: 0,
              status: 'running',
              input,
              output: '',
              exitCode: 0,
            }] }
          }
        }

        // 非纯 tool_use 的 assistant 消息视为 LLM 调用；output 记录本次生成的内容摘要
        const hasText = blocks.some((b) => b.type === 'text' || b.type === 'thinking')
        if (hasText) {
          const exList = executions.value[sid] || []
          const runningIdx = exList.findLastIndex((e) => e.kind === 'llm' && e.status === 'running')
          const summary = llmOutputSummary(blocks)
          if (runningIdx < 0) {
            executions.value = { ...executions.value, [sid]: [...exList, {
              id: crypto.randomUUID(),
              kind: 'llm',
              name: 'LLM',
              startedAt: Date.now(),
              endedAt: 0,
              durationMs: 0,
              status: 'running',
              input: '',
              output: summary,
              exitCode: 0,
            }] }
          } else {
            const prev = exList[runningIdx]
            const nextOutput = prev.output ? `${prev.output} ${summary}` : summary
            const next = [...exList]
            next[runningIdx] = { ...prev, output: truncate(nextOutput, 200) }
            executions.value = { ...executions.value, [sid]: next }
          }
        }
        break
      }
      case 'tool_use': {
        // 新版 stream-json 也会把 tool_use 作为独立事件发出
        state.value = { ...state.value, [sid]: 'running_tool' }
        break
      }
      case 'tool_result': {
        // 独立的 tool_result 事件：工具执行结束
        if (state.value[sid] === 'running_tool') {
          state.value = { ...state.value, [sid]: 'streaming' }
        }
        break
      }
      case 'result':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        endRunningLlm(sid)
        break
      case 'done':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        adopted.value = { ...adopted.value, [sid]: false }
        endRunningLlm(sid)
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
      case 'PostToolUseFailure': {
        // 这些 hook 只在已确认是外部终端控制时保持 terminal；
        // App 控制期间自己的 stream 进程也会发这些 hook，不能误切。
        if (owner.value[sid] === 'terminal' || terminalLoading.value[sid]) {
          owner.value = { ...owner.value, [sid]: 'terminal' }
          mode.value  = { ...mode.value,  [sid]: 'resume' }
        }
        const toolUseID = evt.tool_use_id || evt.toolUseID
        if (!toolUseID) break
        updateExecutionFromHook(sid, tp, evt)
        break
      }
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

  function endRunningLlm(sid: string) {
    const list = executions.value[sid] || []
    const idx = list.findLastIndex((e) => e.kind === 'llm' && e.status === 'running')
    if (idx < 0) return
    const now = Date.now()
    const prev = list[idx]
    const duration = now - (prev.startedAt || now)
    const next = [...list]
    next[idx] = { ...prev, endedAt: now, durationMs: duration, status: 'success' }
    executions.value = { ...executions.value, [sid]: next }
  }

  function updateExecutionFromHook(sid: string, tp: string, evt: any) {
    const list = executions.value[sid] || []
    const toolUseID = evt.tool_use_id || evt.toolUseID
    const hookName = evt.hook_name || evt.hookName || ''
    const name = hookName.split(':').pop() || toolUseID
    const idx = list.findIndex((e) => e.id === toolUseID)
    const now = Date.now()

    if (tp === 'PreToolUse') {
      if (idx >= 0) {
        const updated = { ...list[idx], startedAt: now, status: 'running' as const }
        const next = [...list]
        next[idx] = updated
        executions.value = { ...executions.value, [sid]: next }
      } else {
        executions.value = { ...executions.value, [sid]: [...list, {
          id: toolUseID,
          kind: 'tool',
          name,
          startedAt: now,
          endedAt: 0,
          durationMs: 0,
          status: 'running',
          input: '',
          output: '',
          exitCode: 0,
        }] }
      }
      return
    }

    const exitCode = evt.exit_code ?? evt.exitCode ?? 0
    const output = evt.stdout || evt.stderr || ''
    const status = tp === 'PostToolUseFailure' ? 'error' : 'success'
    const endedAt = now
    if (idx >= 0) {
      const prev = list[idx]
      const duration = endedAt - (prev.startedAt || endedAt)
      const updated: ToolExecution = { ...prev, endedAt, durationMs: duration, status, output, exitCode }
      if (prev.name === toolUseID && name) updated.name = name
      const next = [...list]
      next[idx] = updated
      executions.value = { ...executions.value, [sid]: next }
    } else {
      executions.value = { ...executions.value, [sid]: [...list, {
        id: toolUseID,
        kind: 'tool',
        name,
        startedAt: endedAt,
        endedAt,
        durationMs: 0,
        status,
        input: '',
        output,
        exitCode,
      }] }
    }
  }

  function setDraft(sid: string, text: string) {
    drafts.value = { ...drafts.value, [sid]: text }
  }

  function setHookPermission(sid: string, req: HookPermissionRequest | null) {
    if (req) {
      // 兼容 toolInput 是 JSON 字符串的情况
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
    hasMore, owner, mode, terminalLoading, switchingToApp, creating, adopted, drafts, executions, hookPermissions,
    setDraft, refresh, create, select, send, setHookPermission,
    reloadFromJsonl, handleEvent, handleHookEvent, loadMore }
})
