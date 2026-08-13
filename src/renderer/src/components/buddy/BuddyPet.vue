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
import { useSpring } from '../../composables/useSpring'

const props = withDefaults(defineProps<{
  role: BuddyRole
  stats: BuddyStats
  state?: SessionState | null
  className?: string
}>(), {
  state: null,
  className: '',
})

const { animateTo } = useSpring()
const bodyEl = ref<HTMLElement | null>(null)
const bubble = ref<string>('')
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let rafId = 0
let frame = 0

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

/** rAF 驱动呼吸浮动：规避 prefers-reduced-motion 冻结（复用 SessionTabContent 的 rAF 模式） */
function runFloat() {
  const el = bodyEl.value
  if (el) {
    const amplitude = props.role.personality === 'chaotic' ? 6 : 3
    const speed = props.role.personality === 'chaotic' ? 0.09 : 0.05
    frame += 1
    const y = Math.sin(frame * speed) * amplitude
    const scale = 1 + Math.sin(frame * speed * 2) * 0.01
    el.style.transform = `translateY(${y}px) scale(${scale})`
  }
  rafId = requestAnimationFrame(runFloat)
}

function onInteract() {
  // 点击反应：scale 弹跳（reduce 快路径直接落终值）
  animateTo(bodyEl.value, { scale: 0.96 }, { duration: 0.08 })
  animateTo(bodyEl.value, { scale: 1 }, { duration: 0.2 })
  showBubble('interact')
}

function onHover(active: boolean) {
  animateTo(bodyEl.value, { rotateX: active ? -8 : 0, rotateY: active ? 8 : 0 })
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
.buddy-body { cursor: pointer; transform-style: preserve-3d; transition: transform 0.15s; }
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
