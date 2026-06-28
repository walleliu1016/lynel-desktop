import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionMeta, ChatMessage, SessionState } from '../types/session'
import { ListSessions, CreateSession, SendMessage, GetSessionMessages, GetSessionStates, SwitchOwner, AdoptSession } from '../composables/useWails'

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
  // adopted: 标记 sid 已在 Go 端 a.sessions map 注册（CreateSession
  // 或 AdoptSession 后置 true）。send() 时按需 AdoptSession 拉起
  // stream-json 进程接管历史 session。
  const adopted = ref<Record<string, boolean>>({})
  // 每个 session 独立的输入草稿，切换 session 时保留未发送的内容
  const drafts = ref<Record<string, string>>({})

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
    // CreateSession 后 Go 端已在 a.sessions map 注册，标记 adopted
    // 避免 send() 重复走 AdoptSession 路径
    adopted.value = { ...adopted.value, [id]: true }
    owner.value = { ...owner.value, [id]: 'app' }
    mode.value  = { ...mode.value,  [id]: 'stream' }
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

  // 从 jsonl 重新加载当前 session 的消息。jsonl 是唯一数据源，
  // 新消息（用户输入和 assistant 回复）都从 jsonl 读取后直接替换 messages[sid]。
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
        role: m.role || m.Role || 'assistant',
        content: formatContent(m.content || m.Content || ''),
        ts: Date.now() - ((raw?.length || 0) - i) * 1000,
      }))
      historyOffset.value = { ...historyOffset.value, [sid]: offset + (raw?.length || 0) }
      hasMore.value = { ...hasMore.value, [sid]: offset > 0 }
      messages.value = { ...messages.value, [sid]: msgs }
    } catch (e: any) {
      console.error('[sessions] reloadFromJsonl failed:', e?.message || e)
    }
  }

  // send 只负责将 prompt 写入 claude stdin，不修改 messages。
  // 消息展示完全由 jsonl 驱动：claude 写入 jsonl → fsnotify → reloadFromJsonl → UI 更新。
  async function send(id: string, prompt: string) {
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
        // App 模式：每次 send 都调 AdoptSession。Go 端会在 session 已注册 +
        // proc 还活着时走幂等 noop；session 已注册但 proc=nil 时自动重新拉
        // （之前我手动 kill 进程后会卡住的情况）。前端 adopted 状态由 Go 端
        // 决定，不再前端缓存。
        const meta = list.value.find((s) => s.id === id)
        if (!meta) throw new Error('session not found in list')
        await AdoptSession(id, meta.workdir)
        owner.value = { ...owner.value, [id]: 'app' }
        mode.value  = { ...mode.value,  [id]: 'stream' }
        // 直写（Send 走 v1 裸文本兼容路径，Claude 接受）
        try {
          await SendMessage(id, prompt)
        } catch (e: any) {
          // 后端 SendMessage 失败时让 Go 端处理 proc 状态重置；前端不再缓存
          // adopted，避免 proc=nil 时的死循环。
          throw e
        }
      }
    } finally {
      streaming.value = { ...streaming.value, [id]: false }
    }
  }

  function handleEvent(sid: string, line: string) {
    let evt: any
    try { evt = JSON.parse(line) } catch { return }

    switch (evt.type) {
      // Claude CLI stream-json 实际输出的类型是 "assistant" / "user"，
      // 消息体在 evt.message 中，content 可能是字符串或 content block 数组。
      // 之前只处理 "message" 类型（protocol 包的定义），跟 Claude 实际输出
      // 不匹配，导致所有实时事件被静默丢弃。
      case 'assistant':
      case 'user': {
        const msg = evt.message
        if (!msg) break
        const prev = messages.value[sid] || []
        // 用消息 id 去重：同一轮 assistant 可能通过 stream_event 多次推送
        const msgId = msg.id
        if (msgId && prev.some(m => (m as any).msgId === msgId)) break
        messages.value = { ...messages.value, [sid]: [...prev, {
          id: crypto.randomUUID(),
          msgId,
          role: msg.role || 'assistant',
          content: formatContent(msg.content),
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
        adopted.value = { ...adopted.value, [sid]: false }
        // stream-json 进程退出时，如果 stdout 管道没有数据（或数据不完整），
        // 从 jsonl 重新加载最新消息。这对于 claude 在 .app bundle 里 stdout
        // 不产出但 jsonl 正常写入的情况至关重要。
        reloadFromJsonl(sid)
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

  function setDraft(sid: string, text: string) {
    drafts.value = { ...drafts.value, [sid]: text }
  }

  return { list, activeId, active, messages, streaming, state, pending, toolBlocks,
    hasMore, owner, mode, adopted, drafts, setDraft, refresh, create, select, send,
    reloadFromJsonl, handleEvent, handleHookEvent, loadMore }
})
