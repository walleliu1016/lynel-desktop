import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentBadge from './AgentBadge.vue'

describe('AgentBadge', () => {
  it('缺省 agent 回退 claude 显示 CC', () => {
    const w = mount(AgentBadge)
    expect(w.text()).toBe('CC')
  })
  it('codex 显示 CX', () => {
    const w = mount(AgentBadge, { props: { agent: 'codex' } })
    expect(w.text()).toBe('CX')
  })
  it('未知 agent 回退 claude', () => {
    const w = mount(AgentBadge, { props: { agent: 'unknown-agent' } })
    expect(w.text()).toBe('CC')
  })
  it('sm 尺寸应用 sm class', () => {
    const w = mount(AgentBadge, { props: { size: 'sm' } })
    expect(w.classes()).toContain('sm')
  })
})
