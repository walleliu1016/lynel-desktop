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
    <AgentBadge :agent="props.meta.agent" size="sm" />
    <div class="body">
      <div class="row-top">
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
        <div class="right-group">
          <span class="time">{{ duration }}</span>
          <span v-if="stateDotClass" class="dot" :class="stateDotClass"></span>
        </div>
      </div>
      <div class="row-bottom">
        <span class="meta" :title="`${projectName} · ${msgCount}`">{{ projectName }} · {{ msgCount }}</span>
        <span v-if="currentBotName" class="bot-tag"><Icon name="bot" :size="10" />{{ currentBotName }}</span>
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
        <div class="menu-divider" />
        <button v-if="!currentBotId" class="menu-item" @click="openBotPicker">绑定 Bot</button>
        <template v-else>
          <button class="menu-item" @click="openBotPicker">切换 Bot{{ currentBotName ? `（${currentBotName}）` : '' }}</button>
          <button class="menu-item unbind-menu-item" @click="unbindBot">
            <Icon name="link-2-off" :size="12" />
            解除绑定
          </button>
        </template>
      </div>
    </div>
    <!-- Bot 选择浮层（与右键菜单同级，独立全屏遮罩） -->
    <div v-if="showBotPicker" class="context-menu-overlay picker-overlay" @click="showBotPicker = false">
      <div class="context-menu bot-picker" :style="menuStyle" @click.stop>
        <div class="picker-title">选择机器人（{{ botList.length }} 个）</div>
        <button
          class="menu-item"
          @click="onSelectBot(null)"
        >不绑定</button>
        <div
          v-for="b in botList"
          :key="b.id"
          class="menu-item bot-row"
          :class="{ selected: b.id === currentBotId, disabled: !isBotAvailable(b.id) }"
        >
          <button
            class="bot-select"
            :disabled="!isBotAvailable(b.id)"
            :title="getBotBoundSessionName(b.id) ? `已绑定到 ${getBotBoundSessionName(b.id)}` : ''"
            @click="onSelectBot(b.id)"
          >
            <span class="bot-name">{{ b.name || b.botId }}</span>
          </button>
          <span v-if="getBotBoundSessionName(b.id)" class="bound-hint">{{ getBotBoundSessionName(b.id) }}</span>
          <button
            v-if="b.id === currentBotId"
            class="unbind-btn"
            title="解除绑定"
            @click="onSelectBot(null)"
          >
            <Icon name="link-2-off" :size="13" />
          </button>
        </div>
      </div>
    </div>
    <SessionTooltip
      v-if="showTip"
      :meta="meta"
      :anchor="tipAnchor"
      :settings-path="settingsPath"
      @mouseenter="cancelHide"
      @mouseleave="onLeave"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import AgentBadge from './AgentBadge.vue'
import SessionTooltip from './SessionTooltip.vue'
import Icon from './Icon.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useBotsStore } from '../stores/bots'
import { pushToast } from '../composables/useToast'

import { ClipboardWrite, GetSessionSettingsPath } from '../composables/useElectron'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; isActive: boolean; dup?: boolean }>()
const emit = defineEmits<{ (e: 'select'): void }>()

const sessions = useSessionsStore()
const botsStore = useBotsStore()
const showTip = ref(false)
const itemEl = ref<HTMLElement | null>(null)
const tipAnchor = ref({ x: 0, y: 0 })
const showBotPicker = ref(false)
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const editing = ref(false)
const editValue = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const menuOpen = ref(false)
const menuStyle = ref({ top: '0px', left: '0px' })

const settingsPath = ref('')

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTimer = setTimeout(() => {
    showTip.value = true
    if (itemEl.value) {
      const r = itemEl.value.getBoundingClientRect()
      tipAnchor.value = { x: r.right + 8, y: r.top }
    }
    GetSessionSettingsPath(props.meta.id).then((p) => { settingsPath.value = p }).catch(() => {})
  }, 1000)
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

async function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  menuStyle.value = { top: `${e.clientY}px`, left: `${e.clientX}px` }
  // 先权威读取当前会话绑定（主进程按 sessionId 查，不受同 bot 多会话去重影响），
  // 再打开菜单，确保「切换/解除绑定」正确显示。
  await sessions.refreshSessionBotBinding(props.meta.id)
  await sessions.loadBotNames()
  menuOpen.value = true
  console.log('[session-item] context menu opened for', props.meta.id.slice(0, 8), 'bots loaded:', botsStore.bots.length)
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
  void ClipboardWrite(props.meta.id).then(() => {
    pushToast({ level: 'info', source: 'session', message: '已复制' })
  }).catch(() => {
    pushToast({ level: 'error', source: 'session', message: '复制失败' })
  })
}

function openBotPicker() {
  console.log('[session-item] open bot picker, bots:', botList.value.map(b => ({ id: b.id.slice(0, 8), name: b.name })))
  menuOpen.value = false
  showBotPicker.value = true
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

// 每分钟更新一次，驱动 duration 重新计算
const tick = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => { tick.value++ }, 60000)
  void botsStore.load()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const duration = computed(() => {
  void tick.value // 依赖 tick 确保每分钟重算
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

const stateDotClass = computed(() => {
  switch (state.value) {
    case 'waiting':
    case 'thinking':
    case 'streaming':
    case 'running_tool':
      return 'running'
    case 'awaiting_permission': return 'awaiting'
    case 'done':
    case 'ended':
      return 'done'
    default: return ''
  }
})

// Bot 绑定
const currentBotName = computed(() => sessions.getSessionBotName(props.meta.id))
const currentBotId = computed(() => sessions.getSessionBotId(props.meta.id))

const botList = computed(() => botsStore.bots)

function getBotBoundSessionName(botId: string): string | undefined {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  if (!sessionId || sessionId === props.meta.id) return undefined
  return sessions.getBotBoundSessionName(botId)
}

function isBotAvailable(botId: string): boolean {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  return !sessionId || sessionId === props.meta.id
}


async function onSelectBot(botId: string | null) {
  console.log('[session-item] select bot', botId, 'for session', props.meta.id.slice(0, 8))
  showBotPicker.value = false
  menuOpen.value = false
  try {
    await sessions.bindBot(props.meta.id, botId)
    console.log('[session-item] bindBot succeeded')
    pushToast({ level: 'info', source: 'session', message: botId ? '已绑定 Bot' : '已解除绑定' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'session', message: '操作失败：' + (e?.message ?? e) })
  }
}

async function unbindBot() {
  menuOpen.value = false
  try {
    await sessions.bindBot(props.meta.id, null)
    pushToast({ level: 'info', source: 'session', message: '已解除绑定' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'session', message: '解除绑定失败：' + (e?.message ?? e) })
  }
}
</script>

<style scoped>
.session-item {
  display: flex; align-items: stretch; gap: 10px;
  padding: 10px; border-radius: var(--radius-sm);
  cursor: pointer; position: relative;
  background: transparent;
  transition: background 0.12s;
}
.session-item:hover { background: var(--session-item-hover-bg); }
.session-item:active { background: var(--session-item-hover-bg); }
.session-item.active {
  background: var(--session-item-active-bg);
}
.session-item.active .title { color: var(--accent); }
.session-item.awaiting {
  background: var(--status-error-soft);
}
.body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  justify-content: center; gap: 3px;
}
.row-top {
  display: flex; align-items: center; gap: 8px;
}
.title {
  flex: 1; min-width: 0;
  font-size: var(--fs-body); color: var(--text-primary); font-weight: 500;
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
.right-group {
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.time {
  font-size: var(--fs-caption); color: var(--text-tertiary);
  white-space: nowrap;
}
.dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0;
}
.dot.running {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent-glow);
}
.dot.done { background: var(--status-success); }
.dot.awaiting {
  background: var(--status-error);
  animation: pulse-opacity 1.2s ease-in-out infinite;
}
.row-bottom {
  display: flex; align-items: center; gap: 8px;
}
.meta {
  flex: 1;
  font-size: var(--fs-body-sm); color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bot-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9px; padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent-soft-bg);
  color: var(--accent-light);
  white-space: nowrap; flex-shrink: 0;
}
.event {
  font-size: var(--fs-body-sm); color: var(--text-secondary); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.event :deep(b), .event b { font-weight: 600; color: var(--text-primary); }
.context-menu-overlay {
  position: fixed; inset: 0; z-index: 999;
}
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--material-bg);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-window);
  padding: 4px;
  min-width: 140px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
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
  background: var(--bg-hover);
}
.menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.menu-item:disabled:hover {
  background: transparent;
}
.bound-hint {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--status-success);
  background: var(--status-success-soft);
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 8px;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu-divider {
  height: 1px; background: var(--border); margin: 4px 0;
}
.picker-overlay { z-index: 1001; }
.bot-picker .menu-item {
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  padding: 8px 10px;
}
.bot-picker .menu-item:last-of-type {
  border-bottom: none;
}
.bot-picker .menu-item:hover {
  background: var(--bg-hover);
}
.bot-picker { min-width: 200px; }
.picker-title {
  padding: 6px 10px; font-size: var(--fs-body-sm); color: var(--text-tertiary);
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
}
.menu-item.selected { color: var(--accent); font-weight: 600; }

.bot-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bot-picker .bot-row { padding: 0; }
.bot-row.selected .bot-select { color: var(--accent); font-weight: 600; }
.bot-row.disabled { opacity: 0.45; cursor: not-allowed; }
.bot-picker .bot-row.disabled:hover { background: transparent; }
.bot-select {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.bot-select:disabled { cursor: not-allowed; }
.bot-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.unbind-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--status-error);
  cursor: pointer;
}
.unbind-btn:hover { background: var(--status-error-soft); }
.unbind-menu-item { color: var(--status-error); }
.unbind-menu-item:hover { color: var(--status-error); }
@keyframes pulse-opacity {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
