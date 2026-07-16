import { onMounted, onBeforeUnmount, watch } from 'vue'
import { EventsOn } from './useElectron'
import { useSessionsStore } from '../stores/sessions'
import { showToast } from './useToast'
import type { SessionState } from '../types/session'

export function useEventStream() {
  const sessions = useSessionsStore()
  const cleanups: Array<() => void> = []
  let hookCleanup: (() => void) | null = null

  onMounted(() => {
    cleanups.push(EventsOn('app:toast', (level: string, message: string) => {
      showToast(message, level === 'error' ? 'error' : 'success')
    }))
    cleanups.push(EventsOn('app:fatal', (msg: string) => {
      console.error('[fatal]', msg)
    }))

    // 后端 fsnotify 监听 jsonl 变化后推送 → 重载当前 session 消息。
    cleanups.push(EventsOn('sessions:list:changed', () => {
      if (sessions.activeId) {
        void sessions.reloadFromJsonl(sessions.activeId)
      }
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

    // 主进程会话状态变化实时同步到 store，保证标题栏运行中数量准确。
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

    cleanups.push(EventsOn('permission:request', (payload: string) => {
      let req: any
      try { req = JSON.parse(payload) } catch { return }
      if (!req?.sessionId || !req?.requestId) return
      sessions.setHookPermission(req.sessionId, req)
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
  })

  onBeforeUnmount(() => {
    hookCleanup?.()
    cleanups.forEach((fn) => fn())
  })

  return { sessions }
}
