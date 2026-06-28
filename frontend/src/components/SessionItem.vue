<template>
  <div
    class="session-item"
    :class="{ active: isActive }"
    @click="$emit('select')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    ref="itemEl"
  >
    <div class="status-dot" :class="state"></div>
    <div class="body">
      <div class="row1">
        <span class="project">{{ projectName }}</span>
        <span class="duration">{{ duration }}</span>
      </div>
      <div class="row2">{{ displayText }}</div>
    </div>
  </div>
  <Teleport to="body">
    <SessionTooltip
      v-if="showTip"
      :meta="meta"
      :anchor="tipAnchor"
      @mouseenter="cancelHide"
      @mouseleave="onLeave"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import SessionTooltip from './SessionTooltip.vue'
import { useSessionsStore } from '../stores/sessions'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; isActive: boolean; dup?: boolean }>()
defineEmits<{ (e: 'select'): void }>()

const sessions = useSessionsStore()
const showTip = ref(false)
const itemEl = ref<HTMLElement | null>(null)
const tipAnchor = ref({ x: 0, y: 0 })
let hideTimer: ReturnType<typeof setTimeout> | null = null

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTip.value = true
  if (itemEl.value) {
    const r = itemEl.value.getBoundingClientRect()
    tipAnchor.value = { x: r.right + 8, y: r.top }
  }
}
function onLeave() {
  hideTimer = setTimeout(() => { showTip.value = false }, 150)
}
function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
}

const projectName = computed(() => {
  const wd = props.meta.workdir
  if (!wd || wd === '/') return wd
  const name = wd.split('/').filter(Boolean).pop() || wd
  if (props.dup) {
    return name + ' #' + props.meta.id.slice(0, 4)
  }
  return name
})

const displayText = computed(() => props.meta.ai_title || props.meta.first_prompt || props.meta.id?.slice(0, 8) || '新会话')

const duration = computed(() => {
  const now = Date.now()
  const ms = now - props.meta.mtime * 1000
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m 前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h 前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d 前`
  const mon = Math.floor(day / 30)
  return `${mon}mo 前`
})

const state = computed(() => sessions.state[props.meta.id] || 'idle')
</script>

<style scoped>
.session-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-md);
  cursor: pointer; position: relative;
}
.session-item:hover { background: rgba(255,255,255,0.04); }
.session-item.active { background: rgba(124,58,237,0.15); }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0; margin-top: 5px;
}
.status-dot.running { background: var(--status-success); }
.status-dot.awaiting_permission { background: var(--status-warn); }
.status-dot.done { background: var(--text-tertiary); }
.status-dot.ended {
  background: var(--text-tertiary);
  /* 中空圆点 + 灰边框，区别于 done（用户主动 /exit，比 done 更"永久"） */
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-tertiary);
}
.body { flex: 1; min-width: 0; }
.row1 {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px;
}
.project {
  font-size: 12px; color: var(--accent-light); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.duration { font-size: 10px; color: var(--text-tertiary); flex-shrink: 0; }
.row2 {
  font-size: 13px; color: var(--text-primary); margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
</style>
