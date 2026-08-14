<template>
  <div class="buddy" :class="[className, { shiny }]">
    <Transition name="buddy-pop">
      <div v-if="bubble" class="buddy-bubble">{{ bubble }}</div>
    </Transition>
    <div ref="bodyEl" class="buddy-body" @click="onInteract" @mouseenter="onHover(true)" @mouseleave="onHover(false)">
      <pre class="buddy-pre">{{ frameText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SessionState } from '../../types/session'
import type { BuddyEye, BuddyFrameKey, BuddyHat, BuddySpecies, BuddyStats } from '../../data/buddies/types'
import { HAT_LINES } from '../../data/buddies/appearance'
import { pickQuip } from '../../data/buddies/quips'

const props = withDefaults(defineProps<{
  species: BuddySpecies
  eye: BuddyEye
  hat: BuddyHat
  shiny?: boolean
  state?: SessionState | null
  stats: BuddyStats
  /** 3D hover 倾斜角度（0 = 关闭 3D 旋转） */
  tilt?: number
  /** 呼吸浮动幅度 px（0 = 静止） */
  floatAmp?: number
  /** 自定义 ASCII 帧（非空则完全覆盖基座渲染，不做眼睛/帽子替换） */
  customFrames?: string[]
  className?: string
}>(), {
  shiny: false,
  state: null,
  tilt: 8,
  floatAmp: 3,
  customFrames: undefined,
  className: '',
})

/** 阻尼系数：每帧向目标值逼近的比例（1/0.3 ≈ 3.3 帧收敛约 97%） */
const DAMP = 0.3
/** 参考实现的 idle 动画序列：-1 为眨眼（眼睛替换为 '-'） */
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]

const bodyEl = ref<HTMLElement | null>(null)
const bubble = ref<string>('')
/** idle 动画帧指针：rAF 每 30 帧（≈0.5s，对应参考 TICK_MS=500）推进一次 */
const tick = ref(0)
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let rafId = 0
let frame = 0
// 交互状态：hover 立体倾斜目标值 + 点击挤压量。
// 不直接写元素，由 runFloat 每帧合成进 transform，保证 el.style.transform 只有 runFloat 一个写入者。
let targetTiltX = 0
let targetTiltY = 0
let tiltX = 0
let tiltY = 0
let squish = 1

/** state → 帧键：awaiting_permission→alarm，thinking→thinking，done/ended→celebration，其余 idle */
const frameKey = computed<BuddyFrameKey>(() => {
  const st = props.state
  if (st === 'awaiting_permission') return 'alarm'
  if (st === 'thinking') return 'thinking'
  if (st === 'done' || st === 'ended') return 'celebration'
  return 'idle'
})

/**
 * 当前帧解析：基座帧索引 + 渲染眼睛字符。
 * 状态差异用眼睛字符表达——thinking 半闭眼 '.'、celebration '^'、alarm '!'、blink '-'（参考语义）。
 */
function resolveFrame(): { idx: number; eye: string } {
  switch (frameKey.value) {
    case 'thinking':
      return { idx: 1, eye: '.' }
    case 'celebration':
      return { idx: 2, eye: '^' }
    case 'alarm':
      return { idx: 0, eye: '!' }
    default: {
      const step = IDLE_SEQUENCE[tick.value % IDLE_SEQUENCE.length]
      return { idx: step === -1 ? 0 : step % 3, eye: step === -1 ? '-' : props.eye }
    }
  }
}

/** 渲染行（移植参考 renderSprite：{E} 替换眼睛、帽子叠加到空首行、剔除多余空首行） */
const frameText = computed(() => {
  if (props.customFrames?.length) return props.customFrames.join('\n')
  const { idx, eye } = resolveFrame()
  const body = props.species.frames[idx].map((l) => l.replaceAll('{E}', eye))
  let lines = [...body]
  if (props.hat !== 'none' && !lines[0].trim()) lines[0] = HAT_LINES[props.hat]
  if (!lines[0].trim() && props.species.frames.every((f) => !f[0].trim())) lines.shift()
  return lines.join('\n')
})

function showBubble(group: 'interact' | 'idle' | 'awaiting' | 'done') {
  bubble.value = pickQuip(group, props.stats)
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => { bubble.value = '' }, 3000)
}

/** rAF 驱动呼吸浮动 + idle 帧推进 + 3D 交互合成（规避 prefers-reduced-motion 冻结）。
 *  el.style.transform 的唯一写入者。 */
function runFloat() {
  const el = bodyEl.value
  frame += 1
  if (frame % 30 === 0) tick.value += 1
  if (el) {
    // 交互状态阻尼逼近：tilt 向目标倾斜收敛，squish 向 1 恢复（点击弹跳回弹）
    tiltX += (targetTiltX - tiltX) * DAMP
    tiltY += (targetTiltY - tiltY) * DAMP
    squish += (1 - squish) * DAMP
    const y = Math.sin(frame * 0.05) * props.floatAmp
    const breathe = 1 + Math.sin(frame * 0.1) * 0.01
    const scale = breathe * squish
    el.style.transform = `translateY(${y}px) scale(${scale}) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`
  }
  rafId = requestAnimationFrame(runFloat)
}

function onInteract() {
  // 点击反应：squish 快速置低，由 runFloat 每帧阻尼恢复回 1（轻量缩放弹跳）
  squish = 0.96
  showBubble('interact')
}

function onHover(active: boolean) {
  // hover 立体倾斜：active 时目标 ±tilt，离开归零；tilt=0 时无 3D 效果
  targetTiltX = active ? -props.tilt : 0
  targetTiltY = active ? props.tilt : 0
}

watch(frameKey, () => {
  // 关键帧切换时顺带一句状态吐槽（低频：仅 awaiting/done）
  if (props.state === 'awaiting_permission') showBubble('awaiting')
  else if (props.state === 'done') showBubble('done')
})

onMounted(() => {
  rafId = requestAnimationFrame(runFloat)
})
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  if (bubbleTimer) clearTimeout(bubbleTimer)
})
</script>

<style scoped>
.buddy { position: relative; display: inline-block; user-select: none; }
/* 注意：不设 transition: transform —— rAF 每帧已写终值，transition 会让动画叠出拖影 */
.buddy-body { cursor: pointer; transform-style: preserve-3d; }
.buddy-pre {
  /* --font-mono 未在 theme.css 定义，补等宽回退保证 ASCII 对齐 */
  font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace);
  font-size: 12px;
  line-height: 1.1;
  margin: 0;
  color: var(--text-primary);
  white-space: pre;
}
/* Shiny：金色 + 金色光晕 */
.buddy.shiny .buddy-pre { color: #e3b341; }
.buddy.shiny .buddy-body { text-shadow: 0 0 6px #d2992288; }
.buddy-bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 180px;
  padding: 6px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
  white-space: normal;
  z-index: 10;
}
.buddy-bubble::after {
  content: '';
  position: absolute;
  top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: var(--bg-panel);
}
.buddy-pop-enter-active, .buddy-pop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.buddy-pop-enter-from, .buddy-pop-leave-to { opacity: 0; transform: translateX(-50%) scale(0.9); }
</style>
