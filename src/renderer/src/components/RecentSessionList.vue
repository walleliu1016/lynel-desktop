<template>
  <div class="recent-list">
    <div
      v-for="item in visibleList"
      :key="item.sessionId"
      class="recent-item"
      @click="$emit('select', item)"
    >
      <div class="status-dot" :class="item.state" />
      <div class="body">
        <div class="row1">
          <span class="title" :title="displayTitle(item)">{{ displayTitle(item) }}</span>
        </div>
        <div class="row2">
          <span class="meta" :title="metaTitle(item)">{{ item.project }} · {{ item.sessionId.slice(0, 8) }} · {{ duration(item.lastOpenedAt) }}</span>
        </div>
      </div>
    </div>
    <button
      v-if="list.length > limit"
      class="toggle-more"
      @click.stop="expanded = !expanded"
    >
      {{ expanded ? '收起' : `显示另外 ${list.length - limit} 个会话...` }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { sessionDisplayTitle } from '../stores/sessions'
import type { RecentSession } from '../types/recent'

const props = withDefaults(defineProps<{ list: RecentSession[]; limit?: number }>(), {
  limit: 5,
})

defineEmits<{ (e: 'select', item: RecentSession): void }>()

const expanded = ref(false)

const visibleList = computed(() => {
  if (expanded.value) return props.list
  return props.list.slice(0, props.limit)
})

function displayTitle(item: RecentSession) {
  return sessionDisplayTitle({
    id: item.sessionId,
    user_title: item.userTitle,
    ai_title: item.aiTitle,
    first_prompt: item.firstPrompt,
  }) || item.project
}

function metaTitle(item: RecentSession) {
  return `${item.project} · ${item.sessionId} · ${duration(item.lastOpenedAt)}`
}

function duration(lastOpenedAt: number) {
  const ms = Date.now() - lastOpenedAt
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m 前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h 前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d 前`
  const mon = Math.floor(day / 30)
  return `${mon}mo 前`
}
</script>

<style scoped>
.recent-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 4px; }
.recent-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-md);
  cursor: pointer; background: transparent;
  transition: background 0.15s;
}
.recent-item:hover { background: var(--session-item-hover-bg); }
.recent-item:active { background: var(--session-item-hover-bg); transform: scale(0.995); }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0; margin-top: 6px;
}
.status-dot.running { background: var(--status-success); }
.status-dot.done { background: var(--text-tertiary); }
.status-dot.ended { background: var(--text-tertiary); box-shadow: inset 0 0 0 1.5px var(--text-tertiary); background: transparent; }
.status-dot.awaiting_permission { background: var(--status-error); }
.body { flex: 1; min-width: 0; }
.title {
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.meta {
  font-size: 11px; color: var(--text-secondary);
  display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.toggle-more {
  width: 100%; text-align: left;
  padding: 6px 10px; border-radius: var(--radius-md);
  font-size: 12px; color: var(--accent);
  background: transparent;
}
.toggle-more:hover { background: var(--accent-soft-bg); }
</style>
