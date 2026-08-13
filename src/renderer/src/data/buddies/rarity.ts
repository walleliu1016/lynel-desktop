import type { BuddyRarity, BuddySpecies, BuddyStats } from './types'
import { BUDDY_STAT_KEYS } from './types'

/** 稀有度档位（common → legendary） */
export const RARITIES: BuddyRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

/** 掉落权重（参考实现，设计区展示用） */
export const RARITY_WEIGHTS: Record<BuddyRarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }

/** 星标（参考实现） */
export const RARITY_STARS: Record<BuddyRarity, string> = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
}

/** 稀有度主题色（参考实现色值） */
export const RARITY_COLORS: Record<BuddyRarity, string> = {
  common: '#8b949e',
  uncommon: '#3fb950',
  rare: '#a371f7',
  epic: '#f778ba',
  legendary: '#d29922',
}

/** 属性下限：随稀有度提高（参考实现 RARITY_FLOOR） */
export const RARITY_FLOOR: Record<BuddyRarity, number> = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }

/** 属性条主题色（参考实现 STAT_COLORS） */
export const STAT_COLORS: Record<keyof BuddyStats, string> = {
  debugging: '#58a6ff',
  patience: '#3fb950',
  chaos: '#f85149',
  wisdom: '#a371f7',
  snark: '#d29922',
}

/** FNV-1a 字符串哈希（参考实现 hashString），返回 32 位无符号整数。 */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 伪随机数生成器（参考实现），入参为种子整数，返回 [0,1) 序列。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * 稀有度驱动属性生成（参考实现 rollStats）：
 * 一项 peak 拉高、一项 dump 压低，其余在稀有度下限之上浮动，全部 clamp 到 0-100。
 */
export function rollStats(seed: number, rarity: BuddyRarity): BuddyStats {
  const rng = mulberry32(seed)
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, BUDDY_STAT_KEYS)
  let dump = pick(rng, BUDDY_STAT_KEYS)
  while (dump === peak) dump = pick(rng, BUDDY_STAT_KEYS)

  const stats = {} as BuddyStats
  for (const n of BUDDY_STAT_KEYS) {
    if (n === peak) stats[n] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    else if (n === dump) stats[n] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    else stats[n] = floor + Math.floor(rng() * 40)
  }
  return stats
}

/** 物种属性基线：seed 取物种 id + 稀有度的哈希，同组合固定可复现。 */
export function rollSpeciesStats(species: BuddySpecies, rarity: BuddyRarity = species.rarity): BuddyStats {
  return rollStats(hashString(`${species.id}|${rarity}`), rarity)
}
