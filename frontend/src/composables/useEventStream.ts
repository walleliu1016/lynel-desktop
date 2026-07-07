import { onMounted, onBeforeUnmount, watch } from 'vue'
import { EventsOn } from './useElectron'
import { useSessionsStore } from '../stores/sessions'
import { showToast } from './useToast'

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

    // 后端 fsnotify 监听 jsonl 变化后推送 → 刷新列表 + 重载当前 session 消息。
    cleanups.push(EventsOn('sessions:list:changed', () => {
      void sessions.refresh({ sort: false })
      if (sessions.activeId) {
        void sessions.reloadFromJsonl(sessions.activeId)
      }
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
