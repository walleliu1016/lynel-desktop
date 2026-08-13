import { computed, ref, watch, onUnmounted, getCurrentInstance } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useSessionsStore } from '../stores/sessions'
import { useTraceStore } from '../stores/trace'
import { useSettingsStore } from '../stores/settings'
import { getBuddyRole } from '../data/buddies/presets'
import { applyEvent, createStats, decay, resetToBaseline, type StatEventKind } from '../data/buddies/buddyStats'
import type { BuddyRole, BuddyStats } from '../data/buddies/types'
import type { SessionState } from '../types/session'

/**
 * Buddy 属性引擎：监听 sessions/trace store，把会话事件映射为属性增量。
 * 会话独立：sessionId 变化时归零回角色基线。
 * 供 BuddyPet 组件挂载后调用 startDecay() 启动无事件衰减、stopDecay() 清理。
 */
export function useBuddyStats(sessionIdRef: () => string | null) {
  const sessions = useSessionsStore()
  const trace = useTraceStore()
  const settings = useSettingsStore()

  const role: ComputedRef<BuddyRole> = computed(() => {
    const id = settings.cfg?.buddyRoleId || 'duck'
    return getBuddyRole(id)
  })

  const stats: Ref<BuddyStats> = ref(createStats(role.value.baseline))

  // 从当前值起步，避免组件挂载时已有历史请求被一次性重复计入
  let lastRequestCount = trace.requests.length
  let lastErrorCount = trace.errorCount

  /**
   * 幂等重新基线：用 trace 当前实际条数校准计数。
   * trace.setSession 会先清空 requests 再异步回填首页，若按长度 slice 增量，
   * 回填的整页数据会被误判为「新增」触发虚假 request 事件。重新基线后，
   * 只有真正新增/追加的条目才会触发事件。
   */
  function rebaselineCounters() {
    lastRequestCount = trace.requests.length
    lastErrorCount = trace.errorCount
  }

  /** 会话切换归零回基线 + 按 trace 当前实际条数重新基线（而非硬编码 0） */
  watch(sessionIdRef, () => {
    stats.value = resetToBaseline(role.value.baseline)
    rebaselineCounters()
  })

  /** trace store 切换会话时同步重新基线，与 sessionIdRef watch 形成双保险（幂等） */
  watch(
    () => trace.sessionId,
    () => {
      rebaselineCounters()
    },
  )

  /** sessions state → 属性增量（awaiting→patience，done→归零） */
  watch(
    () => (sessionIdRef() ? sessions.state[sessionIdRef()!] : undefined),
    (st: SessionState | undefined) => {
      if (!st) return
      if (st === 'awaiting_permission') {
        stats.value = applyEvent(stats.value, 'awaiting')
      } else if (st === 'done' || st === 'ended') {
        stats.value = applyEvent(stats.value, 'done')
        stats.value = resetToBaseline(role.value.baseline)
      } else if (st === 'idle' && stats.value.patience > role.value.baseline.patience) {
        // 等待审批解除：patience 保留，仅停止累加
      }
    },
  )

  /** trace 增量 → 成功的请求走 request，错误请求交给 errorCount 观察器（避免双计） */
  watch(
    () => trace.requests.length,
    (n) => {
      // 清空/缩水时重新基线到当前条数，不触发（trace.setSession 切换会话会先清空 requests）
      if (n < lastRequestCount) {
        lastRequestCount = n
        return
      }
      if (n <= lastRequestCount) return
      const added = trace.requests.slice(lastRequestCount, n)
      const ok = added.some((r) => !r.error && r.status < 400)
      if (ok) stats.value = applyEvent(stats.value, 'request')
      lastRequestCount = n
    },
  )

  /** trace 错误数增量 → error（提升 debugging/chaos） */
  watch(
    () => trace.errorCount,
    (n) => {
      // 清空/缩水时重新基线到当前值，不触发（trace.setSession 切换会话会先清空 requests，errorCount 随之回落）
      if (n < lastErrorCount) {
        lastErrorCount = n
        return
      }
      if (n <= lastErrorCount) return
      lastErrorCount = n
      stats.value = applyEvent(stats.value, 'error')
    },
  )

  /** 手动触发一次事件（如外部 done 信号） */
  function emitKind(k: StatEventKind) {
    stats.value = applyEvent(stats.value, k)
    if (k === 'done') stats.value = resetToBaseline(role.value.baseline)
  }

  /** 手动归零（会话切换兜底） */
  function reset() {
    stats.value = resetToBaseline(role.value.baseline)
  }

  let timer: ReturnType<typeof setInterval> | null = null

  /** 无事件衰减：默认 30s 一次向基线回落 */
  function startDecay(intervalMs = 30_000) {
    stopDecay()
    timer = setInterval(() => {
      stats.value = decay(stats.value, role.value.baseline)
    }, intervalMs)
  }

  function stopDecay() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // 组件挂载时注册清理；测试（无组件实例）时跳过，避免生命周期警告
  if (getCurrentInstance()) onUnmounted(stopDecay)

  return { role, stats, emitKind, reset, startDecay, stopDecay }
}
