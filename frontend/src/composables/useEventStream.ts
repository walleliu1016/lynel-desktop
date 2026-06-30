import { onMounted, onBeforeUnmount, watch } from 'vue'
import { EventsOn } from './useWails'
import { useSessionsStore } from '../stores/sessions'

export function useEventStream() {
  const sessions = useSessionsStore()
  const cleanups: Array<() => void> = []
  let sessionCleanup: (() => void) | null = null
  let hookCleanup: (() => void) | null = null

  onMounted(() => {
    cleanups.push(EventsOn('app:toast', (level: string, message: string) => {
      console.log('[toast]', level, message)
    }))
    cleanups.push(EventsOn('app:fatal', (msg: string) => {
      console.error('[fatal]', msg)
    }))

    // 后端 fsnotify 监听 jsonl 变化后推送 → 刷新列表 + 重载当前 session 消息。
    // jsonl 是唯一数据源，不依赖乐观更新，无论 App/Terminal 模式都走这条路径。
    cleanups.push(EventsOn('sessions:list:changed', () => {
      // jsonl 写入会频繁触发该事件；背景刷新只更新字段、新增插到最前，
      // 不要按 mtime 重排，否则聊天时左侧列表会不断闪烁/跳动。
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
      // 不主动弹出主窗口；后台通过系统通知 + 任务栏闪烁提醒用户，
      // 用户点击通知或托盘图标后再自行处理。
    }))

    watch(
      () => sessions.activeId,
      (newId, oldId) => {
        if (oldId) {
          sessionCleanup?.()
          hookCleanup?.()
          sessionCleanup = null
          hookCleanup = null
        }
        if (newId) {
          sessionCleanup = EventsOn(`session:${newId}`, (line: string) => {
            sessions.handleEvent(newId, line)
          })
          hookCleanup = EventsOn(`hook:${newId}`, (line: string) => {
            sessions.handleHookEvent(newId, line)
          })
        }
      },
      { immediate: true }
    )
  })

  onBeforeUnmount(() => {
    sessionCleanup?.()
    hookCleanup?.()
    cleanups.forEach((fn) => fn())
  })

  return { sessions }
}
