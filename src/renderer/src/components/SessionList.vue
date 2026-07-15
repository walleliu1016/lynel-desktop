<template>
  <div class="session-list">
    <button class="open-session" @click="$emit('create')">
      <Icon name="folder-open" :size="14" />
      <span>打开 Session</span>
    </button>
    <div class="search-bar">
      <Icon name="message-square" :size="12" class="search-icon" />
      <input
        v-model="search"
        class="search-input"
        placeholder="搜索会话…"
        @keydown.escape="search = ''"
      />
      <button v-if="search" class="search-clear" aria-label="清除搜索" title="清除搜索" @click="search = ''">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <div class="sidehead">
      <span>会话列表</span>
      <span class="count">{{ filteredList.length }}</span>
    </div>
    <div class="items">
      <template v-if="sessions.loading && !list.length">
        <div v-for="i in 6" :key="i" class="skeleton-item">
          <div class="skeleton-icon" />
          <div class="skeleton-lines">
            <div class="skeleton-line short" />
            <div class="skeleton-line" />
          </div>
        </div>
      </template>
      <template v-else>
        <SessionItem
          v-for="s in filteredList"
          :key="s.id"
          :meta="s"
          :is-active="s.id === activeId"
          :dup="dupProjects.has(s.project)"
          @select="$emit('select', s.id)"
        />
        <div v-if="!filteredList.length" class="empty">
          {{ search ? '无匹配结果' : '暂无会话' }}
        </div>
      </template>
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
const search = ref('')

const filteredList = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((s) => {
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
.session-list { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 12px; }
.open-session {
  width: 100%; height: 40px; border-radius: 11px;
  background: var(--accent); color: white;
  font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  flex-shrink: 0;
  transition: background 0.15s;
}
.open-session:hover { background: var(--accent-deep); }
.search-bar {
  position: relative; margin-top: 12px;
  flex-shrink: 0;
}
.search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: var(--text-tertiary); pointer-events: none;
}
.search-input {
  width: 100%; height: 34px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: 9px; padding: 0 28px 0 30px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-tertiary); }
.search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 12px; border-radius: 50%;
}
.search-clear:hover { background: var(--border); color: var(--text-primary); }
.search-clear:active { background: var(--text-tertiary); color: var(--bg-panel); }
.sidehead {
  margin: 14px 4px 8px;
  display: flex; justify-content: space-between; align-items: center;
  color: var(--text-secondary);
  font-size: 11px; font-weight: 700;
  flex-shrink: 0;
}
.sidehead .count {
  font-size: 10px; color: var(--text-tertiary);
}
.items { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; }
.empty { color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 20px; }

.skeleton-item {
  display: flex; align-items: center; gap: 10px;
  padding: 11px; border-radius: var(--radius-lg);
  margin-bottom: 6px;
}
.skeleton-icon {
  width: 30px; height: 30px; border-radius: 9px;
  background: var(--border); flex-shrink: 0;
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.skeleton-line {
  height: 10px; border-radius: var(--radius-sm);
  background: var(--border);
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton-line.short { width: 40%; }
@keyframes pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.75; }
}
</style>
