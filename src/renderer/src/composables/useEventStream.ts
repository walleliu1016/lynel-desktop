import { onMounted, onBeforeUnmount, watch } from 'vue'
import { EventsOn } from './useElectron'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import { useRecentStore } from '../stores/recent'
import { pushToast, type ToastLevel } from './useToast'
import type { SessionState } from '../types/session'

export function useEventStream() {
  const sessions = useSessionsStore()
  const tabs = useTabsStore()
  const recent = useRecentStore()
  const cleanups: Array<() => void> = []
  let hookCleanup: (() => void) | null = null

  onMounted(() => {
    cleanups.push(EventsOn('app:toast', (...args: any[]) => {
      // 新 payload: 单一 JSON 字符串 { level, source, message, duration? }
      if (args.length === 1 && typeof args[0] === 'string') {
        try {
          const obj = JSON.parse(args[0])
          if (obj && typeof obj === 'object' && 'level' in obj && 'message' in obj) {
            pushToast({
              level: (['error', 'warn', 'info'].includes(obj.level) ? obj.level : 'error') as ToastLevel,
              source: String(obj.source ?? 'main'),
              message: String(obj.message ?? ''),
              duration: typeof obj.duration === 'number' ? obj.duration : undefined,
            })
            return
          }
        } catch { /* fall through to legacy */ }
      }
      // 兼容旧 (level, message) 两参数
      const [level, message] = args
      pushToast({
        level: level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info',
        source: 'main',
        message: String(message ?? ''),
      })
    }))
    cleanups.push(EventsOn('app:fatal', (msg: string) => {
      console.error('[fatal]', msg)
    }))

    // 后端 fsnotify 监听 jsonl 变化后推送 → 刷新列表（msg_count 等）。
    cleanups.push(EventsOn('sessions:list:changed', () => {
      void sessions.refreshList()
    }))

    // 企业微信 /create 等外部入口创建会话后，同步到会话列表并自动打开。
    cleanups.push(EventsOn('session:created', (payload: string) => {
      try {
        const data = JSON.parse(payload)
        if (sessions.list.find((s) => s.id === data.id)) return
        const meta = {
          id: data.id,
          workdir: data.workDir,
          project: data.project,
          mtime: Math.floor(Date.now() / 1000),
          msg_count: 0,
          first_prompt: data.prompt || '',
          ai_title: '',
          size: 0,
          title_source: 'first_prompt' as const,
        }
        sessions.list = [meta, ...sessions.list]
        sessions.activeId = data.id
        tabs.openSession(data.id, data.workDir, sessionDisplayTitle(meta))
        void sessions.select(data.id)
      } catch {}
    }))

    const ACTIVITY_PHASE_TO_STATE: Record<string, SessionState> = {
      thinking: 'thinking',
      working: 'running_tool',
      streaming: 'streaming',
      awaiting_permission: 'awaiting_permission',
      idle: 'idle',
    }

    function isActiveGranularState(s: SessionState | undefined): boolean {
      return s === 'thinking' || s === 'streaming' || s === 'running_tool'
    }

    // 主进程会话活动实时同步到 store，提供 thinking/streaming/running_tool 等粒度状态。
    // 权限等待状态下不允许 activity 事件覆盖（PreToolUse/Notification 等 hook 可能
    // 在 PermissionRequest 之后到达，通过 EventBus 直接发 activity，不走 ChannelDispatcher）。
    cleanups.push(EventsOn('sessions:activity', (payload: string) => {
      try {
        const data = JSON.parse(payload)
        const mapped = ACTIVITY_PHASE_TO_STATE[data.phase]
        if (mapped && data.sessionId) {
          const current = sessions.state[data.sessionId]
          if (current === 'awaiting_permission' && mapped !== 'awaiting_permission') return
          sessions.state = { ...sessions.state, [data.sessionId]: mapped }
        }
      } catch { /* 忽略格式错误 */ }
    }))

    // 主进程会话状态变化实时同步到 store，用于会话列表状态展示。
    cleanups.push(EventsOn('sessions:state:changed', (id: string, st: string) => {
      const current = sessions.state[id]
      let normalized: SessionState
      if (st === 'running') {
        normalized = isActiveGranularState(current) ? current! : 'waiting'
      } else {
        normalized = st as SessionState
      }
      sessions.state = { ...sessions.state, [id]: normalized }
    }))

    // 标题变化（ai-title / custom-title / 用户 rename）实时同步到 store。
    cleanups.push(EventsOn('session:title:changed', (id: string, title: string, source: 'user' | 'ai' | 'first_prompt') => {
      sessions.applyTitleChange(id, title, source)
    }))

    // Claude /clear 后主进程把 PTY 迁移到新 sessionId：更新 store key 与当前 tab 的 sessionId，
    // tab 的 :key 变化会重挂载 XtermTerminal 自动重连到新会话。
    cleanups.push(EventsOn('session:rebound', (payload: string) => {
      try {
        const data = JSON.parse(payload)
        if (!data?.oldId || !data?.newId) return
        sessions.applyRebind(data.oldId, data.newId, data.workDir)
        // /clear 后是全新会话，用新 meta 的标题（清空继承后回退到项目/id），
        // 不再沿用旧会话标题；新标题生成后由 refreshList / session:title:changed 更新。
        const newMeta = sessions.list.find((s) => s.id === data.newId)
        const title = newMeta ? sessionDisplayTitle(newMeta) : undefined
        tabs.rebindSession(data.oldId, data.newId, data.workDir, title)
        // /clear 后主进程已更新 recent-sessions.json（新会话 id 置顶），重新拉取让
        // "最近会话 / 历史会话"列表同步；否则历史面板还停留在旧状态。
        void recent.loadRecentSessions()
      } catch { /* 忽略格式错误 */ }
    }))

    cleanups.push(EventsOn('permission:request', (payload: string) => {
      let req: any
      try { req = JSON.parse(payload) } catch { return }
      if (!req?.sessionId || !req?.id) return
      sessions.setHookPermission(req.sessionId, req)
    }))

    // 权限在其他渠道（终端/企业微信/灵动岛）被处理后，清除本地权限 UI 与等待状态。
    cleanups.push(EventsOn('permission:cancelled', (payload: string) => {
      let data: any
      try { data = JSON.parse(payload) } catch { return }
      if (!data?.sessionId) return
      sessions.setHookPermission(data.sessionId, null)
    }))

    watch(
      () => sessions.activeId,
      (newId, oldId) => {
        if (oldId) {
          hookCleanup?.()
          hookCleanup = null
        }
        if (newId) {
          hookCleanup = EventsOn(`hook:${newId}`, (line: string) => {
            sessions.handleHookEvent(newId, line)
          })
        }
      },
      { immediate: true }
    )

    // 通知 / 托盘点击：恢复 + 聚焦主窗口 + 切到对应 session tab
    cleanups.push(EventsOn('attention:focus-session', (payload: string) => {
      try {
        const data = JSON.parse(payload)
        const sessionId: string | undefined = data?.sessionId
        if (!sessionId) return
        const meta = sessions.list.find((s) => s.id === sessionId)
        const workDir = data?.workDir || meta?.workdir || ''
        const title = meta ? sessionDisplayTitle(meta) : undefined
        tabs.openSession(sessionId, workDir, title)
        void sessions.select(sessionId)
      } catch (e) {
        console.error('[attention] focus-session parse failed:', e)
      }
    }))
  })

  onBeforeUnmount(() => {
    hookCleanup?.()
    cleanups.forEach((fn) => fn())
  })

  return { sessions }
}
