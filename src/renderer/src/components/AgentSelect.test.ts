// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import AgentSelect from './AgentSelect.vue'
import { useSettingsStore } from '../stores/settings'
import { GetSettings } from '../composables/useElectron'

vi.mock('../composables/useElectron', () => ({
  GetSettings: vi.fn(),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
}))

const SelectStub = {
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<div class="sel-stub" :data-count="options.length">{{ modelValue }}</div>`,
}

describe('AgentSelect 可用 agent 过滤', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认仅展示 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    const w = mount(AgentSelect, { props: { modelValue: 'claude' }, global: { stubs: { Select: SelectStub } } })
    expect(w.find('.sel-stub').attributes('data-count')).toBe('1')
  })

  it('选中 agent 被禁用后回退 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue({ codex_enabled: true } as any)
    const store = useSettingsStore()
    await store.load()
    const w = mount(AgentSelect, { props: { modelValue: 'codex' }, global: { stubs: { Select: SelectStub } } })
    expect(w.find('.sel-stub').attributes('data-count')).toBe('2')
    store.cfg!.codex_enabled = false
    await w.vm.$nextTick()
    expect(w.emitted('update:modelValue')).toBeTruthy()
    expect(w.emitted('update:modelValue')![0]).toEqual(['claude'])
    expect(w.find('.sel-stub').attributes('data-count')).toBe('1')
  })
})
