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
        <span class="tab-icon">
          <Icon v-if="tab.type === 'welcome'" name="bot" :size="12" />
          <Icon v-else-if="tab.type === 'settings'" name="settings" :size="12" />
          <Icon v-else-if="isRunning(tab.id)" name="loader" :size="12" class="spin" />
          <Icon v-else-if="isAwaitingPermission(tab.id)" name="warning" :size="12" class="pulse-icon" />
          <Icon v-else name="terminal" :size="12" />
        </span>
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
    <button class="tab-new" @click="$emit('create')">
      <Icon name="plus" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import type { Tab } from '../types/tab'

const props = defineProps<{
  tabs: Tab[]
  activeId: string | null
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

function isRunning(tabId: string) {
  const sid = sessionIdFromTab(tabId)
  if (!sid) return false
  const state = sessions.state[sid]
  return state === 'waiting' || state === 'thinking' || state === 'streaming' || state === 'running_tool'
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
  height: 36px;
  min-height: 36px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-strong);
  user-select: none;
  padding: 0 8px;
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
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
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
  border-radius: 8px 8px 0 0;
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
  margin-bottom: 2px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.tab-new:hover {
  background: var(--session-item-hover-bg);
  color: var(--text-primary);
}

.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tab.awaiting .tab-icon {
  color: var(--status-error);
}

.tab.awaiting:not(.active) {
  background: var(--status-error-soft);
}

.tab.active.awaiting::before {
  background: var(--status-error);
}

.pulse-icon {
  animation: pulse-opacity 1s ease-in-out infinite;
}

@keyframes pulse-opacity {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
