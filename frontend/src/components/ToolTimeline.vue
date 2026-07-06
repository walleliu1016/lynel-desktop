<template>
  <aside class="timeline" :class="{ collapsed }">
    <div class="timeline-header">
      <button
        class="icon-btn toggle-btn"
        :title="collapsed ? '展开时间线' : '收起时间线'"
        @click.stop="collapsed = !collapsed"
      >
        <span class="timeline-title" :class="{ collapsed }">Timeline</span>
        <span class="toggle-icon" :class="{ collapsed }">
          <Icon name="chevron-right" :size="12" />
        </span>
      </button>
      <div v-show="!collapsed" class="filter-bar">
        <button
          v-for="opt in filterOptions"
          :key="opt.value"
          class="filter-btn"
          :class="{ active: filter === opt.value }"
          :title="opt.label"
          @click="filter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
    <div v-show="!collapsed" ref="listRef" class="timeline-list" @scroll="onScroll">
      <ToolTimelineItem
        v-for="item in filteredList"
        :key="item.id"
        :item="item"
      />
      <div v-if="filteredList.length === 0" class="empty">
        暂无执行记录
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ToolExecution } from '../types/session'
import Icon from './Icon.vue'
import ToolTimelineItem from './ToolTimelineItem.vue'

const props = defineProps<{
  executions: Record<string, ToolExecution[]>
  activeId: string | null
}>()

const collapsed = defineModel<boolean>('collapsed', { default: false })

const filter = ref<'all' | 'tool' | 'llm' | 'error'>('all')
const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'tool', label: '工具' },
  { value: 'llm', label: 'LLM' },
  { value: 'error', label: '失败' },
] as const

const list = computed(() => {
  if (!props.activeId) return []
  return props.executions[props.activeId] || []
})

const filteredList = computed(() => {
  if (filter.value === 'all') return list.value
  if (filter.value === 'error') return list.value.filter((item) => item.status === 'error')
  return list.value.filter((item) => item.kind === filter.value)
})

const listRef = ref<HTMLElement | null>(null)
const userScrolledUp = ref(false)

const AUTO_SCROLL_THRESHOLD = 60

function isNearBottom() {
  const el = listRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
}

function scrollToBottom() {
  const el = listRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onScroll() {
  userScrolledUp.value = !isNearBottom()
}

// 首次加载或切换会话时滚动到底部，并将筛选重置为默认
watch(() => props.activeId, () => {
  filter.value = 'all'
  userScrolledUp.value = false
  nextTick(scrollToBottom)
})

// 列表变化时：若用户未主动上翻，则自动滚动到底部
watch(filteredList, () => {
  nextTick(() => {
    if (!userScrolledUp.value || isNearBottom()) {
      scrollToBottom()
    }
  })
})

onMounted(() => {
  scrollToBottom()
})
</script>

<style scoped>
.timeline {
  width: 260px;
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  transition: width 0.2s ease;
  z-index: 1;
}
.timeline.collapsed {
  width: 36px;
}
.timeline-header {
  height: 40px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  flex-shrink: 0;
  gap: 8px;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}
.filter-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.filter-btn:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
.filter-btn.active {
  background: var(--accent-soft-bg);
  color: var(--accent-light);
  border-color: var(--accent-soft-border);
}
.timeline-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 0.2s ease, width 0.2s ease;
}
.timeline-title.collapsed {
  opacity: 0;
  width: 0;
}
.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 11px;
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}
.toggle-btn {
  gap: 6px;
}
.toggle-icon {
  font-size: 10px;
  display: inline-block;
  transform: rotate(0deg);
  transition: transform 0.2s ease;
}
.toggle-icon.collapsed {
  transform: rotate(180deg);
}
.timeline-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
  min-height: 0;
}
.timeline-list::-webkit-scrollbar {
  width: 6px;
}
.timeline-list::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
.timeline-list::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}
.timeline-list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>
