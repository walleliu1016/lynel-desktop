import { onMounted, onBeforeUnmount } from 'vue'
import { EventsOn } from './useWails'
import { useSessionsStore } from '../stores/sessions'
import { useAuthStore } from '../stores/auth'

export function useEventStream() {
  const sessions = useSessionsStore()
  const auth = useAuthStore()
  const cleanups: Array<() => void> = []

  onMounted(() => {
    // Generic app-level events
    cleanups.push(EventsOn('app:toast', (level: string, message: string) => {
      console.log('[toast]', level, message)
    }))
    cleanups.push(EventsOn('app:fatal', (msg: string) => {
      console.error('[fatal]', msg)
    }))
  })

  onBeforeUnmount(() => {
    cleanups.forEach((fn) => fn())
  })

  return { sessions, auth }
}
