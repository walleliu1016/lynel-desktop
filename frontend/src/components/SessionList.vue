<template>
  <div class="session-list">
    <div class="header">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ active: filter === t.key }"
          @click="filter = t.key"
        >{{ t.label }}</button>
      </div>
      <button class="add" @click="$emit('create')">+ 新建</button>
    </div>
    <div class="items">
      <SessionItem
        v-for="s in filteredList"
        :key="s.id"
        :meta="s"
        :is-active="s.id === activeId"
        :dup="dupProjects.has(projectName(s))"
        @select="$emit('select', s.id)"
      />
      <div v-if="!filteredList.length" class="empty">
        {{ filter === 'running' ? '暂无运行中的会话' : filter === 'ended' ? '暂无已结束的会话' : '暂无会话' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import SessionItem from './SessionItem.vue'
import { useSessionsStore } from '../stores/sessions'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ list: SessionMeta[]; activeId: string | null }>()
defineEmits<{
  (e: 'create'): void
  (e: 'select', id: string): void
}>()

const sessions = useSessionsStore()

type TabKey = 'running' | 'idle' | 'ended'
const filter = ref<TabKey>('idle')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'running', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'ended', label: '结束' },
]

const filteredList = computed(() => {
  return props.list.filter((s) => {
    const st = sessions.state[s.id] || 'idle'
    switch (filter.value) {
      case 'running': return st === 'running' || st === 'awaiting_permission'
      case 'ended': return st === 'done' || st === 'ended'
      default: return st === 'idle'
    }
  })
})

const dupProjects = computed(() => {
  const counts: Record<string, number> = {}
  for (const s of props.list) {
    const name = projectName(s)
    counts[name] = (counts[name] || 0) + 1
  }
  return new Set(Object.keys(counts).filter((k) => counts[k] > 1))
})

function projectName(s: SessionMeta): string {
  const wd = s.workdir
  if (!wd || wd === '/') return wd
  return wd.split('/').filter(Boolean).pop() || wd
}
</script>

<style scoped>
.session-list { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px 0 12px; border-bottom: 1px solid var(--border);
  flex-shrink: 0; height: 38px; gap: 8px;
}
.tabs { display: flex; gap: 2px; }
.tab {
  padding: 4px 10px; border-radius: var(--radius-sm);
  font-size: 11px; color: var(--text-tertiary);
  border-bottom: 2px solid transparent;
}
.tab:hover { color: var(--text-secondary); }
.tab.active { color: var(--accent-light); border-bottom-color: var(--accent); }
.add {
  padding: 3px 10px; border-radius: var(--radius-md);
  background: var(--accent); color: white;
  font-size: 11px; font-weight: 500; flex-shrink: 0;
}
.add:hover { background: var(--accent-deep); }
.items { flex: 1; overflow-y: auto; padding: 6px; min-height: 0; }
.empty { color: var(--text-tertiary); font-size: 11px; text-align: center; padding: 20px; }
</style>
