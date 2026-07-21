<template>
  <div
    class="session-item"
    :class="{ active: isActive, awaiting: state === 'awaiting_permission' }"
    @click="$emit('select')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @contextmenu.prevent="onContextMenu"
    ref="itemEl"
  >
    <div class="cc-icon">CC</div>
    <div class="body">
      <div class="row1">
        <input
          v-if="editing"
          ref="inputEl"
          v-model="editValue"
          class="title-input"
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.escape="cancelRename"
        />
        <span v-else class="title" :title="title">{{ title }}</span>
        <span v-if="stateLabel" class="state-tag" :class="state">{{ stateLabel }}</span>
      </div>
      <div class="row2">
        <span class="meta" :title="`${projectName} · ${msgCount} · ${duration}`">{{ projectName }} · {{ msgCount }} · {{ duration }}</span>
      </div>
      <div v-if="eventText" class="event">{{ eventText }}</div>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="context-menu-overlay"
      @click="closeMenu"
      @contextmenu.prevent="closeMenu"
    >
      <div class="context-menu" :style="menuStyle" @click.stop>
        <button class="menu-item" @click="startRename">重命名</button>
        <button class="menu-item" @click="copySessionId">复制 Session ID</button>
      </div>
    </div>
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
import { computed, ref, nextTick } from 'vue'
import SessionTooltip from './SessionTooltip.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { showToast } from '../composables/useToast'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; isActive: boolean; dup?: boolean }>()
const emit = defineEmits<{ (e: 'select'): void }>()

const sessions = useSessionsStore()
const showTip = ref(false)
const itemEl = ref<HTMLElement | null>(null)
const tipAnchor = ref({ x: 0, y: 0 })
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const editing = ref(false)
const editValue = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const menuOpen = ref(false)
const menuStyle = ref({ top: '0px', left: '0px' })

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTimer = setTimeout(() => {
    showTip.value = true
    if (itemEl.value) {
      const r = itemEl.value.getBoundingClientRect()
      tipAnchor.value = { x: r.right + 8, y: r.top }
    }
  }, 3000)
}
function onLeave() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  hideTimer = setTimeout(() => { showTip.value = false }, 150)
}

function closeMenu() {
  menuOpen.value = false
}
function cancelHide() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  menuOpen.value = true
  menuStyle.value = { top: `${e.clientY}px`, left: `${e.clientX}px` }
}

function startRename() {
  menuOpen.value = false
  editing.value = true
  editValue.value = sessionDisplayTitle(props.meta)
  void nextTick(() => inputEl.value?.focus())
}

async function commitRename() {
  if (!editing.value) return
  const trimmed = editValue.value.trim()
  editing.value = false
  if (!trimmed || trimmed === sessionDisplayTitle(props.meta)) return
  try {
    await sessions.renameSession(props.meta.id, trimmed)
  } catch (e: any) {
    alert('重命名失败：' + (e?.message ?? e))
  }
}

function cancelRename() {
  editing.value = false
}

function copySessionId() {
  menuOpen.value = false
  void navigator.clipboard.writeText(props.meta.id).then(() => {
    showToast('已复制', 'success')
  })
}

const title = computed(() => sessionDisplayTitle(props.meta))

const msgCount = computed(() => {
  const n = props.meta.msg_count || 0
  return n ? `${n} 条消息` : '暂无消息'
})

const eventText = computed(() => {
  if (props.meta.lastEvent) {
    return `${props.meta.lastEvent.type} · ${props.meta.lastEvent.summary}`
  }
  return ''
})

const projectName = computed(() => {
  const name = props.meta.project || props.meta.workdir || '新会话'
  if (props.dup) {
    return name + ' #' + props.meta.id.slice(0, 4)
  }
  return name
})

const duration = computed(() => {
  const mtime = props.meta.mtime
  if (!mtime || mtime <= 0) return '刚刚'
  const now = Date.now()
  const ms = now - mtime * 1000
  if (ms < 0) return '刚刚'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  const mon = Math.floor(day / 30)
  if (mon > 12) return '很久以前'
  return `${mon}mo`
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
.session-item:active { background: var(--session-item-hover-bg); transform: scale(0.995); }
.session-item.active {
  background: var(--session-item-active-bg);
  border-color: var(--accent-soft-border);
  box-shadow: inset 4px 0 0 var(--accent);
}
.session-item.awaiting {
  border-color: var(--status-error);
  background: var(--status-error-soft);
}
.session-item.awaiting.active {
  box-shadow: inset 4px 0 0 var(--status-error);
}
.session-item.awaiting .state-tag.awaiting_permission {
  animation: pulse-opacity 1.2s ease-in-out infinite;
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
.title-input {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 2px 6px;
  outline: none;
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
  color: var(--status-success);
  background: var(--status-success-soft);
}
.row2 { margin-top: 2px; }
.meta { font-size: 10px; color: var(--text-tertiary); }
.event {
  font-size: 10px; color: var(--text-secondary); margin-top: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.event :deep(b), .event b { font-weight: 600; color: var(--text-primary); }
.context-menu-overlay {
  position: fixed; inset: 0; z-index: 999;
}
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-panel);
  padding: 4px;
  min-width: 140px;
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--session-item-hover-bg);
}
@keyframes pulse-opacity {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
