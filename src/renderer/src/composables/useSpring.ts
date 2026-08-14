import { animate } from 'motion'

export interface SpringTarget { [k: string]: number | string }
export interface SpringOpts { bounce?: number; duration?: number; onComplete?: () => void }

/** 弹簧动效原语：基于 motion 的 spring 动画，内置 prefers-reduced-motion 快路径 */
export function useSpring() {
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  return {
    animateTo(el: HTMLElement | null | undefined, target: SpringTarget, opts: SpringOpts = {}) {
      if (!el) return null
      if (reduce) {
        // reduce 快路径：直接落到终值，不做插值
        for (const k of Object.keys(target)) { (el.style as any)[k] = String(target[k]) }
        opts.onComplete?.()
        return null
      }
      return animate(el, target as any, {
        type: 'spring',
        bounce: opts.bounce ?? 0,
        duration: opts.duration ?? 0.4,
        onComplete: opts.onComplete,
      })
    },
  }
}
