// src/renderer/src/data/buddies/presets.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BUDDY_ROLES, getBuddyRole } from './presets'
import { BUDDY_FRAME_KEYS, BUDDY_STAT_KEYS } from './types'

describe('presets', () => {
  it('至少内置 1 个角色', () => {
    expect(BUDDY_ROLES.length).toBeGreaterThanOrEqual(1)
  })

  it('每个角色含全部 4 帧、5 项属性基线、稀有度与性格', () => {
    for (const role of BUDDY_ROLES) {
      expect(role.id).toBeTruthy()
      expect(role.name).toBeTruthy()
      expect(['common', 'rare', 'epic', 'legendary', 'mythic']).toContain(role.rarity)
      expect(['chill', 'chaotic', 'nerd']).toContain(role.personality)
      for (const fk of BUDDY_FRAME_KEYS) {
        expect(role.frames[fk].length).toBeGreaterThan(0)
      }
      for (const sk of BUDDY_STAT_KEYS) {
        expect(typeof role.baseline[sk]).toBe('number')
        expect(role.baseline[sk]).toBeGreaterThanOrEqual(0)
        expect(role.baseline[sk]).toBeLessThanOrEqual(100)
      }
    }
  })

  it('getBuddyRole 未知 id 回退第一个角色', () => {
    const fallback = getBuddyRole('__nonexistent__')
    expect(fallback.id).toBe(BUDDY_ROLES[0].id)
  })
})
