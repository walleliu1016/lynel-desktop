<template>
  <div class="trace-header">
    <div v-if="stats" class="stats-badge">
      <span><b>{{ formatNum(stats.totals.input) }}</b> in</span>
      <span><b>{{ formatNum(stats.totals.output) }}</b> out</span>
      <span><b>{{ cachePercent }}%</b> cache</span>
      <span><b>${{ stats.totals.usd.toFixed(4) }}</b></span>
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
    >
      errors
    </button>
    <button @click="emit('reload')">⟳</button>
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
}>()

const emit = defineEmits<{
  (e: 'update:modelFilter', v: string): void
  (e: 'update:errorsOnly', v: boolean): void
  (e: 'reload'): void
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
.stats-badge { display: flex; gap: 12px; color: var(--text-secondary); }
.stats-badge b { color: var(--text-primary); }
.errors-btn.on { color: var(--text-error, #c00); }
button { background: var(--bg-button); border: 1px solid var(--border); padding: 2px 8px; border-radius: 3px; cursor: pointer; }
select { background: var(--bg-button); border: 1px solid var(--border); padding: 2px 6px; }
</style>
