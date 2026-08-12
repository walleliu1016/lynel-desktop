<template>
  <div class="recent-list" :class="{ expanded }">
    <div
      v-for="item in visibleList"
      :key="item.sessionId"
      class="recent-item"
      @click="$emit('select', item)"
    >
      <span class="status-dot" :class="item.state" />
      <AgentBadge :agent="item.agent" size="sm" class="recent-agent" />
      <span class="title" :title="displayTitle(item)">{{ displayTitle(item) }}</span>
      <span class="meta">{{ item.project }} · {{ duration(item.lastOpenedAt) }}</span>
    </div>
    <button
      v-if="list.length > limit"
      class="toggle-more"
      @click.stop="expanded = !expanded"
    >
      {{ expanded ? '收起' : `另外 ${list.length - limit} 个会话` }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import AgentBadge from './AgentBadge.vue'
import { sessionDisplayTitle } from '../stores/sessions'
import type { RecentSession } from '../types/recent'

const props = withDefaults(defineProps<{ list: RecentSession[]; limit?: number }>(), {
  limit: 5,
})

defineEmits<{ (e: 'select', item: RecentSession): void }>()

const expanded = ref(false)

// 每分钟更新一次，驱动 duration 重新计算
const tick = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { tick.value++ }, 60000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

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

function duration(lastOpenedAt: number) {
  void tick.value // 依赖 tick 确保每分钟重算
  if (!lastOpenedAt || lastOpenedAt <= 0) return '刚刚'
  const lastOpenedMs = lastOpenedAt < 10_000_000_000 ? lastOpenedAt * 1000 : lastOpenedAt
  const ms = Date.now() - lastOpenedMs
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
}
</script>

<style scoped>
/* 默认折叠只显示前 5 条，隐藏滚动条；点击"另外 xx 会话"展开后才可滚动 */
.recent-list { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 4px; }
.recent-list.expanded { overflow-y: auto; overflow-x: hidden; }
.recent-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: var(--radius-sm);
  cursor: pointer; background: transparent;
  transition: background 0.15s;
}
.recent-item:hover { background: var(--session-item-hover-bg); }
.recent-item:active { background: var(--session-item-hover-bg); transform: scale(0.995); }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0;
}
.recent-agent { flex-shrink: 0; }
.status-dot.running { background: var(--status-success); }
.status-dot.done { background: var(--text-tertiary); }
.status-dot.ended { background: var(--text-tertiary); box-shadow: inset 0 0 0 1.5px var(--text-tertiary); background: transparent; }
.status-dot.awaiting_permission { background: var(--status-error); }
.title {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.meta {
  font-size: var(--fs-caption); color: var(--text-secondary);
  white-space: nowrap; flex-shrink: 0;
}
.toggle-more {
  width: 100%; text-align: left;
  padding: 6px 10px; border-radius: var(--radius-md);
  font-size: 12px; color: var(--accent);
  background: transparent;
}
.toggle-more:hover { background: var(--accent-soft-bg); }
</style>
