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

  /** 推进 rAF 帧：requestAnimationFrame 被 stub 为 setTimeout(cb, 0)，每次 await 让 macrotask 队列跑一帧 runFloat */
  async function advanceFrames(n = 1) {
    for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0))
  }

  it('hover 后 tilt 持续参与 transform 合成（等待超过 motion spring 时长后仍保留 rotate）', async () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: null },
    })
    const body = wrapper.find('.buddy-body').element as HTMLElement
    await wrapper.find('.buddy-body').trigger('mouseenter')
    // 等待超过旧实现 useSpring 的 spring 时长（0.4s）：
    // 旧实现此时只剩 runFloat 帧（transform 无 rotate，倾斜被覆写）；
    // 新实现 tilt 由 runFloat 每帧合成并持续存在。
    await new Promise((r) => setTimeout(r, 500))
    const t = body.style.transform
    const rx = t.match(/rotateX\((-?[\d.]+)deg\)/)
    const ry = t.match(/rotateY\((-?[\d.]+)deg\)/)
    expect(rx).not.toBeNull()
    expect(ry).not.toBeNull()
    expect(Math.abs(parseFloat(rx![1]))).toBeGreaterThan(1)
    expect(Math.abs(parseFloat(ry![1]))).toBeGreaterThan(1)
  })

  it('点击后 runFloat 合成的 scale 进入挤压（<0.99，区别于呼吸浮动区间 [0.99,1.01]）', async () => {
    const wrapper = mount(BuddyPet, {
      props: { role, stats: flat, state: null },
    })
    const body = wrapper.find('.buddy-body').element as HTMLElement
    await wrapper.find('.buddy-body').trigger('click')
    await advanceFrames(1)
    const m = body.style.transform.match(/scale\(([\d.]+)\)/)
    expect(m).not.toBeNull()
    expect(parseFloat(m![1])).toBeLessThan(0.99)
  })
})
