// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { RARITIES, RARITY_FLOOR, RARITY_WEIGHTS, hashString, mulberry32, rollStats, rollSpeciesStats } from './rarity'
import { getBuddySpecies } from './presets'
import { BUDDY_STAT_KEYS } from './types'

describe('rarity', () => {
  it('5 档稀有度与掉落权重总和 100', () => {
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary'])
    const total = RARITIES.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0)
    expect(total).toBe(100)
  })

  it('属性下限随稀有度递增', () => {
    for (let i = 1; i < RARITIES.length; i += 1) {
      expect(RARITY_FLOOR[RARITIES[i]]).toBeGreaterThan(RARITY_FLOOR[RARITIES[i - 1]])
    }
  })

  it('hashString 确定性且稳定', () => {
    expect(hashString('duck')).toBe(hashString('duck'))
    expect(hashString('duck')).not.toBe(hashString('cat'))
  })

  it('mulberry32 同一 seed 序列一致', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })

  it('rollStats 确定性：同 seed+稀有度结果相同，值域 0-100', () => {
    const s1 = rollStats(42, 'rare')
    const s2 = rollStats(42, 'rare')
    expect(s1).toEqual(s2)
    for (const k of BUDDY_STAT_KEYS) {
      expect(s1[k]).toBeGreaterThanOrEqual(0)
      expect(s1[k]).toBeLessThanOrEqual(100)
    }
  })

  it('rollStats 稀有度越高整体越高：legendary 总分显著高于 common', () => {
    const common = rollStats(7, 'common')
    const legendary = rollStats(7, 'legendary')
    const sum = (s: Record<string, number>) => BUDDY_STAT_KEYS.reduce((acc, k) => acc + s[k], 0)
    expect(sum(legendary)).toBeGreaterThan(sum(common))
  })

  it('rollSpeciesStats 同物种+稀有度可复现', () => {
    const duck = getBuddySpecies('duck')
    expect(rollSpeciesStats(duck)).toEqual(rollSpeciesStats(duck))
    expect(rollSpeciesStats(duck, 'epic')).toEqual(rollSpeciesStats(duck, 'epic'))
  })
})
