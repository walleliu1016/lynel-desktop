// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import BuddyPet from './BuddyPet.vue'
import { getBuddySpecies } from '../../data/buddies/presets'
import type { BuddyStats } from '../../data/buddies/types'

const duck = getBuddySpecies('duck')
const flat: BuddyStats = { debugging: 50, patience: 50, chaos: 50, wisdom: 50, snark: 50 }

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0))

/** duck 帧 0 用指定眼睛渲染后的行（renderSprite 结果：{E} 替换 + 空首行剔除） */
function duckFrame0(eye: string): string {
  return ['    __      ', `  <(${eye} )___ `, ' (  ._>    ', '   `--´     '].join('\n')
}

describe('BuddyPet 动态组合渲染', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('idle 渲染基座帧：{E} 替换为眼睛字符', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: null },
      global: { stubs: { transition: false } },
    })
    const pre = wrapper.find('pre')
    // 用 textContent 而非 text()：VTU 的 text() 会 trim，剥掉 ASCII 帧前导/尾随空格
    expect(pre.element.textContent).toBe(duckFrame0('·'))
  })

  it('不同眼睛字符替换基座 {E}', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '×', hat: 'none', stats: flat, state: null },
    })
    expect(wrapper.find('pre').element.textContent).toBe(duckFrame0('×'))
  })

  it('帽子叠加到空首行（crown 覆盖首行）', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'crown', stats: flat, state: null },
    })
    const lines = wrapper.find('pre').element.textContent!.split('\n')
    expect(lines[0].trim()).toBe('\\^^^/')
    expect(lines[1]).toContain('__')
  })

  it('state 映射：awaiting_permission → 帧 0 + 眼睛 !', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: 'awaiting_permission' as any },
    })
    expect(wrapper.find('pre').element.textContent).toBe(duckFrame0('!'))
  })

  it('state 映射：thinking → 帧 1 + 眼睛 .', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: 'thinking' as any },
    })
    expect(wrapper.find('pre').element.textContent).toContain('(. )')
  })

  it('state 映射：done → 帧 2 + 眼睛 ^', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: 'done' as any },
    })
    expect(wrapper.find('pre').element.textContent).toContain('(^ )')
  })

  it('自定义 ASCII 完全覆盖基座渲染', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'crown', stats: flat, state: null, customFrames: ['A', 'B'] },
    })
    expect(wrapper.find('pre').element.textContent).toBe('A\nB')
  })

  it('shiny 时附加 shiny class', () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', shiny: true, stats: flat, state: null },
    })
    expect(wrapper.find('.buddy').classes()).toContain('shiny')
  })

  it('点击宠物弹出气泡', async () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: null },
    })
    await wrapper.find('.buddy-body').trigger('click')
    expect(wrapper.find('.buddy-bubble').exists()).toBe(true)
  })

  /** 推进 rAF 帧：requestAnimationFrame 被 stub 为 setTimeout(cb, 0)，每次 await 让 macrotask 队列跑一帧 runFloat */
  async function advanceFrames(n = 1) {
    for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0))
  }

  it('hover 后 tilt 持续参与 transform 合成（tilt 由 runFloat 每帧合成并持续存在）', async () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: null, tilt: 8 },
    })
    const body = wrapper.find('.buddy-body').element as HTMLElement
    await wrapper.find('.buddy-body').trigger('mouseenter')
    // 等待超过旧实现 useSpring 的 spring 时长（0.4s），确认倾斜由 rAF 持续合成
    await new Promise((r) => setTimeout(r, 500))
    const t = body.style.transform
    const rx = t.match(/rotateX\((-?[\d.]+)deg\)/)
    const ry = t.match(/rotateY\((-?[\d.]+)deg\)/)
    expect(rx).not.toBeNull()
    expect(ry).not.toBeNull()
    expect(Math.abs(parseFloat(rx![1]))).toBeGreaterThan(1)
    expect(Math.abs(parseFloat(ry![1]))).toBeGreaterThan(1)
  })

  it('tilt=0 时 hover 无 3D 倾斜', async () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: null, tilt: 0 },
    })
    const body = wrapper.find('.buddy-body').element as HTMLElement
    await wrapper.find('.buddy-body').trigger('mouseenter')
    await advanceFrames(3)
    const t = body.style.transform
    expect(t).not.toMatch(/rotateX\((-?[1-9]|0\.[1-9])/)
  })

  it('点击后 runFloat 合成的 scale 进入挤压（<0.99，区别于呼吸浮动区间 [0.99,1.01]）', async () => {
    const wrapper = mount(BuddyPet, {
      props: { species: duck, eye: '·', hat: 'none', stats: flat, state: null },
    })
    const body = wrapper.find('.buddy-body').element as HTMLElement
    await wrapper.find('.buddy-body').trigger('click')
    await advanceFrames(1)
    const m = body.style.transform.match(/scale\(([\d.]+)\)/)
    expect(m).not.toBeNull()
    expect(parseFloat(m![1])).toBeLessThan(0.99)
  })
})
