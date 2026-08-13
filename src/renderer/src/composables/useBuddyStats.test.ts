// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useBuddyStats } from './useBuddyStats'
import { useSessionsStore } from '../stores/sessions'
import { useTraceStore } from '../stores/trace'
import { useSettingsStore } from '../stores/settings'

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
  WatchTraceSession: vi.fn(),
  UnwatchTraceSession: vi.fn(),
  EventsOn: vi.fn(() => vi.fn()),
}))

describe('useBuddyStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('默认用 duck 角色、基线起步', () => {
    const sid = () => 's1'
    const { role, stats } = useBuddyStats(sid)
    expect(role.value.id).toBe('duck')
    expect(stats.value.debugging).toBe(40) // duck baseline
  })

  it('会话状态 awaiting_permission 提升 patience', async () => {
    const sessions = useSessionsStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    sessions.state = { ...sessions.state, s1: 'awaiting_permission' }
    await nextTick()
    expect(stats.value.patience).toBe(70.5) // duck baseline 70 + 0.5
  })

  it('会话结束 done 后 reset 回基线', async () => {
    const sessions = useSessionsStore()
    const sid = () => 's1'
    const { stats } = useBuddyStats(sid)
    sessions.state = { ...sessions.state, s1: 'done' }
    await nextTick()
    expect(stats.value.patience).toBe(70) // 归零回 baseline
    expect(stats.value.snark).toBe(30)
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
    expect(stats.value.debugging).toBe(40.5)
    expect(stats.value.chaos).toBe(20.2)
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
})
