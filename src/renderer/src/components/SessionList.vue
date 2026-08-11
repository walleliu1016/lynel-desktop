<template>
  <div class="session-list" :class="{ collapsed: props.collapsed }">
    <div v-if="!props.collapsed" class="content">
      <div class="sidehead">
        <button class="sidehead-toggle" :title="expanded ? '收起会话' : '展开会话'" @click="expanded = !expanded">
          <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="12" />
          <span>会话列表({{ filteredList.length }})</span>
        </button>
        <div class="sidehead-actions">
          <slot name="actions" />
        </div>
      </div>
      <div v-show="expanded" class="items">
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
            {{ props.search ? '无匹配结果' : '暂无会话' }}
          </div>
        </template>
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

const props = defineProps<{ list: SessionMeta[]; activeId: string | null; collapsed?: boolean; search?: string }>()
defineEmits<{
  (e: 'select', id: string): void
}>()

const sessions = useSessionsStore()
// 会话列表内部展开/收起（区别于侧边栏折叠）
const expanded = ref(true)

const filteredList = computed(() => {
  const q = (props.search || '').trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((s) => {
    const pn = s.project.toLowerCase()
    const wd = s.workdir.toLowerCase()
    const title = (s.user_title || s.first_prompt || s.ai_title || '').toLowerCase()
    const sid = s.id.toLowerCase()
    return pn.includes(q) || wd.includes(q) || title.includes(q) || sid.includes(q)
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
.session-list { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 8px 12px 12px; }
.session-list.collapsed { padding: 8px 4px; align-items: center; }
.session-list.collapsed .content { display: none; }
.sidehead {
  margin: 4px 4px 8px;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.sidehead-toggle {
  display: flex; align-items: center; gap: 4px;
  border: none; background: transparent;
  color: var(--text-secondary);
  font-size: 11px; font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 6px;
  transition: color 0.12s, background 0.12s;
}
.sidehead-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-input);
}
.sidehead-actions {
  display: flex; align-items: center; gap: 2px;
  flex-shrink: 0;
}
.items { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; }

.content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
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
