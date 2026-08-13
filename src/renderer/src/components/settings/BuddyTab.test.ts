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

/** 简化 Select：展示当前 modelValue；点击 emit options[1].value（物种→goose，帽子→crown） */
const SelectStub = {
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<div class="select-stub" :data-model="modelValue"><button type="button" @click="$emit('update:modelValue', options[1]?.value)">{{ options[1]?.label }}</button></div>`,
}

/** 简化 BuddyPet：不跑 rAF 动画，仅透传外观参数供断言 */
const BuddyPetStub = {
  name: 'BuddyPet',
  props: ['species', 'eye', 'hat', 'shiny', 'state', 'stats', 'tilt', 'floatAmp', 'customFrames', 'className'],
  template: `<pre class="buddy-stub">{{ species.id }}|{{ eye }}|{{ hat }}|{{ String(shiny) }}</pre>`,
}

function mountBuddyTab() {
  return mount(BuddyTab, {
    global: { stubs: { Switch: SwitchStub, Select: SelectStub, BuddyPet: BuddyPetStub } },
  })
}

describe('BuddyTab 设计 + 实时预览', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    // 默认配置：关闭 / duck / · / none / 不 shiny / 稀有度跟随 / 3D 8 / 呼吸 3 / 空 ASCII
    vi.mocked(GetSettings).mockResolvedValue(null)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllMocks()
  })

  it('初始渲染取 store 默认值，空 ASCII 不报「内容为空」', async () => {
    wrapper = mountBuddyTab()
    await flushPromises()

    expect(wrapper.findAll('.switch-stub')[0].text()).toBe('false')
    expect(wrapper.findAll('.select-stub')[0].attributes('data-model')).toBe('duck')
    expect(wrapper.findAll('.select-stub')[1].attributes('data-model')).toBe('none')
    expect(wrapper.find('textarea').element.value).toBe('')
    expect(wrapper.find('.ascii-error').exists()).toBe(false)
    // 稀有度跟随物种（空串 = 跟随物种）
    expect(wrapper.findAll('.select-stub')[2].attributes('data-model')).toBe('')
    // 预览收到默认外观参数
    expect(wrapper.find('.buddy-stub').text()).toBe('duck|·|none|false')
  })

  it('编辑直接写入 store cfg，预览即时更新', async () => {
    wrapper = mountBuddyTab()
    await flushPromises()
    const store = useSettingsStore()

    // 物种 → goose、眼睛 → ✦、帽子 → crown、shiny 开启、稀有度 → common（stub emit options[1]）、粘贴 ASCII
    await wrapper.findAll('.select-stub')[0].find('button').trigger('click')
    await wrapper.findAll('.eye-btn')[1].trigger('click')
    await wrapper.findAll('.select-stub')[1].find('button').trigger('click')
    await wrapper.findAll('.switch-stub')[1].trigger('click')
    await wrapper.findAll('.select-stub')[2].find('button').trigger('click')
    await wrapper.find('textarea').setValue('ART')

    expect(store.cfg!.buddyRoleId).toBe('goose')
    expect(store.cfg!.buddyEye).toBe('✦')
    expect(store.cfg!.buddyHat).toBe('crown')
    expect(store.cfg!.buddyShiny).toBe(true)
    expect(store.cfg!.buddyRarity).toBe('common')
    expect(store.cfg!.buddyCustomAscii).toBe('ART')
    // 预览外观参数同步更新（customFrames 非空时基座被覆盖，仍传 species/eye/hat）
    expect(wrapper.find('.buddy-stub').text()).toBe('goose|✦|crown|true')
  })

  it('store.load()（替换 cfg 引用）后 computed 自动回退到持久化值', async () => {
    wrapper = mountBuddyTab()
    await flushPromises()
    const store = useSettingsStore()

    await wrapper.findAll('.switch-stub')[0].trigger('click')
    await wrapper.findAll('.select-stub')[0].find('button').trigger('click')
    await wrapper.find('textarea').setValue('ART')
    expect(wrapper.find('textarea').element.value).toBe('ART')

    await store.load()
    await flushPromises()
    expect(store.cfg!.buddyEnabled).toBe(false)
    expect(wrapper.findAll('.switch-stub')[0].text()).toBe('false')
    expect(wrapper.findAll('.select-stub')[0].attributes('data-model')).toBe('duck')
    expect(wrapper.find('textarea').element.value).toBe('')
    expect(wrapper.find('.ascii-error').exists()).toBe(false)
  })

  it('非法 ASCII（超行数）显示校验错误，预览回退到基座', async () => {
    wrapper = mountBuddyTab()
    await flushPromises()

    const tooMany = Array.from({ length: 41 }, () => 'x').join('\n')
    await wrapper.find('textarea').setValue(tooMany)
    expect(wrapper.find('.ascii-error').text()).toContain('行数超过上限')
    // 预览未用自定义帧，仍显示基座 species|eye|hat
    expect(wrapper.find('.buddy-stub').text()).toBe('duck|·|none|false')
  })
})
