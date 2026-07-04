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
      <button class="add" @click="$emit('create')">
        <Icon name="plus" :size="12" /> 新建
      </button>
    </div>
    <div class="search-bar">
      <input
        v-model="search"
        class="search-input"
        placeholder="搜索会话…"
        @keydown.escape="search = ''"
      />
      <button v-if="search" class="search-clear" @click="search = ''">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <div class="items">
      <SessionItem
        v-for="s in filteredList"
        :key="s.id"
        :meta="s"
        :is-active="s.id === activeId"
        :dup="dupProjects.has(s.project)"
        @select="$emit('select', s.id)"
      />
      <div v-if="!filteredList.length" class="empty">
        {{ search ? '无匹配结果' : filter === 'running' ? '暂无运行中的会话' : filter === 'ended' ? '暂无已结束的会话' : '暂无会话' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import SessionItem from './SessionItem.vue'
import Icon from './Icon.vue'
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
const search = ref('')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'running', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'ended', label: '结束' },
]

const filteredList = computed(() => {
  const q = search.value.trim().toLowerCase()
  return props.list.filter((s) => {
    const st = sessions.state[s.id] || 'idle'
    // 状态过滤
    let stateMatch = false
    switch (filter.value) {
      case 'running': stateMatch = st !== 'idle' && st !== 'done' && st !== 'ended'; break
      case 'ended': stateMatch = st === 'done' || st === 'ended'; break
      default: stateMatch = st === 'idle'
    }
    if (!stateMatch) return false
    // 搜索过滤
    if (!q) return true
    const pn = s.project.toLowerCase()
    const title = (s.first_prompt || s.ai_title || '').toLowerCase()
    const sid = s.id.toLowerCase()
    return pn.includes(q) || title.includes(q) || sid.includes(q)
  })
})

const dupProjects = computed(() => {
  const counts: Record<string, number> = {}
  for (const s of props.list) {
    counts[s.project] = (counts[s.project] || 0) + 1
  }
  return new Set(Object.keys(counts).filter((k) => counts[k] > 1))
})
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
  font-size: 12px; color: var(--text-tertiary);
  border-bottom: 2px solid transparent;
}
.tab:hover { color: var(--text-secondary); }
.tab.active { color: var(--accent-light); border-bottom-color: var(--accent); }
.add {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: var(--radius-md);
  background: var(--accent); color: white;
  font-size: 12px; font-weight: 500; flex-shrink: 0;
}
.add:hover { background: var(--accent-deep); }
.search-bar {
  position: relative; margin: 6px 6px 0;
  flex-shrink: 0;
}
.search-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 5px 28px 5px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-tertiary); }
.search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 12px; border-radius: 50%;
}
.search-clear:hover { background: var(--border); color: var(--text-primary); }
.items { flex: 1; overflow-y: auto; padding: 6px; min-height: 0; }
.empty { color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 20px; }
</style>
