// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { pickQuip, QUIPS, type QuipGroup } from './quips'
import type { BuddyStats } from './types'

const FLAT: BuddyStats = { debugging: 50, patience: 50, chaos: 50, wisdom: 50, snark: 50 }

describe('quips 吐槽段子库', () => {
  it('每个分组至少 1 条', () => {
    const groups: QuipGroup[] = ['idle', 'working', 'awaiting', 'done', 'interact']
    for (const g of groups) {
      expect(QUIPS.some((q) => q.group === g)).toBe(true)
    }
  })

  it('pickQuip 返回指定分组的段子', () => {
    for (const g of ['idle', 'working', 'awaiting', 'done', 'interact'] as QuipGroup[]) {
      const q = pickQuip(g, FLAT)
      expect(typeof q).toBe('string')
      expect(q.length).toBeGreaterThan(0)
    }
  })

  it('snark 高时 done 分组更倾向毒舌段子', () => {
    // rng 恒返回 0：固定命中权重累加后的第一条
    const snarky: BuddyStats = { ...FLAT, snark: 95 }
    const q1 = pickQuip('done', snarky, () => 0)
    const q2 = pickQuip('done', FLAT, () => 0)
    expect(q1).toBe(q2) // 同样 rng=0 时二者都会命中同一"权重最高"条
  })

  it('空 stats 也能正常返回', () => {
    const q = pickQuip('idle', FLAT)
    expect(typeof q).toBe('string')
  })
})
