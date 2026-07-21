<template>
  <aside class="trace-sidebar" :class="{ collapsed: collapsed }">
    <!-- StatsBar -->
    <div class="stats-bar">
      <button
        class="toggle-btn"
        :title="collapsed ? '展开 Trace' : '收起 Trace'"
        @click="$emit('toggle-collapse')"
      >
        <Icon :name="collapsed ? 'panel-right-open' : 'panel-right-close'" :size="16" />
      </button>
      <template v-if="!collapsed">
        <span class="stat-count">{{ filteredRequests.length }} calls</span>
        <span class="stat-cost">${{ totalCost }}</span>
        <button class="stat-reload" title="重新加载" @click="trace.load()">
          <Icon name="refresh-cw" :size="12" />
        </button>
      </template>
    </div>

    <template v-if="!collapsed">
      <!-- Loading skeleton -->
      <template v-if="trace.loading && !filteredRequests.length">
        <div v-for="i in 4" :key="i" class="skeleton-row">
          <div class="skeleton-line w-40" />
          <div class="skeleton-line w-70" />
        </div>
      </template>

      <!-- Error state -->
      <div v-else-if="trace.loadError" class="state error">
        <span>{{ trace.loadError }}</span>
        <button class="retry-btn" @click="trace.load()">重试</button>
      </div>

      <!-- Request list -->
      <div class="thumb-list" v-else-if="filteredRequests.length" ref="thumbListEl">
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
            <span class="meta cost">${{ r.cost.usd.toFixed(4) }}</span>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="state empty">
        <span>暂无 API 请求</span>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Icon from '../Icon.vue'
import { useTraceStore } from '../../stores/trace'
import type { TraceSummary } from '../../stores/trace'

defineProps<{ collapsed: boolean }>()
defineEmits<{ (e: 'select', seq: number): void; (e: 'toggle-collapse'): void }>()

const trace = useTraceStore()
const thumbListEl = ref<HTMLElement | null>(null)

// 新请求到达时自动滚动到底部（仅当用户已在底部附近时）
watch(() => trace.filteredRequests.length, () => {
  void nextTick(() => {
    const el = thumbListEl.value
    if (!el) return
    const threshold = 50
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      el.scrollTop = el.scrollHeight
    }
  })
})

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
  transition: width 0.2s ease;
}
.trace-sidebar.collapsed {
  width: 32px;
}
.trace-sidebar.collapsed .stats-bar {
  flex-direction: column;
  padding: 6px 4px;
}
.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  flex-shrink: 0;
}
.toggle-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.toggle-btn:hover {
  background: var(--bg-input);
  border-color: var(--accent);
  color: var(--accent);
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

.state.error { color: var(--status-error); font-size: 11px; }
.retry-btn { color: var(--accent); background: transparent; border: none; cursor: pointer; font-size: 12px; margin-top: 4px; }
.thumb-list { flex: 1; overflow-y: auto; min-height: 0; }
</style>
