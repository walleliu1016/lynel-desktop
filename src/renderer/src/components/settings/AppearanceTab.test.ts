// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import AppearanceTab from './AppearanceTab.vue'
import { useSettingsStore } from '../../stores/settings'
import { GetSettings } from '../../composables/useElectron'

// mock IPC 转发层，避免依赖 window.electronAPI（路径从 components/settings 回到 useElectron）
vi.mock('../../composables/useElectron', () => ({
  GetSettings: vi.fn(),
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

/** 简化 Switch：点击时切 modelValue 并触发 change（与原组件 toggle 语义一致） */
const SwitchStub = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: `<button type="button" class="switch-stub" @click="$emit('update:modelValue', !modelValue); $emit('change')">{{ String(modelValue) }}</button>`,
}

/** 简化 Select：展示当前 modelValue；点击发出固定目标值 cat（测试只点第 3 个角色下拉） */
const SelectStub = {
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<div class="select-stub" :data-model="modelValue"><button type="button" @click="$emit('update:modelValue', 'cat')">cat</button></div>`,
}

describe('AppearanceTab buddy 取消回滚', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    // 默认配置：buddy 关闭 / duck / 空 ASCII（load 反复取到同一份默认值，模拟取消回退）
    vi.mocked(GetSettings).mockResolvedValue(null)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllMocks()
  })

  it('取消（load 替换 cfg 引用）后 buddy 本地 ref 与 UI 重新同步回持久化值', async () => {
    wrapper = mount(AppearanceTab, {
      global: { stubs: { Switch: SwitchStub, Select: SelectStub } },
    })
    await flushPromises() // 等 onMounted 里 load() 完成 + 引用级 watch 首次触发
    const store = useSettingsStore()

    // 初始：默认 duck / 关闭 / 空 ASCII
    expect(wrapper.find('textarea').element.value).toBe('')
    expect(wrapper.findAll('.select-stub')[2].attributes('data-model')).toBe('duck')
    expect(wrapper.findAll('.switch-stub')[1].text()).toBe('false')

    // 模拟用户编辑：开启开关、角色换成 cat、粘贴自定义 ASCII
    await wrapper.findAll('.switch-stub')[1].trigger('click')
    await wrapper.findAll('.select-stub')[2].find('button').trigger('click')
    await wrapper.find('textarea').setValue('ART')
    // 编辑写入 store（原地改引用，引用级 watch 不触发）
    expect(store.cfg!.buddyEnabled).toBe(true)
    expect(store.cfg!.buddyRoleId).toBe('cat')
    expect(store.cfg!.buddyCustomAscii).toBe('ART')
    // 本地 ref 已更新 → UI 显示编辑值
    expect(wrapper.findAll('.switch-stub')[1].text()).toBe('true')
    expect(wrapper.findAll('.select-stub')[2].attributes('data-model')).toBe('cat')
    expect(wrapper.find('textarea').element.value).toBe('ART')

    // 取消：load() 替换 cfg 引用 → 引用级 watch 把本地 ref 重新同步回默认
    await store.load()
    await flushPromises()
    expect(store.cfg!.buddyEnabled).toBe(false)
    expect(wrapper.findAll('.switch-stub')[1].text()).toBe('false')
    expect(wrapper.findAll('.select-stub')[2].attributes('data-model')).toBe('duck')
    expect(wrapper.find('textarea').element.value).toBe('')
  })
})
