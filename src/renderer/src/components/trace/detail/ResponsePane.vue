<template>
  <div class="response-pane">
    <div class="block">
      <div class="h">
        <span>usage</span>
        <span v-if="response?.streamed" class="tag">streamed</span>
      </div>
      <pre>{{ JSON.stringify(response?.usage || {}, null, 2) }}</pre>
    </div>
    <div v-for="(b, i) in content" :key="i" class="block">
      <div class="h">
        <span>{{ b.type === 'tool_use' ? `tool_use: ${b.name}` : b.type }}</span>
      </div>
      <pre>{{ blockText(b) }}</pre>
    </div>
    <div v-if="response?.error" class="block err">
      <div class="h">error</div>
      <pre>{{ JSON.stringify(response.error, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ detail: any }>()
const response = computed(() => props.detail?.reassembled)
const content = computed(() => response.value?.content || [])

function blockText(b: any): string {
  if (b.type === 'tool_use') return JSON.stringify(b.input, null, 2)
  if (b.type === 'thinking') return b.thinking ?? JSON.stringify(b)
  return b.text ?? JSON.stringify(b, null, 2)
}
</script>

<style scoped>
.response-pane { padding: 12px; overflow: auto; }
.block { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 4px; }
.block.err { border-color: var(--text-error, #c00); }
.h { padding: 4px 8px; background: var(--bg-card, rgba(0,0,0,0.03)); font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; }
.tag { background: #5e35b1; color: #fff; padding: 0 6px; border-radius: 2px; font-size: 10px; }
pre { padding: 8px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
</style>
