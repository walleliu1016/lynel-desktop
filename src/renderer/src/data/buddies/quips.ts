import type { BuddyStatKey, BuddyStats } from './types'

export type QuipGroup = 'idle' | 'working' | 'awaiting' | 'done' | 'interact'

export interface QuipEntry {
  group: QuipGroup
  text: string
  /** 属性倾向：该属性 ≥ 阈值时此段子权重 +2 */
  affinity?: Partial<Record<BuddyStatKey, number>>
}

export const QUIPS: QuipEntry[] = [
  // idle 无聊吐槽
  { group: 'idle', text: '好无聊，敲点代码？' },
  { group: 'idle', text: '我在这站多久了？' },
  { group: 'idle', text: '快给我点活儿干。', affinity: { chaos: 70 } },
  { group: 'idle', text: '要不要检查下你最近的 bug？', affinity: { debugging: 70 } },
  // working 工作吐槽
  { group: 'working', text: '跑起来了，趁现在别碰它。', affinity: { patience: 70 } },
  { group: 'working', text: '这编译又过了？运气不错。', affinity: { chaos: 60 } },
  { group: 'working', text: '我在盯输出流，你专心写。' },
  // awaiting 等待毒舌
  { group: 'awaiting', text: '它在等一个笨蛋点允许。', affinity: { snark: 60 } },
  { group: 'awaiting', text: '审批按钮又找不到在哪了？', affinity: { patience: 30 } },
  { group: 'awaiting', text: '这个权限有坑，先想想再放行。', affinity: { debugging: 60 } },
  // done 鼓励/自夸
  { group: 'done', text: '干得漂亮！', affinity: { snark: 20 } },
  { group: 'done', text: '我早说能跑通。', affinity: { snark: 80 } },
  { group: 'done', text: '进度条拉满，收工！' },
  // interact 被抚摸回应
  { group: 'interact', text: '嗯？别闹。' },
  { group: 'interact', text: '再摸我可要收钱了。', affinity: { snark: 70 } },
  { group: 'interact', text: '舒服…继续。', affinity: { chaos: 30 } },
]

/** 按分组过滤段子，按属性加权累加，roll 一个随机数落在某条上。 */
export function pickQuip(group: QuipGroup, stats: BuddyStats, rng: () => number = Math.random): string {
  const pool = QUIPS.filter((q) => q.group === group)
  if (!pool.length) return ''
  const weights = pool.map((q) => weightFor(q, stats))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i].text
  }
  return pool[pool.length - 1].text
}

function weightFor(q: QuipEntry, stats: BuddyStats): number {
  let w = 1
  if (!q.affinity) return w
  for (const [key, threshold] of Object.entries(q.affinity) as [BuddyStatKey, number][]) {
    if (stats[key] >= threshold) w += 2
  }
  return w
}
