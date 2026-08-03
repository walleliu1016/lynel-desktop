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
        <button class="stat-reload" title="重新加载" @click="reload()">
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
        <button class="retry-btn" @click="reload()">重试</button>
      </div>

      <!-- Request list -->
      <div
        class="thumb-list"
        v-else-if="filteredRequests.length"
        ref="thumbListEl"
        @scroll="onScroll"
      >
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
            <span class="meta time">{{ formatTime(r.ts) }}</span>
          </div>
          <div class="row-bottom">
            <span class="metric" v-if="r.cost.input">
              <Icon name="arrow-down" :size="10" />
              {{ fmtTokens(r.cost.input) }}
            </span>
            <span class="metric" v-if="r.cost.output">
              <Icon name="arrow-up" :size="10" />
              {{ fmtTokens(r.cost.output) }}
            </span>
            <span class="metric" v-if="r.toolCount">
              <Icon name="wrench" :size="10" />
              &times;{{ r.toolCount }}
            </span>
            <span class="metric">
              <Icon name="clock" :size="10" />
              {{ formatMs(r.latencyMs) }}
            </span>
            <span class="meta cost">${{ r.cost.usd.toFixed(3) }}</span>
          </div>
        </div>
        <!-- 加载更多指示 -->
        <div v-if="trace.hasMore" class="load-more-hint">
          <span v-if="trace.loading">加载中...</span>
          <span v-else>向上滚动加载更多</span>
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

// 过滤条件变化时重新加载首页
watch(() => [trace.modelFilter, trace.errorsOnly], () => {
  trace.load()
})

// 新请求到达时自动滚动到底部（仅当用户在底部附近时）
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

function reload() {
  trace.requests = []
  trace.load()
}

// 滚动检测：接近顶部时加载更多
function onScroll() {
  const el = thumbListEl.value
  if (!el) return
  if (el.scrollTop < 50 && trace.hasMore && !trace.loading) {
    const prevHeight = el.scrollHeight
    trace.loadMore().then(() => {
      void nextTick(() => {
        if (thumbListEl.value) {
          thumbListEl.value.scrollTop = thumbListEl.value.scrollHeight - prevHeight
        }
      })
    })
  }
}

const filteredRequests = computed(() => trace.filteredRequests)

const totalCost = computed(() => {
  let sum = 0
  for (const r of filteredRequests.value) sum += r.cost.usd
  return sum.toFixed(3)
})

function statusClass(r: TraceSummary): string {
  if (r.error) return 'error'
  if (r.status >= 500) return 'error'
  if (r.status >= 400) return 'warn'
  return 'ok'
}

function modelShort(model: string | null): string {
  if (!model) return '\u2014'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('opus')) return 'opus'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-').slice(0, 2).join('-')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatMs(ms: number | null): string {
  if (ms == null) return '\u2014'
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
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
.row-bottom { display: flex; align-items: center; gap: 6px; margin-top: 1px; padding-left: 14px; }
.meta { font-size: 10px; color: var(--text-tertiary); }
.meta.cost { font-family: var(--font-mono); margin-left: auto; }
.metric {
  font-size: 10px;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono);
}

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

.load-more-hint {
  padding: 10px;
  text-align: center;
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
