<template>
  <pre v-if="!fold">{{ text }}</pre>
  <details v-else class="fold" :open="false">
    <summary>
      <span class="more show">&gt; show {{ lines }} lines</span>
      <span class="more hide">v hide</span>
    </summary>
    <pre>{{ text }}</pre>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ text: string; maxLen?: number; maxLines?: number }>()

const lines = computed(() => {
  const t = props.text || ''
  return t.split('\n').length
})

const fold = computed(() => {
  const t = props.text || ''
  return t.length > (props.maxLen ?? 800) || lines.value > (props.maxLines ?? 18)
})
</script>

<style scoped>
pre {
  padding: 8px;
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  max-height: 460px;
  overflow: auto;
}
details.fold > summary {
  cursor: pointer;
  padding: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-mono);
  transition: color 120ms;
}
details.fold > summary:hover { color: var(--accent); }
details.fold[open] > summary { border-bottom: 1px solid var(--border); }
details.fold > summary .more { color: var(--accent); }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary .hide { display: none; }
details.fold[open] > summary .show { display: none; }
details.fold[open] > summary .hide { display: inline; }
details.fold > pre { border-top: none; margin-top: 0; }
</style>
