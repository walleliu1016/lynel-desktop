<template>
  <aside class="request-list">
    <div
      v-for="r in requests"
      :key="r.id"
      :class="[
        'row',
        r.error || r.status >= 400 ? 'err' : '',
        r.seq === selectedSeq ? 'sel' : '',
        picks.includes(r.seq) ? 'pick' : '',
      ]"
      @click="$emit('select', r.seq)"
    >
      <div class="top">
        <span class="seq">#{{ r.seq }}</span>
        <span class="model">{{ r.model || '—' }}</span>
      </div>
      <div class="sub">
        <span class="time">{{ formatTime(r.ts) }}</span>
        <span v-if="r.latencyMs != null" class="latency">{{ formatMs(r.latencyMs) }}</span>
        <span :class="['status', r.error ? 'err-txt' : '']">
          {{ r.error ? 'transport error' : (r.status ? 'HTTP ' + r.status : 'pending…') }}
        </span>
        <span class="cost">${{ r.cost.usd.toFixed(5) }}</span>
      </div>
    </div>
    <div v-if="!requests.length" class="empty">暂无请求</div>
  </aside>
</template>

<script setup lang="ts">
import type { TraceSummary } from '../../stores/trace'

defineProps<{
  requests: TraceSummary[]
  selectedSeq: number | null
  picks: number[]
}>()

defineEmits<{
  (e: 'select', seq: number): void
  (e: 'pick', seq: number): void
}>()

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
  border-right: 1px solid var(--border);
  overflow-y: auto;
  font-size: 12px;
}
.row {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.row:hover { background: var(--bg-hover, rgba(0,0,0,0.04)); }
.row.sel { background: var(--bg-selected, rgba(0,120,255,0.12)); }
.row.pick { background: var(--bg-pick, rgba(255,200,0,0.12)); }
.row.err { color: var(--text-error, #c00); }
.top { display: flex; justify-content: space-between; font-weight: 600; }
.top .seq { color: var(--text-tertiary); }
.sub { display: flex; gap: 8px; color: var(--text-secondary); font-size: 11px; }
.sub .status.err-txt { color: var(--text-error, #c00); }
.sub .cost { margin-left: auto; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
