<template>
  <div class="global-tabs">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === activeId, awaiting: isAwaitingPermission(tab.id) }"
        @click="$emit('select', tab.id)"
        @mousedown="onMouseDown($event, tab.id)"
        @mouseenter="hoverId = tab.id"
        @mouseleave="hoverId = null"
      >
        <span v-if="tab.id === activeId" class="tab-bridge left">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M12 0 A12 12 0 0 0 0 12 L12 12 Z" class="bridge-fill" />
            <path d="M12 0 A12 12 0 0 0 0 12" class="bridge-arc" />
          </svg>
        </span>
        <span v-if="tab.id === activeId" class="tab-bridge right">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M0 0 A12 12 0 0 1 12 12 L0 12 Z" class="bridge-fill" />
            <path d="M0 0 A12 12 0 0 1 12 12" class="bridge-arc" />
          </svg>
        </span>
        <span v-if="tab.type !== 'session'" class="tab-icon">
          <Icon v-if="tab.type === 'welcome'" name="bot" :size="12" />
          <Icon v-else-if="tab.type === 'settings'" name="settings" :size="12" />
          <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
        </span>
        <!-- 会话 tab：左侧直接用 agent 标识（CC/CX/OC/PI）替代转圈状态图标；待审批以 tab 背景色提示 -->
        <AgentBadge v-if="tab.type === 'session'" :agent="sessionAgent(tab.id)" size="sm" class="tab-agent" />
        <span class="tab-title" :title="tooltipFor(tab)">{{ tab.title }}</span>
        <span
          v-if="showClose(tab.id)"
          class="tab-close"
          @click.stop="$emit('close', tab.id)"
        >
          <Icon name="close" :size="12" />
        </span>
      </div>
    </div>
    <button v-if="!hideNew" class="tab-new" @click="$emit('create')">
      <Icon name="plus" :size="16" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import AgentBadge from './AgentBadge.vue'
import Icon from './Icon.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import type { Tab } from '../types/tab'

const props = defineProps<{
  tabs: Tab[]
  activeId: string | null
  hideNew?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  create: []
}>()

const sessions = useSessionsStore()
const hoverId = ref<string | null>(null)

function sessionIdFromTab(tabId: string): string | null {
  if (!tabId.startsWith('session-')) return null
  return tabId.slice(8)
}

function sessionAgent(tabId: string): string | undefined {
  const sid = sessionIdFromTab(tabId)
  if (!sid) return undefined
  return sessions.list.find((s) => s.id === sid)?.agent
}

function isAwaitingPermission(tabId: string) {
  const sid = sessionIdFromTab(tabId)
  if (!sid) return false
  return sessions.state[sid] === 'awaiting_permission'
}

function tooltipFor(tab: Tab) {
  if (tab.type !== 'session') return tab.title
  const sid = sessionIdFromTab(tab.id)
  if (!sid) return tab.title
  const meta = sessions.list.find((s) => s.id === sid)
  const state = sessions.state[sid] || 'idle'
  return [
    sessionDisplayTitle(meta ?? { id: sid }),
    `项目：${meta?.project || meta?.workdir || '未知'}`,
    `Session：${sid}`,
    `状态：${state}`,
  ].join('\n')
}

function showClose(id: string) {
  return id === props.activeId || hoverId.value === id
}

function onMouseDown(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    emit('close', id)
  }
}
</script>

<style scoped>
.global-tabs {
  display: flex;
  align-items: flex-end;
  height: 32px;
  min-height: 32px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-strong);
  user-select: none;
  padding: 0 8px 0 0;
  gap: 2px;
}

.tabs-scroll {
  flex: 1;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tabs-scroll::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  max-width: 180px;
  min-width: 80px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  /* Chrome 风格：顶部大弧形，底部直角与内容区融合 */
  border-radius: 12px 12px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  position: relative;
  transition: background 0.12s, border-color 0.12s;
}

.tab:hover {
  background: var(--session-item-hover-bg);
}

.tab.active {
  background: var(--bg-terminal);
  color: var(--text-primary);
  border-color: var(--border-strong);
  border-bottom: 1px solid var(--bg-terminal);
  margin-bottom: -1px;
  z-index: 1;
}

.tab.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 12px 12px 0 0;
}

/* Chrome 风格底部裙边：激活标签两侧底部鼓出的弧形扇面（内容色填充 + 1px 弧形描边） */
.tab.active .tab-bridge {
  position: absolute;
  bottom: -1px;
  width: 12px;
  height: 12px;
  pointer-events: none;
}
.tab-bridge.left { left: -12px; }
.tab-bridge.right { right: -12px; }
.tab-bridge svg {
  display: block;
  overflow: visible;
}
.tab-bridge path.bridge-fill { fill: var(--bg-terminal); stroke: none; }
.tab-bridge path.bridge-arc {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-linecap: round;
}

.tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.tab.active .tab-icon {
  color: var(--accent);
}

.tab-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 覆盖 AgentBadge 自身 .sm 尺寸（特异性更高，需 !important 才能生效） */
.tab-agent { width: 16px !important; height: 16px !important; border-radius: 4px !important; font-size: 8px !important; }

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}

.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 0.7;
}

.tab-close:hover {
  background: var(--status-error-soft);
  color: var(--status-error);
}

.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 0;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  transition: background 0.12s, color 0.12s;
}

.tab-new:hover {
  background: var(--session-item-hover-bg);
  color: var(--text-primary);
}

.tab.awaiting:not(.active) {
  background: var(--status-error-soft);
}

.tab.active.awaiting::before {
  background: var(--status-error);
}
</style>
