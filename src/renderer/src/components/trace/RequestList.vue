<template>
  <aside class="request-list">
    <div
      v-for="r in requests"
      :key="r.id"
      :class="rowClass(r)"
      @click="$emit('select', r.seq)"
    >
      <div class="top">
        <span class="seq">#{{ r.seq }}</span>
        <span>{{ r.model || '—' }}</span>
      </div>
      <div class="sub">
        <span class="time">{{ formatTime(r.ts) }}</span>
        <span v-if="r.latencyMs != null" class="latency">{{ formatMs(r.latencyMs) }}</span>
        <span>{{ r.format }} · {{ statusText(r) }}</span>
        <span v-if="r.toolCount" class="toolcalls" title="tool calls">{{ r.toolCount }} tools</span>
        <span v-if="r.retries" class="retry-badge" title="retries">×{{ r.retries }}</span>
        <span class="cost">${{ r.cost.usd.toFixed(5) }}</span>
      </div>
    </div>
    <div v-if="!requests.length" class="empty">暂无请求</div>
  </aside>
</template>

<script setup lang="ts">
import type { TraceSummary } from '../../stores/trace'

const props = defineProps<{
  requests: TraceSummary[]
  selectedSeq: number | null
  picks: number[]
}>()

defineEmits<{
  (e: 'select', seq: number): void
  (e: 'pick', seq: number): void
}>()

function rowClass(r: TraceSummary) {
  const sc = statusClass(r)
  return ['row', sc ? 'status-' + sc : '', r.seq === props.selectedSeq ? 'sel' : '', props.picks.includes(r.seq) ? 'pick' : '']
}

function statusClass(r: TraceSummary): string {
  if (r.error) return '5xx'
  if (r.status >= 500) return '5xx'
  if (r.status >= 400) return '4xx'
  return ''
}

function statusText(r: TraceSummary): string {
  if (r.error) return 'transport error'
  if (r.status) return 'HTTP ' + r.status
  return 'pending…'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function formatMs(ms: number): string {
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(2) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}
</script>

<style scoped>
.request-list {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  font-size: 12px;
  border-right: 1px solid var(--border);
}
.row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 120ms, box-shadow 120ms;
}
.row:hover { background: var(--bg-hover); }
.row.sel { background: var(--accent-soft-bg); border-left: 3px solid var(--accent); padding-left: 9px; }
.row.pick { box-shadow: inset 3px 0 0 var(--status-warn); }
.row.status-4xx { border-left: 3px solid var(--status-warn); padding-left: 9px; }
.row.status-5xx { border-left: 3px solid var(--status-error); padding-left: 9px; }
.top { display: flex; justify-content: space-between; font-family: var(--font-mono); }
.top .seq { color: var(--accent); }
.sub { display: flex; gap: 8px; color: var(--text-secondary); font-size: 11px; flex-wrap: wrap; }
.sub .time { color: var(--accent); opacity: .8; }
.sub .toolcalls { color: var(--status-warn); }
.sub .retry-badge { color: var(--text-tertiary); }
.sub .cost { margin-left: auto; font-family: var(--font-mono); }
.row.status-4xx .sub { color: var(--status-warn); }
.row.status-5xx .sub { color: var(--status-error); }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
