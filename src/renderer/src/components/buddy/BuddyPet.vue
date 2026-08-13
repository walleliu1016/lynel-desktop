<template>
  <div class="buddy" :class="[className, `personality-${role.personality}`]">
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
import type { BuddyFrameKey, BuddyRole, BuddyStats } from '../../data/buddies/types'
import { pickQuip } from '../../data/buddies/quips'

const props = withDefaults(defineProps<{
  role: BuddyRole
  stats: BuddyStats
  state?: SessionState | null
  className?: string
}>(), {
  state: null,
  className: '',
})

/** 阻尼系数：每帧向目标值逼近的比例（1/0.3 ≈ 3.3 帧收敛约 97%） */
const DAMP = 0.3

const bodyEl = ref<HTMLElement | null>(null)
const bubble = ref<string>('')
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let rafId = 0
let frame = 0
// 交互状态：hover 立体倾斜目标值 + 点击挤压量。
// 它们不直接写元素，而是由 runFloat 每帧合成进 transform，
// 保证 el.style.transform 只有 runFloat 一个写入者，避免与呼吸浮动争抢属性。
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

const frameText = computed(() => props.role.frames[frameKey.value].join('\n'))

function showBubble(group: 'interact' | 'idle' | 'awaiting' | 'done') {
  bubble.value = pickQuip(group, props.stats)
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => { bubble.value = '' }, 3000)
}

/** rAF 驱动呼吸浮动：规避 prefers-reduced-motion 冻结（复用 SessionTabContent 的 rAF 模式）。
 *  这是 el.style.transform 的唯一写入者：把呼吸位移/缩放与交互态的倾斜、挤压合成到一起。 */
function runFloat() {
  const el = bodyEl.value
  if (el) {
    const amplitude = props.role.personality === 'chaotic' ? 6 : 3
    const speed = props.role.personality === 'chaotic' ? 0.09 : 0.05
    frame += 1
    // 交互状态阻尼逼近：tilt 向目标倾斜收敛，squish 向 1 恢复（点击弹跳回弹）
    tiltX += (targetTiltX - tiltX) * DAMP
    tiltY += (targetTiltY - tiltY) * DAMP
    squish += (1 - squish) * DAMP
    const y = Math.sin(frame * speed) * amplitude
    const breathe = 1 + Math.sin(frame * speed * 2) * 0.01
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
  // hover 立体倾斜：active 时目标 -8/8，离开归零；由 runFloat 阻尼逼近
  targetTiltX = active ? -8 : 0
  targetTiltY = active ? 8 : 0
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
  /* --shadow-pop 未定义，用面板阴影近似 */
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
