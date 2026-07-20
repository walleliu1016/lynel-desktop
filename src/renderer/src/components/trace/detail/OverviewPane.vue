<template>
  <div class="overview-pane">
    <div class="cards">
      <Card label="total" :value="formatMs(detail.timing?.totalMs)" />
      <Card label="TTFT" :value="formatMs(detail.timing?.ttftMs)" sub="first byte" />
      <Card label="generation" :value="formatMs(detail.timing?.genMs)" sub="stream window" />
      <Card label="in speed" :value="formatTps(detail.timing?.inTps)" sub="pre-1st-byte" />
      <Card label="out speed" :value="formatTps(detail.timing?.outTps)" sub="after 1st-byte" />
    </div>
    <h3>Request</h3>
    <div class="cards">
      <Card label="status" :value="statusText" :error="isError" />
      <Card label="model" :value="detail.model || '—'" />
      <Card label="format" :value="detail.format" />
      <Card label="input" :value="formatNum(detail.reassembled?.usage?.input_tokens)" sub="tokens" />
      <Card label="output" :value="formatNum(detail.reassembled?.usage?.output_tokens)" sub="tokens" />
      <Card label="cache read" :value="formatNum(detail.cost?.cacheRead)" :sub="cachePercent + '% hit'" />
      <Card label="cost" :value="'$' + (detail.cost?.usd ?? 0).toFixed(5)" />
      <Card label="stop" :value="detail.reassembled?.stop_reason || '—'" />
    </div>
    <div v-if="detail.reassembled?.error" class="error-block">
      <h3>Error</h3>
      <pre>{{ JSON.stringify(detail.reassembled.error, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Card from './Card.vue'

const props = defineProps<{ detail: any }>()

const statusText = computed(() => {
  const s = props.detail.response?.status
  return s != null ? 'HTTP ' + s : '—'
})

const isError = computed(() => (props.detail.response?.status ?? 0) >= 400)

const cachePercent = computed(() => Math.round((props.detail.cost?.cacheHitRate || 0) * 100))

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(2) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}

function formatTps(tps: number | null | undefined): string {
  if (tps == null || !isFinite(tps)) return '—'
  if (tps >= 100) return Math.round(tps) + ' tok/s'
  if (tps >= 10) return tps.toFixed(1) + ' tok/s'
  return tps.toFixed(2) + ' tok/s'
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}
</script>

<style scoped>
.overview-pane { padding: 16px; overflow: auto; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 16px; }
h3 { margin: 16px 0 8px; font-size: 13px; color: var(--text-secondary); }
.error-block { margin-top: 16px; padding: 12px; border: 1px solid var(--text-error, #c00); border-radius: 4px; }
.error-block pre { color: var(--text-error, #c00); font-size: 11px; }
</style>
