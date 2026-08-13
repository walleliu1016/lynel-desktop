/** Buddy 属性键：DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK */
export type BuddyStatKey = 'debugging' | 'patience' | 'chaos' | 'wisdom' | 'snark'

/** 5 项属性值，0-100 */
export type BuddyStats = Record<BuddyStatKey, number>

/** 会话状态 → 帧键：idle 空闲 / thinking 思考 / celebration 庆祝 / alarm 警觉（等待审批） */
export type BuddyFrameKey = 'idle' | 'thinking' | 'celebration' | 'alarm'

/** 稀有度：参考实现 5 档（common → legendary） */
export type BuddyRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** 眼睛字符（参考 EYES 数组） */
export type BuddyEye = '·' | '✦' | '×' | '◉' | '@' | '°'

/** 帽子 id（参考 HATS 数组） */
export type BuddyHat = 'none' | 'crown' | 'tophat' | 'propeller' | 'halo' | 'wizard' | 'beanie' | 'tinyduck'

/**
 * 物种基座：3 帧动画，每帧是字符串数组（行），行内含 {E} 眼睛占位符。
 * 渲染时用当前眼睛字符替换 {E}，帽子叠加到首行，blink 时眼睛替换为 '-'
 * （移植参考实现 buddy/sprites.ts 的 BODIES 数据）。
 */
export interface BuddySpecies {
  id: string
  name: string
  rarity: BuddyRarity
  frames: string[][]
}

export const BUDDY_STAT_KEYS: BuddyStatKey[] = ['debugging', 'patience', 'chaos', 'wisdom', 'snark']
