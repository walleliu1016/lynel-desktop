// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import { GetSettings } from '../composables/useElectron'

vi.mock('../composables/useElectron', () => ({
  GetSettings: vi.fn(),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('settings store 可用 agent 推导', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('cfg 未加载时仅 claude', () => {
    const store = useSettingsStore()
    expect(store.enabledAgentKinds).toEqual(['claude'])
    expect(store.isAgentEnabled('claude')).toBe(true)
    expect(store.isAgentEnabled('codex')).toBe(false)
  })

  it('默认设置（全关）仅 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    expect(store.enabledAgentKinds).toEqual(['claude'])
  })

  it('开启后逐个加入可用列表', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    store.cfg!.codex_enabled = true
    expect(store.enabledAgentKinds).toEqual(['claude', 'codex'])
    expect(store.isAgentEnabled('opencode')).toBe(false)
    store.cfg!.opencode_enabled = true
    store.cfg!.omp_enabled = true
    expect(store.enabledAgentKinds).toEqual(['claude', 'codex', 'opencode', 'omp'])
  })
})
