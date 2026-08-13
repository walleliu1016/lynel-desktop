// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import BuddyTab from './BuddyTab.vue'
import { useSettingsStore } from '../../stores/settings'
import { GetSettings } from '../../composables/useElectron'

// mock IPC 转发层，避免依赖 window.electronAPI
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

/** 简化 Switch：点击时切 modelValue 并触发 change */
const SwitchStub = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: `<button type="button" class="switch-stub" @click="$emit('update:modelValue', !modelValue); $emit('change')">{{ String(modelValue) }}</button>`,
}

/** 简化 Select：点击发出固定目标值 cat */
const SelectStub = {
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<div class="select-stub" :data-model="modelValue"><button type="button" @click="$emit('update:modelValue', 'cat')">cat</button></div>`,
}

/** 简化 BuddyPet：不跑 rAF 动画，仅透传 role/stats 供断言预览覆盖 */
const BuddyPetStub = {
  name: 'BuddyPet',
  props: ['role', 'stats', 'state', 'className'],
  template: `<pre class="buddy-stub">{{ role.id }}:{{ role.frames.idle.join('/') }}</pre>`,
}

describe('BuddyTab 设计 + 实时预览', () => {
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

  it('初始渲染取 store 默认值，空 ASCII 不报「内容为空」', async () => {
    wrapper = mount(BuddyTab, {
      global: { stubs: { Switch: SwitchStub, Select: SelectStub, BuddyPet: BuddyPetStub } },
    })
    await flushPromises()

    expect(wrapper.find('.switch-stub').text()).toBe('false')
    expect(wrapper.find('.select-stub').attributes('data-model')).toBe('duck')
    expect(wrapper.find('textarea').element.value).toBe('')
    // 空 ASCII 是默认配置，不显示错误
    expect(wrapper.find('.ascii-error').exists()).toBe(false)
    // 预览用 duck 基线帧
    expect(wrapper.find('.buddy-stub').text()).toContain('duck:')
  })

  it('编辑直接写入 store cfg（原地改引用），预览即时覆盖', async () => {
    wrapper = mount(BuddyTab, {
      global: { stubs: { Switch: SwitchStub, Select: SelectStub, BuddyPet: BuddyPetStub } },
    })
    await flushPromises()
    const store = useSettingsStore()

    // 开启开关、角色换成 cat、粘贴自定义 ASCII
    await wrapper.find('.switch-stub').trigger('click')
    await wrapper.find('.select-stub button').trigger('click')
    await wrapper.find('textarea').setValue('A\nB')

    expect(store.cfg!.buddyEnabled).toBe(true)
    expect(store.cfg!.buddyRoleId).toBe('cat')
    expect(store.cfg!.buddyCustomAscii).toBe('A\nB')
    // 预览 role 被自定义 ASCII 覆盖：frames 四组均替换，且 id 仍是 cat
    expect(wrapper.find('.buddy-stub').text()).toBe('cat:A/B')
  })

  it('取消（load 替换 cfg 引用）后 computed 自动回退到持久化值', async () => {
    wrapper = mount(BuddyTab, {
      global: { stubs: { Switch: SwitchStub, Select: SelectStub, BuddyPet: BuddyPetStub } },
    })
    await flushPromises()
    const store = useSettingsStore()

    // 编辑
    await wrapper.find('.switch-stub').trigger('click')
    await wrapper.find('.select-stub button').trigger('click')
    await wrapper.find('textarea').setValue('ART')
    expect(wrapper.find('.switch-stub').text()).toBe('true')
    expect(wrapper.find('.select-stub').attributes('data-model')).toBe('cat')
    expect(wrapper.find('textarea').element.value).toBe('ART')

    // 取消：load() 替换 cfg 引用 → computed 重新读默认值
    await store.load()
    await flushPromises()
    expect(store.cfg!.buddyEnabled).toBe(false)
    expect(wrapper.find('.switch-stub').text()).toBe('false')
    expect(wrapper.find('.select-stub').attributes('data-model')).toBe('duck')
    expect(wrapper.find('textarea').element.value).toBe('')
    // 回退后空 ASCII 无错误提示
    expect(wrapper.find('.ascii-error').exists()).toBe(false)
  })

  it('非法 ASCII（超行数）显示校验错误，预览回退到原角色', async () => {
    wrapper = mount(BuddyTab, {
      global: { stubs: { Switch: SwitchStub, Select: SelectStub, BuddyPet: BuddyPetStub } },
    })
    await flushPromises()

    const tooMany = Array.from({ length: 41 }, () => 'x').join('\n')
    await wrapper.find('textarea').setValue(tooMany)
    expect(wrapper.find('.ascii-error').text()).toContain('行数超过上限')
    // 预览回退到角色自带帧（未被覆盖）
    expect(wrapper.find('.buddy-stub').text()).not.toContain('x\n')
    expect(wrapper.find('.buddy-stub').text()).toContain('duck:')
  })
})
