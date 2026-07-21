<template>
  <aside class="trace-sidebar">
    <!-- StatsBar -->
    <div class="stats-bar">
      <span class="stat-count">{{ filteredRequests.length }} calls</span>
      <span class="stat-cost">${{ totalCost }}</span>
      <button class="stat-reload" title="重新加载" @click="trace.load()">
        <Icon name="refresh-cw" :size="12" />
      </button>
    </div>

    <!-- Loading skeleton -->
    <template v-if="trace.loading && !filteredRequests.length">
      <div v-for="i in 4" :key="i" class="skeleton-row">
        <div class="skeleton-line w-40" />
        <div class="skeleton-line w-70" />
      </div>
    </template>

    <!-- Request list -->
    <template v-else-if="filteredRequests.length">
      <div
        v-for="r in filteredRequests"
        :key="r.seq"
        class="thumb-row"
        :class="{ selected: r.seq === trace.selectedSeq }"
        @click="$emit('select', r.seq)"
      >
        <div class="row-top">
          <span class="status-dot" :class="statusClass(r)" />
          <span class="seq">#{{ r.seq }}</span>
          <span class="model">{{ modelShort(r.model) }}</span>
        </div>
        <div class="row-bottom">
          <span class="meta">{{ formatMs(r.latencyMs) }}</span>
          <span class="meta cost">${{ r.cost.usd.toFixed(5) }}</span>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="state empty">
      <span>暂无 API 请求</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import { useTraceStore } from '../../stores/trace'
import type { TraceSummary } from '../../stores/trace'

defineEmits<{ (e: 'select', seq: number): void }>()

const trace = useTraceStore()

const filteredRequests = computed(() => trace.filteredRequests)

const totalCost = computed(() => {
  let sum = 0
  for (const r of filteredRequests.value) sum += r.cost.usd
  return sum.toFixed(4)
})

function statusClass(r: TraceSummary): string {
  if (r.error) return 'error'
  if (r.status >= 500) return 'error'
  if (r.status >= 400) return 'warn'
  return 'ok'
}

function modelShort(model: string | null): string {
  if (!model) return '\u2014'
  // claude-sonnet-4-20250514 → sonnet
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('opus')) return 'opus'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-').slice(0, 2).join('-')
}

function formatMs(ms: number | null): string {
  if (ms == null) return '\u2014'
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}
</script>

<style scoped>
.trace-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
}
.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  flex-shrink: 0;
}
.stat-count { color: var(--text-secondary); font-weight: 600; }
.stat-cost { color: var(--accent); font-family: var(--font-mono); font-size: 10px; margin-left: auto; }
.stat-reload {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); color: var(--text-tertiary); background: transparent; border: none; cursor: pointer;
}
.stat-reload:hover { background: var(--bg-input); color: var(--text-primary); }

.state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; font-size: 12px; color: var(--text-tertiary); padding: 16px;
}

.thumb-row {
  padding: 6px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 100ms, border-color 100ms;
}
.thumb-row:hover { background: var(--session-item-hover-bg); }
.thumb-row.selected {
  background: var(--accent-soft-bg);
  border-left-color: var(--accent);
}
.row-top { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.row-bottom { display: flex; align-items: center; gap: 8px; margin-top: 1px; padding-left: 14px; }
.meta { font-size: 10px; color: var(--text-tertiary); }
.meta.cost { font-family: var(--font-mono); }

.status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.status-dot.ok { background: var(--status-success); }
.status-dot.warn { background: var(--status-warn); }
.status-dot.error { background: var(--status-error); }

.seq { color: var(--accent); font-family: var(--font-mono); font-weight: 600; }
.model { color: var(--text-secondary); font-size: 11px; }

.skeleton-row { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.skeleton-line { height: 10px; border-radius: 3px; background: var(--border); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-70 { width: 70%; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
</style>
