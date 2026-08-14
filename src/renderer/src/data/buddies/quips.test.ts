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
    // rng=0.5：FLAT(snark=50) 权重 [3,1,1] 共 5 → roll=2.5 命中「干得漂亮！」
    //           snark=95 权重 [3,3,1] 共 7 → roll=3.5 落在第二条「我早说能跑通。」
    const snarky: BuddyStats = { ...FLAT, snark: 95 }
    const qHigh = pickQuip('done', snarky, () => 0.5)
    const qLow = pickQuip('done', FLAT, () => 0.5)
    expect(qHigh).toBe('我早说能跑通。')
    expect(qLow).toBe('干得漂亮！')
  })

  it('中性属性（各 50）也能正常返回段子', () => {
    const q = pickQuip('idle', FLAT)
    expect(typeof q).toBe('string')
  })
})
