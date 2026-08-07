import { ref } from 'vue'

export type ToastLevel = 'error' | 'warn' | 'info'

export interface ToastItem {
  id: string
  level: ToastLevel
  source: string
  message: string
  createdAt: number
  duration: number
  /** 剩余毫秒数：被 hover 暂停时使用 */
  remaining: number
  /** 是否被 hover 暂停倒计时 */
  paused: boolean
  /** 同 source+message 1s 内去重 */
  dedupeKey?: string
  /** 点击 toast 时触发（关闭按钮除外） */
  onClick?: () => void
}

export interface PushToastInput {
  level: ToastLevel
  source: string
  message: string
  /** 自动关闭毫秒数；0 表示不自动关闭 */
  duration?: number
  /** 点击 toast 时触发（关闭按钮除外） */
  onClick?: () => void
}

const items = ref<ToastItem[]>([])
const timers = new Map<string, { startedAt: number; duration: number; timeout: ReturnType<typeof setTimeout> }>()
const lastSeen = new Map<string, number>()

const DEFAULT_DURATION = 5000
const MAX_ITEMS = 6
const DEDUPE_WINDOW = 1000

let counter = 0
function nextId() {
  counter += 1
  return `t-${Date.now()}-${counter}`
}

function startTimer(id: string, duration: number) {
  if (duration <= 0) return
  stopTimer(id)
  const startedAt = Date.now()
  const timeout = setTimeout(() => {
    dismissToast(id)
  }, duration)
  timers.set(id, { startedAt, duration, timeout })
}

function stopTimer(id: string) {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t.timeout)
    timers.delete(id)
  }
}

function pauseTimer(id: string) {
  const item = items.value.find((x) => x.id === id)
  if (!item || item.paused) return
  const t = timers.get(id)
  if (!t) return
  clearTimeout(t.timeout)
  const elapsed = Date.now() - t.startedAt
  item.remaining = Math.max(0, t.duration - elapsed)
  item.paused = true
}

function resumeTimer(id: string) {
  const item = items.value.find((x) => x.id === id)
  if (!item || !item.paused) return
  item.paused = false
  if (item.remaining > 0) {
    startTimer(id, item.remaining)
  } else {
    dismissToast(id)
  }
}

export function pushToast(input: PushToastInput): string {
  const level: ToastLevel = input.level
  const source = input.source || 'system'
  const message = String(input.message ?? '').slice(0, 500)
  const duration = input.duration ?? DEFAULT_DURATION

  const key = `${level}|${source}|${message}`
  const now = Date.now()
  const last = lastSeen.get(key)
  if (last && now - last < DEDUPE_WINDOW) {
    return ''
  }
  lastSeen.set(key, now)
  if (lastSeen.size > 200) {
    const cutoff = now - DEDUPE_WINDOW
    for (const [k, t] of lastSeen) {
      if (t < cutoff) lastSeen.delete(k)
    }
  }

  const id = nextId()
  const item: ToastItem = {
    id,
    level,
    source,
    message,
    createdAt: now,
    duration,
    remaining: duration,
    paused: false,
    dedupeKey: key,
    onClick: input.onClick,
  }
  items.value = [item, ...items.value]
  if (items.value.length > MAX_ITEMS) {
    const removed = items.value.splice(MAX_ITEMS)
    for (const r of removed) {
      stopTimer(r.id)
    }
  }
  if (duration > 0) startTimer(id, duration)
  return id
}

export function dismissToast(id: string): void {
  stopTimer(id)
  items.value = items.value.filter((x) => x.id !== id)
}

export function dismissAll(): void {
  for (const id of Array.from(timers.keys())) {
    stopTimer(id)
  }
  items.value = []
}

/** hover 时由组件调用，暂停该条的倒计时 */
export function pauseToast(id: string): void {
  pauseTimer(id)
}

/** mouseleave 时由组件调用，恢复倒计时 */
export function resumeToast(id: string): void {
  resumeTimer(id)
}

export function useToastState() {
  return { items, dismiss: dismissToast, dismissAll }
}

/**
 * 兼容旧 API：showToast(msg, 'success'|'error', duration)
 * 内部映射为 info/error。已无外部调用，保留以防 import 遗漏。
 * @deprecated 请改用 pushToast
 */
export function showToast(msg: string, kind: 'success' | 'error' = 'success', duration = 2000): void {
  pushToast({
    level: kind === 'error' ? 'error' : 'info',
    source: 'app',
    message: msg,
    duration,
  })
}
