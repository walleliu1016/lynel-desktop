<template>
  <div class="trace-header">
    <div v-if="stats" class="stats-badge">
      <div class="stat-item"><span class="stat-val">{{ formatNum(stats.totals.input) }}</span><span class="stat-label">in</span></div>
      <div class="stat-item"><span class="stat-val">{{ formatNum(stats.totals.output) }}</span><span class="stat-label">out</span></div>
      <div class="stat-item"><span class="stat-val">{{ cachePercent }}%</span><span class="stat-label">cache</span></div>
      <div class="stat-item cost"><span class="stat-val">${{ stats.totals.usd.toFixed(4) }}</span></div>
    </div>
    <span class="spacer" />
    <select
      v-if="models.length"
      :value="modelFilter"
      @change="(e) => emit('update:modelFilter', (e.target as HTMLSelectElement).value)"
    >
      <option value="all">All models</option>
      <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
    </select>
    <button
      :class="['errors-btn', { on: errorsOnly }]"
      @click="emit('update:errorsOnly', !errorsOnly)"
    >errors ({{ errorCount }})</button>
    <button
      :class="['diff-btn', { on: diffMode }]"
      @click="emit('toggleDiff')"
    >Diff: {{ diffMode ? 'pick 2' : 'off' }}</button>
    <button class="reload-btn" @click="emit('reload')">&orarr;</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStats } from '../../stores/trace'

const props = defineProps<{
  stats: SessionStats | null
  models: string[]
  modelFilter: string
  errorsOnly: boolean
  diffMode: boolean
  errorCount: number
}>()

const emit = defineEmits<{
  (e: 'update:modelFilter', v: string): void
  (e: 'update:errorsOnly', v: boolean): void
  (e: 'reload'): void
  (e: 'toggleDiff'): void
}>()

const cachePercent = computed(() => {
  if (!props.stats) return 0
  return Math.round((props.stats.totals.cacheHitRate || 0) * 100)
})

function formatNum(n: number): string {
  if (n == null) return '—'
  return n.toLocaleString()
}
</script>

<style scoped>
.trace-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.spacer { flex: 1; }
.stats-badge { display: flex; gap: 6px; align-items: center; }
.stat-item { display: flex; align-items: baseline; gap: 3px; background: var(--bg-input); padding: 2px 8px; border-radius: var(--radius-sm); }
.stat-item.cost { background: transparent; padding: 2px 4px; }
.stat-val { color: var(--accent); font-family: var(--font-mono); font-weight: 600; font-size: 12px; }
.stat-label { color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
.errors-btn.on { color: var(--status-error); }
.diff-btn.on { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
button { background: var(--bg-button, transparent); color: var(--text-primary); border: 1px solid var(--border); padding: 2px 8px; border-radius: 3px; cursor: pointer; }
button:hover { border-color: var(--accent); }
select { background: var(--bg-button, transparent); color: var(--text-primary); border: 1px solid var(--border); padding: 2px 6px; border-radius: 3px; }
</style>
