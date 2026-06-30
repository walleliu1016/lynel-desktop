import { onMounted, onBeforeUnmount, watch } from 'vue'
import { EventsOn, WindowShow, WindowUnminimise, WindowSetAlwaysOnTop, WindowIsMinimised } from './useWails'
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
      // 如果窗口不在前台或最小化，给出提示并尝试唤起窗口
      void bringWindowToFront()
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

async function bringWindowToFront() {
  try {
    const minimised = await WindowIsMinimised().catch(() => false)
    if (!minimised) return
    WindowUnminimise()
    WindowShow()
    WindowSetAlwaysOnTop(true)
    setTimeout(() => {
      try { WindowSetAlwaysOnTop(false) } catch {}
    }, 200)
  } catch {
    // runtime 不可用（如浏览器 dev）时静默忽略
  }
}
