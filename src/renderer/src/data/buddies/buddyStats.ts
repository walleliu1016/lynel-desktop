import type { BuddyStats } from './types'

export type StatEventKind = 'error' | 'interrupt' | 'awaiting' | 'request' | 'done'

const EVENT_DELTAS: Record<StatEventKind, Partial<BuddyStats>> = {
  error: { debugging: 0.5, chaos: 0.2 },
  interrupt: { chaos: 0.5 },
  awaiting: { patience: 0.5 },
  request: { wisdom: 0.4, debugging: 0.1 },
  done: { snark: 0.3, wisdom: 0.2 },
}

/** 单事件增量上限（缓慢渐变，避免瞬间拉满） */
const MAX_DELTA = 0.5
/** 无事件时的回落步长 */
const DECAY_RATE = 0.1

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 从基线创建会话起步属性（副本）。 */
export function createStats(baseline: BuddyStats): BuddyStats {
  return { ...baseline }
}

/** 应用一次会话事件，按事件映射增量并 clamp 到 0-100。 */
export function applyEvent(stats: BuddyStats, kind: StatEventKind): BuddyStats {
  const next: BuddyStats = { ...stats }
  const delta = EVENT_DELTAS[kind]
  for (const [k, d] of Object.entries(delta) as [keyof BuddyStats, number][]) {
    next[k] = clamp(next[k] + d, 0, 100)
  }
  return next
}

/** 无事件时向基线缓慢回落（每步 ±DECAY_RATE），不会越过基线。 */
export function decay(stats: BuddyStats, baseline: BuddyStats): BuddyStats {
  const next: BuddyStats = { ...stats }
  for (const key of Object.keys(next) as (keyof BuddyStats)[]) {
    const base = baseline[key]
    if (next[key] > base) next[key] = clamp(next[key] - DECAY_RATE, base, 100)
    else if (next[key] < base) next[key] = clamp(next[key] + DECAY_RATE, 0, base)
  }
  return next
}

/** 会话结束归零回基线（供下次会话重来）。 */
export function resetToBaseline(baseline: BuddyStats): BuddyStats {
  return { ...baseline }
}

export const BUDDY_MAX_DELTA = MAX_DELTA
