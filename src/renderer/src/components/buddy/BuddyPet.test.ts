// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import BuddyPet from './BuddyPet.vue'
import { getBuddyRole } from '../../data/buddies/presets'
import type { BuddyStats } from '../../data/buddies/types'

const role = getBuddyRole('duck')
const flat: BuddyStats = { debugging: 50, patience: 50, chaos: 50, wisdom: 50, snark: 50 }

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0))

describe('BuddyPet', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('渲染角色 idle 帧内容', () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: null },
      global: { stubs: { transition: false } },
    })
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    // 用 textContent 而非 text()：VTU 的 text() 会 trim，剥掉 ASCII 帧首行前导/末行尾随空格
    expect(pre.element.textContent).toBe(role.frames.idle.join('\n'))
  })

  it('state 映射到对应帧：awaiting_permission → alarm', () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: 'awaiting_permission' as any },
    })
    expect(wrapper.find('pre').element.textContent).toBe(role.frames.alarm.join('\n'))
  })

  it('state 映射：done → celebration', () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: 'done' as any },
    })
    expect(wrapper.find('pre').element.textContent).toBe(role.frames.celebration.join('\n'))
  })

  it('state 映射：thinking → thinking 帧', () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: 'thinking' as any },
    })
    expect(wrapper.find('pre').element.textContent).toBe(role.frames.thinking.join('\n'))
  })

  it('点击宠物弹出气泡', async () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: null },
    })
    await wrapper.find('.buddy-body').trigger('click')
    expect(wrapper.find('.buddy-bubble').exists()).toBe(true)
  })
})
