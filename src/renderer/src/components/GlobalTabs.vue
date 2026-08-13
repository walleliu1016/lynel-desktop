<template>
  <div class="global-tabs">
    <div class="tabs-scroll">
      <div
        v-for="tab in visibleTabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === activeId, awaiting: isAwaitingPermission(tab.id) }"
        @click="$emit('select', tab.id)"
        @mousedown="onMouseDown($event, tab.id)"
        @mouseenter="hoverId = tab.id"
        @mouseleave="hoverId = null"
      >
        <span v-if="tab.type !== 'session'" class="tab-icon">
          <Icon v-if="tab.type === 'settings'" name="settings" :size="12" />
          <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
        </span>
        <!-- 会话 tab：左侧直接用 agent 标识（CC/CX/OC/PI）替代转圈状态图标；待审批以 tab 背景色提示 -->
        <AgentBadge v-if="tab.type === 'session'" :agent="sessionAgent(tab.id)" size="sm" class="tab-agent" />
        <span class="tab-title">{{ tab.title }}</span>
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
import { useSessionsStore } from '../stores/sessions'
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

// 过滤掉 welcome 类型 tab，首页不再出现在顶部 tab 栏
const visibleTabs = computed(() => props.tabs.filter((t) => t.type !== 'welcome'))

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
  align-items: center;
  height: 32px;
  min-height: 32px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-strong);
  user-select: none;
  padding: 0 6px;
  gap: 2px;
}

.tabs-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tabs-scroll::-webkit-scrollbar { display: none; }

.tab {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  max-width: 180px; min-width: 72px;
  cursor: pointer; -webkit-app-region: no-drag;
  border: none; background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body-sm); color: var(--text-secondary);
  position: relative; margin: 2px 2px;
  transition: background .15s, color .15s;
}
.tab:hover { background: var(--tab-hover-bg); color: var(--text-primary); }
.tab.active { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); font-weight: 600; }

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
.tab-agent { width: 16px !important; height: 16px !important; border-radius: 4px !important; }

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
</style>
