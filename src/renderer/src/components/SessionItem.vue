<template>
  <div
    class="session-item"
    :class="{ active: isActive }"
    @click="$emit('select')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    ref="itemEl"
  >
    <div class="cc-icon">CC</div>
    <div class="body">
      <div class="row1">
        <span class="title" :title="title">{{ title }}</span>
        <span v-if="stateLabel" class="state-tag" :class="state">{{ stateLabel }}</span>
      </div>
      <div class="row2">
        <span class="meta" :title="`${projectName} · ${duration}`">{{ projectName }} · {{ duration }}</span>
      </div>
      <div v-if="eventText" class="event">{{ eventText }}</div>
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

const title = computed(() => props.meta.ai_title || props.meta.first_prompt || props.meta.id?.slice(0, 8) || '新会话')

const eventText = computed(() => {
  if (props.meta.lastEvent) {
    return `${props.meta.lastEvent.type} · ${props.meta.lastEvent.summary}`
  }
  return props.meta.ai_title || props.meta.first_prompt || ''
})

const projectName = computed(() => {
  const name = props.meta.project || props.meta.workdir || '新会话'
  if (props.dup) {
    return name + ' #' + props.meta.id.slice(0, 4)
  }
  return name
})

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

const stateLabel = computed(() => {
  switch (state.value) {
    case 'waiting':
    case 'thinking':
    case 'streaming':
    case 'running_tool':
      return '运行中'
    case 'awaiting_permission': return '等待授权'
    case 'done': return '已完成'
    case 'ended': return '已结束'
    default: return ''
  }
})
</script>

<style scoped>
.session-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px; border-radius: var(--radius-lg);
  cursor: pointer; position: relative;
  background: transparent;
  border: 1px solid transparent;
  margin-bottom: 6px;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
}
.session-item:hover { background: var(--session-item-hover-bg); }
.session-item.active {
  background: var(--session-item-active-bg);
  border-color: var(--accent-soft-border);
  box-shadow: inset 4px 0 0 var(--status-error);
}
.cc-icon {
  width: 30px; height: 30px; border-radius: 9px;
  background: var(--accent-soft-bg);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; letter-spacing: 0.2px;
  flex-shrink: 0; margin-top: 1px;
}
.body { flex: 1; min-width: 0; }
.row1 {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.title {
  font-size: 12px; color: var(--text-primary); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.state-tag {
  font-size: 9px; font-weight: 700; white-space: nowrap;
  padding: 2px 6px; border-radius: 6px; flex-shrink: 0;
}
.state-tag.waiting,
.state-tag.thinking,
.state-tag.streaming,
.state-tag.running_tool {
  color: var(--accent);
  background: var(--accent-soft-bg);
}
.state-tag.awaiting_permission {
  color: var(--status-error);
  background: var(--status-error-soft);
}
.state-tag.done,
.state-tag.ended {
  color: #047857;
  background: #ecfdf5;
}
.row2 { margin-top: 2px; }
.meta { font-size: 10px; color: var(--text-tertiary); }
.event {
  font-size: 10px; color: var(--text-secondary); margin-top: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.event :deep(b), .event b { font-weight: 600; color: var(--text-primary); }
</style>
