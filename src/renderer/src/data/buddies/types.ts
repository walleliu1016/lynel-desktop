/** Buddy 属性键：DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK */
export type BuddyStatKey = 'debugging' | 'patience' | 'chaos' | 'wisdom' | 'snark'

/** 5 项属性值，0-100 */
export type BuddyStats = Record<BuddyStatKey, number>

/** 表情帧：idle 空闲 / thinking 思考 / celebration 庆祝 / alarm 警觉（等待审批） */
export type BuddyFrameKey = 'idle' | 'thinking' | 'celebration' | 'alarm'

/** 每帧是一个字符串数组（多行 ASCII），行数即字符画高度 */
export type BuddyFrames = Record<BuddyFrameKey, string[]>

/** 性格倾向：影响动画参数与吐槽风格 */
export type BuddyPersonality = 'chill' | 'chaotic' | 'nerd'

/** 稀有度：角色固有标签 */
export type BuddyRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

export interface BuddyRole {
  id: string
  name: string
  rarity: BuddyRarity
  personality: BuddyPersonality
  frames: BuddyFrames
  /** 属性基线（会话起步值，默认全 50） */
  baseline: BuddyStats
}

export const BUDDY_STAT_KEYS: BuddyStatKey[] = ['debugging', 'patience', 'chaos', 'wisdom', 'snark']

export const BUDDY_FRAME_KEYS: BuddyFrameKey[] = ['idle', 'thinking', 'celebration', 'alarm']
