import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentBadge from './AgentBadge.vue'

describe('AgentBadge', () => {
  it('缺省 agent 回退 claude 渲染 Anthropic logo', () => {
    const w = mount(AgentBadge)
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
  })
  it('codex 渲染 OpenAI logo', () => {
    const w = mount(AgentBadge, { props: { agent: 'codex' } })
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
  })
  it('未知 agent 回退 claude', () => {
    const w = mount(AgentBadge, { props: { agent: 'unknown-agent' } })
    expect(w.find('svg').exists()).toBe(true)
  })
  it('omp 渲染 oh-my-pi 图标（含深紫底 rect）', () => {
    const w = mount(AgentBadge, { props: { agent: 'omp' } })
    const svg = w.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 120 90')
    expect(svg.findAll('rect').length).toBeGreaterThan(0)
  })
  it('sm 尺寸应用 sm class', () => {
    const w = mount(AgentBadge, { props: { size: 'sm' } })
    expect(w.classes()).toContain('sm')
  })
})
