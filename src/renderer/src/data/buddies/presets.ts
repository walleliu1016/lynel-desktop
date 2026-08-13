import type { BuddyRole } from './types'

export const BUDDY_ROLES: BuddyRole[] = [
  {
    id: 'duck',
    name: '小鸭',
    rarity: 'common',
    personality: 'chill',
    frames: {
      idle: ['  __  ', ' <(o_o)>', '   \\_/ ', '  /| |\\ '],
      thinking: ['  __  ', ' <(o .)>', '   \\_/ ', '  /| |\\ '],
      celebration: ['  \\^/ ', ' <(^o^)>', '   \\_/ ', '  /_|_\\ '],
      alarm: ['  __  ', ' <(O_o)>', '   \\_/ ', '  /| |\\ '],
    },
    baseline: { debugging: 40, patience: 70, chaos: 20, wisdom: 50, snark: 30 },
  },
  {
    id: 'cat',
    name: '黑猫',
    rarity: 'rare',
    personality: 'nerd',
    frames: {
      idle: [' /\\_/\\ ', '( o.o )', ' > ^ < '],
      thinking: [' /\\_/\\ ', '( o . )', ' > ^ < '],
      celebration: [' /\\_/\\ ', '( ^o^ )', ' > v < '],
      alarm: [' /\\_/\\ ', '( O.o )', ' > ! < '],
    },
    baseline: { debugging: 80, patience: 40, chaos: 40, wisdom: 60, snark: 70 },
  },
  {
    id: 'dragon',
    name: '小龙',
    rarity: 'epic',
    personality: 'chaotic',
    frames: {
      idle: ['   /\\   ', '  <oo>  ', '   \\/   ', '  /\\/\\  '],
      thinking: ['   /\\   ', '  <o >  ', '   \\/   ', '  /\\/\\  '],
      celebration: ['   \\/   ', '  <^o^> ', '   /\\   ', '  /\\/\\  '],
      alarm: ['   /\\   ', '  <Oo>  ', '   \\/   ', '  /\\/\\  '],
    },
    baseline: { debugging: 30, patience: 20, chaos: 90, wisdom: 40, snark: 80 },
  },
]

/** 按 id 查角色；未知 id 回退第一个（小鸭）。 */
export function getBuddyRole(id: string): BuddyRole {
  return BUDDY_ROLES.find((r) => r.id === id) ?? BUDDY_ROLES[0]
}
