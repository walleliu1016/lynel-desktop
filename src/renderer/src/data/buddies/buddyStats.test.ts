// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyEvent, createStats, decay, resetToBaseline, type StatEventKind } from './buddyStats'
import { BUDDY_STAT_KEYS, type BuddyStats } from './types'

const BASE: BuddyStats = { debugging: 50, patience: 50, chaos: 50, wisdom: 50, snark: 50 }

describe('buddyStats 纯函数', () => {
  it('createStats 返回基线副本', () => {
    const s = createStats(BASE)
    expect(s).toEqual(BASE)
    expect(s).not.toBe(BASE)
  })

  it('applyEvent 按事件类型增量且单事件封顶 0.5', () => {
    const kinds: StatEventKind[] = ['error', 'interrupt', 'awaiting', 'request', 'done']
    for (const k of kinds) {
      const s = applyEvent(createStats(BASE), k)
      for (const key of BUDDY_STAT_KEYS) {
        const d = s[key] - BASE[key]
        expect(Math.abs(d)).toBeLessThanOrEqual(0.5)
        expect(d).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('error 提升 debugging 与 chaos', () => {
    const s = applyEvent(createStats(BASE), 'error')
    expect(s.debugging).toBe(50.5)
    expect(s.chaos).toBe(50.2)
    expect(s.patience).toBe(50)
  })

  it('awaiting 提升 patience，request 提升 wisdom，done 提升 snark', () => {
    const a = applyEvent(createStats(BASE), 'awaiting')
    expect(a.patience).toBe(50.5)
    const r = applyEvent(createStats(BASE), 'request')
    expect(r.wisdom).toBe(50.4)
    const d = applyEvent(createStats(BASE), 'done')
    expect(d.snark).toBe(50.3)
  })

  it('applyEvent 不会越界到 0 以下或 100 以上', () => {
    const maxed: BuddyStats = { debugging: 100, patience: 100, chaos: 100, wisdom: 100, snark: 100 }
    const s = applyEvent(maxed, 'done')
    expect(s.snark).toBe(100)
    const floor: BuddyStats = { debugging: 0, patience: 0, chaos: 0, wisdom: 0, snark: 0 }
    const f = applyEvent(floor, 'awaiting')
    expect(f.patience).toBe(0.5)
  })

  it('decay 向基线回落且不会越过基线', () => {
    const high: BuddyStats = { debugging: 80, patience: 80, chaos: 80, wisdom: 80, snark: 80 }
    const d = decay(high, BASE)
    expect(d.debugging).toBe(79.9)
    const s2 = decay({ ...BASE }, BASE)
    expect(s2).toEqual(BASE)
  })

  it('resetToBaseline 归零回基线', () => {
    const high: BuddyStats = { debugging: 90, patience: 90, chaos: 90, wisdom: 90, snark: 90 }
    expect(resetToBaseline(BASE)).toEqual(BASE)
    expect(resetToBaseline(high)).toEqual(high)
    expect(resetToBaseline(BASE)).not.toBe(BASE)
  })
})
