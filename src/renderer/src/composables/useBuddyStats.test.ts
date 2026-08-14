// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { useBuddyStats } from './useBuddyStats'
import { useSessionsStore } from '../stores/sessions'
import { useTraceStore } from '../stores/trace'
import { getBuddySpecies } from '../data/buddies/presets'
import { rollSpeciesStats } from '../data/buddies/rarity'

// mock IPC 转发层，避免依赖 window.electronAPI（路径从 composables 目录回到 useElectron）
vi.mock('../composables/useElectron', () => ({
  GetSettings: vi.fn().mockResolvedValue(null),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
  ListSessions: vi.fn().mockResolvedValue([]),
  AdoptSession: vi.fn().mockResolvedValue(undefined),
  CreateSession: vi.fn(),
  SendMessage: vi.fn(),
  RenameSession: vi.fn(),
  BindSessionBot: vi.fn(),
  GetSessionBotBinding: vi.fn(),
  ListBots: vi.fn().mockResolvedValue([]),
  ListBotBindings: vi.fn().mockResolvedValue({}),
  ListTraceRequests: vi.fn().mockResolvedValue([]),
  GetTraceRequest: vi.fn(),
  DiffTraceRequests: vi.fn(),
  ExportTraceRequest: vi.fn(),
  WatchTraceSession: vi.fn().mockResolvedValue(undefined),
  UnwatchTraceSession: vi.fn().mockResolvedValue(undefined),
  EventsOn: vi.fn(() => vi.fn()),
}))

/** duck 稀有度驱动属性基线（确定性） */
const duckBase = rollSpeciesStats(getBuddySpecies('duck'))

/** 构造一条成功请求摘要（request 事件只 +debugging 0.1 / wisdom 0.4） */
function okReq(seq: number) {
  return { seq, ts: 0, model: null, status: 200, latencyMs: 0, error: false,
    cost: { usd: 0, input: 0, output: 0 }, trace: { totalMs: 0, ttftMs: 0, genMs: 0 }, toolCount: 0 }
}

describe('useBuddyStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('默认用 duck 物种、稀有度驱动基线起步', () => {
    const sid = () => 's1'
    const { role, stats } = useBuddyStats(sid)
    expect(role.value.id).toBe('duck')
    expect(stats.value.debugging).toBe(duckBase.debugging)
  })

  it('会话状态 awaiting_permission 提升 patience', async () => {
    const sessions = useSessionsStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    sessions.state = { ...sessions.state, s1: 'awaiting_permission' }
    await nextTick()
    expect(stats.value.patience).toBe(duckBase.patience + 0.5)
  })

  it('会话结束 done 后 reset 回基线', async () => {
    const sessions = useSessionsStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    sessions.state = { ...sessions.state, s1: 'done' }
    await nextTick()
    expect(stats.value.patience).toBe(duckBase.patience) // 归零回基线
    expect(stats.value.snark).toBe(duckBase.snark)
  })

  it('trace 出现错误提升 debugging 与 chaos', async () => {
    const trace = useTraceStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    trace.requests = [
      { seq: 1, ts: 0, model: null, status: 500, latencyMs: 0, error: true,
        cost: { usd: 0, input: 0, output: 0 }, trace: { totalMs: 0, ttftMs: 0, genMs: 0 }, toolCount: 0 },
    ]
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.5)
    expect(stats.value.chaos).toBe(duckBase.chaos + 0.2)
  })

  it('errorCount 缩水（清空）重新基线且不触发 error 事件', async () => {
    const trace = useTraceStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    // 一次真实错误 → debugging +0.5 / chaos +0.2
    trace.requests = [
      { seq: 1, ts: 0, model: null, status: 500, latencyMs: 0, error: true,
        cost: { usd: 0, input: 0, output: 0 }, trace: { totalMs: 0, ttftMs: 0, genMs: 0 }, toolCount: 0 },
    ]
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.5)
    expect(stats.value.chaos).toBe(duckBase.chaos + 0.2)
    // 清空模拟 trace.setSession 切会话：errorCount 缩水重新基线，不触发 error
    trace.requests = []
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.5)
    expect(stats.value.chaos).toBe(duckBase.chaos + 0.2)
  })

  it('startDecay 到点衰减，stopDecay 停止', async () => {
    const sid = () => 's1'
    const { stats, startDecay, stopDecay } = useBuddyStats(sid)
    const before = stats.value.debugging
    // 手动推高，便于观察衰减
    stats.value = { ...stats.value, debugging: 90 }
    startDecay(1000)
    vi.advanceTimersByTime(2000)
    expect(stats.value.debugging).toBeLessThan(90)
    stopDecay()
    const after = stats.value.debugging
    vi.advanceTimersByTime(3000)
    expect(stats.value.debugging).toBe(after)
  })

  it('requests 清空（setSession 缩水分支）重新基线且不触发 request 事件', async () => {
    const trace = useTraceStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    // 先推进 lastRequestCount：一次真实 request
    trace.requests = [okReq(1)]
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1)
    // 清空模拟 trace.setSession 切会话：缩水分支重新基线，不触发
    trace.requests = []
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1)
  })

  it('sessionId 切换时按 trace 当前实际条数重新基线，已有请求不重复计入', async () => {
    const trace = useTraceStore()
    // 用 ref 模拟响应式的 props.sessionId（真实组件中 props 是响应式的，普通变量不触发 watch）
    const sid = ref<string | null>('s1')
    const { stats } = useBuddyStats(() => sid.value)
    // s1 已加载 50 条 → 触发一次真实 request，lastRequestCount 推进到 50
    trace.requests = Array.from({ length: 50 }, (_, i) => okReq(i + 1))
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1)
    // 切到 s2：此时 trace 已含 s2 数据（模拟已加载会话被重新打开）→ 按实际条数重新基线
    trace.requests = Array.from({ length: 50 }, (_, i) => okReq(i + 100))
    sid.value = 's2'
    await nextTick()
    // stats 归零回基线；这 50 条因重新基线不触发 request
    expect(stats.value.debugging).toBe(duckBase.debugging)
    // 后续真实追加一条 → 只触发一次
    trace.requests = [...Array.from({ length: 50 }, (_, i) => okReq(i + 100)), okReq(200)]
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1)
  })

  it('trace.sessionId 切换清空后重新基线，后续真实增量只触发一次', async () => {
    const trace = useTraceStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    trace.requests = [okReq(1)]
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1)
    // trace.setSession 清空 requests + 切换 sessionId：缩水分支与 sessionId watch 双保险
    trace.setSession('wd2', 's2')
    await nextTick()
    expect(stats.value.debugging).toBe(duckBase.debugging + 0.1) // 清空不触发
    // 新会话真实回填 2 条 → 作为一批只触发一次 request
    trace.requests = [okReq(2), okReq(3)]
    await nextTick()
    expect(stats.value.debugging).toBeCloseTo(duckBase.debugging + 0.2, 5)
  })
})
