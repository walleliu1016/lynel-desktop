import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, ChatMessage, SessionState } from '../types/session'
import { ListSessions, CreateSession, SendMessage, GetSessionMessages, GetSessionStates, SwitchOwner } from '../composables/useWails'

export interface PendingPerm {
  tool: string
  args: unknown
  reqId: string
}

// 解析 Claude API content block，提取文本拼成 markdown。
// 与 internal/jsonl/parser.go 保持同步。
function formatContent(raw: any): string {
  if (Array.isArray(raw)) {
    return raw.map(formatBlock).filter(Boolean).join('\n\n')
  }
  if (typeof raw === 'string') {
    try {
      const blocks = JSON.parse(raw)
      if (Array.isArray(blocks)) return formatContent(blocks)
    } catch {}
    return raw
  }
  return String(raw || '')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `…(+${s.length - max})`
}

function formatToolUse(name: string, input: any): string {
  if (!name) return ''
  const args = (input && typeof input === 'object') ? input : {}
  let keyArg = ''
  switch (name) {
    case 'Bash':
      if (typeof args.command === 'string') keyArg = `\`${truncate(args.command, 200)}\``
      break
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      if (typeof args.file_path === 'string') keyArg = `\`${args.file_path}\``
      break
    case 'Glob':
      if (typeof args.pattern === 'string') keyArg = `\`${truncate(args.pattern, 200)}\``
      break
    case 'Grep':
      if (typeof args.pattern === 'string') {
        const p = truncate(args.pattern, 100)
        keyArg = args.path ? `\`${p}\` in \`${args.path}\`` : `\`${truncate(args.pattern, 200)}\``
      }
      break
    case 'Skill':
      if (typeof args.skill === 'string') keyArg = `\`${args.skill}\``
      break
    case 'WebFetch':
      if (typeof args.url === 'string') keyArg = truncate(args.url, 200)
      break
    case 'WebSearch':
      if (typeof args.query === 'string') keyArg = truncate(args.query, 200)
      break
    default: {
      // 未知工具：把 input 整个 JSON 摊开
      const s = JSON.stringify(args)
      if (s && s !== 'null' && s !== '{}') keyArg = `\`${truncate(s, 200)}\``
    }
  }
  return keyArg ? `🔧 **${name}** ${keyArg}` : `🔧 **${name}**`
}

function formatToolResult(raw: any, isError: boolean): string {
  if (raw == null) return ''
  const prefix = isError ? '⚠️ ' : '📤 '
  if (typeof raw === 'string') {
    return prefix + truncate(raw.replace(/\n+$/, ''), 1500)
  }
  if (Array.isArray(raw)) {
    const parts: string[] = []
    for (const b of raw) {
      if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    return prefix + truncate(parts.join('\n').replace(/\n+$/, ''), 1500)
  }
  return prefix + truncate(String(raw), 1500)
}

function formatBlock(b: any): string {
  if (!b || typeof b !== 'object') return ''
  switch (b.type) {
    case 'text':
      return typeof b.text === 'string' ? b.text : ''
    case 'thinking':
      return b.thinking ? `> 💭 ${b.thinking}` : ''
    case 'tool_use':
      return formatToolUse(b.name, b.input)
    case 'tool_result':
      return formatToolResult(b.content, !!b.is_error)
    default:
      return ''
  }
}

const PAGE_SIZE = 100

export const useSessionsStore = defineStore('sessions', () => {
  const list = ref<SessionMeta[]>([])
  const activeId = ref<string | null>(null)
  const messages = ref<Record<string, ChatMessage[]>>({})
  const streaming = ref<Record<string, boolean>>({})
  const state = ref<Record<string, SessionState>>({})
  const pending = ref<Record<string, PendingPerm | null>>({})
  const toolBlocks = ref<Record<string, Array<{ name: string; args: unknown }>>>({})
  const historyOffset = ref<Record<string, number>>({})
  const hasMore = ref<Record<string, boolean>>({})
  // owner: 该 session 当前写权限归属。'app' = Ease UI 持 stdin，
  // 'terminal' = 外部 claude -r 持 stdin（App 只读 jsonl）。
  // mode:  对应 Go 端 claude 进程启动模式，'stream' = --input-format
  // stream-json，'resume' = -r <sid>。
  const owner = ref<Record<string, 'app' | 'terminal'>>({})
  const mode  = ref<Record<string, 'stream' | 'resume'>>({})

  // 兼容层：v1 旧组件 (HomeView) 引用 terminalMode，#3 UI 改造后会彻底
  // 替换为 owner 检查。computed 缓存：owner 变化才重算。
  const terminalMode = computed<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const k of Object.keys(owner.value)) {
      out[k] = owner.value[k] === 'terminal'
    }
    return out
  })

  const active = computed(() => list.value.find((s) => s.id === activeId.value) ?? null)

  async function refresh() {
    list.value = await ListSessions()
    // 恢复持久化的会话状态
    try {
      const states = await GetSessionStates()
      for (const [id, st] of Object.entries(states)) {
        state.value = { ...state.value, [id]: st as SessionState }
      }
    } catch {}
  }

  async function create(workdir: string, prompt: string) {
    const id = await CreateSession(workdir, prompt)
    await refresh()
    activeId.value = id
    return id
  }

  function select(id: string) {
    activeId.value = id
    const meta = list.value.find((s) => s.id === id)
    if (meta && !messages.value[id]) {
      // 默认加载最后 PAGE_SIZE 条
      const total = meta.msg_count
      loadHistory(id, meta.workdir, Math.max(0, total - PAGE_SIZE), PAGE_SIZE, true)
    }
  }

  async function loadHistory(sid: string, workdir: string, offset: number, limit: number, isFirst: boolean) {
    try {
      const raw = await GetSessionMessages(sid, workdir, offset, limit)
      const msgs = (raw || []).map((m: any, i: number) => ({
        id: `${sid}-${offset + i}`,
        role: m.role || m.Role || 'assistant',
        content: formatContent(m.content || m.Content || ''),
        ts: Date.now() - ((raw?.length || 0) - i) * 1000,
      }))
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

  async function send(id: string, prompt: string) {
    const prev = messages.value[id] || []
    messages.value = { ...messages.value, [id]: [...prev, { id: crypto.randomUUID(), role: 'user', content: prompt, ts: Date.now() }] }
    streaming.value = { ...streaming.value, [id]: true }
    state.value = { ...state.value, [id]: 'running' }
    try {
      if (owner.value[id] === 'terminal') {
        // 外部终端控制中：让 Go 端先 kill 外部 claude + 起新 stream-json
        // 进程 + 写入 envelope(prompt)。返回后 owner/mode 已经是 app/stream。
        await SwitchOwner(id, 'app', prompt)
        owner.value = { ...owner.value, [id]: 'app' }
        mode.value  = { ...mode.value,  [id]: 'stream' }
      } else {
        // App 模式：直写（Send 走 v1 裸文本兼容路径，Claude 接受）
        await SendMessage(id, prompt)
      }
    } finally {
      streaming.value = { ...streaming.value, [id]: false }
    }
  }

  function handleEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }

    switch (evt.type) {
      case 'message': {
        const d = evt.data || evt
        const prev = messages.value[sid] || []
        messages.value = { ...messages.value, [sid]: [...prev, {
          id: crypto.randomUUID(),
          role: d.role,
          content: d.content || '',
          ts: Date.now(),
        }] }
        break
      }
      case 'tool_use': {
        const d = evt.data || evt
        const prev = toolBlocks.value[sid] || []
        toolBlocks.value = { ...toolBlocks.value, [sid]: [...prev, { name: d.name, args: d.args }] }
        break
      }
      case 'permission_request': {
        const d = evt.data || evt
        pending.value = { ...pending.value, [sid]: { tool: d.tool, args: d.args, reqId: d.request_id } }
        state.value = { ...state.value, [sid]: 'awaiting_permission' }
        break
      }
      case 'result':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        break
      case 'done':
        streaming.value = { ...streaming.value, [sid]: false }
        state.value = { ...state.value, [sid]: 'idle' }
        break
    }
  }

  // 处理来自 Go 端 hook server 的事件（SessionStart/SessionEnd/idle_timeout）
  function handleHookEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }
    switch (evt.type) {
      case 'SessionEnd':
        state.value = { ...state.value, [sid]: 'done' }
        // owner 仍标记为 terminal（外部 claude 退出，但下一次 send 仍会
        // 走切回 App 流程）。mode 保持 resume 便于 UI 判断。
        break
      case 'PreToolUse':
      case 'PostToolUse':
      case 'UserPromptSubmit':
        // 外部终端有活动，标记 owner=terminal（写权限在外部）+ mode=resume
        owner.value = { ...owner.value, [sid]: 'terminal' }
        mode.value  = { ...mode.value,  [sid]: 'resume' }
        break
      case 'idle_timeout':
        // 仅当不是 running/awaiting_permission 时才标记 idle
        if (state.value[sid] !== 'running' && state.value[sid] !== 'awaiting_permission') {
          state.value = { ...state.value, [sid]: 'idle' }
        }
        break
    }
  }

  return { list, activeId, active, messages, streaming, state, pending, toolBlocks,
    hasMore, owner, mode, terminalMode, refresh, create, select, send, handleEvent, handleHookEvent, loadMore }
})
