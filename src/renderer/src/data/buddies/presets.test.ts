// src/renderer/src/data/buddies/presets.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BUDDY_SPECIES, getBuddySpecies } from './presets'
import { BUDDY_STAT_KEYS } from './types'
import { RARITIES } from './rarity'

describe('presets', () => {
  it('内置全部 18 物种', () => {
    expect(BUDDY_SPECIES).toHaveLength(18)
  })

  it('物种 id 唯一、名称非空、稀有度合法、含 3 帧动画且每帧非空', () => {
    const ids = new Set<string>()
    for (const s of BUDDY_SPECIES) {
      expect(ids.has(s.id)).toBe(false)
      ids.add(s.id)
      expect(s.name).toBeTruthy()
      expect(RARITIES).toContain(s.rarity)
      expect(s.frames).toHaveLength(3)
      for (const frame of s.frames) {
        expect(frame.length).toBeGreaterThan(0)
      }
    }
  })

  it('每物种基座帧含 {E} 眼睛占位符', () => {
    for (const s of BUDDY_SPECIES) {
      const joined = s.frames.flat().join('\n')
      expect(joined).toContain('{E}')
    }
  })

  it('getBuddySpecies 未知 id 回退第一个物种', () => {
    const fallback = getBuddySpecies('__nonexistent__')
    expect(fallback.id).toBe(BUDDY_SPECIES[0].id)
  })

  it('BUDDY_STAT_KEYS 为 5 维属性键', () => {
    expect(BUDDY_STAT_KEYS).toEqual(['debugging', 'patience', 'chaos', 'wisdom', 'snark'])
  })
})
