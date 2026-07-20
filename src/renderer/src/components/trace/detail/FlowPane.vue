<template>
  <div class="flow-pane">
    <p>Flow 视图：把请求 messages 数组 + 响应 content 按时间序配对展示</p>
    <div v-for="(item, i) in flow" :key="i" :class="['row', item.kind]">
      <span class="seq">#{{ i + 1 }}</span>
      <span class="role">{{ item.role }}</span>
      <span class="type">{{ item.type }}</span>
      <span class="text">{{ item.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ detail: any }>()

const flow = computed(() => {
  const out: any[] = []
  const body = props.detail?.request?.body || {}
  for (const m of body.messages || []) {
    const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
    for (const b of content) {
      out.push({ role: m.role, type: b.type, text: previewBlock(b), kind: m.role })
    }
  }
  const resp = props.detail?.reassembled?.content || []
  for (const b of resp) {
    out.push({ role: 'assistant', type: b.type, text: previewBlock(b), kind: 'assistant' })
  }
  return out
})

function previewBlock(b: any): string {
  if (b.type === 'tool_use') return b.name + '(' + JSON.stringify(b.input || {}).slice(0, 80) + ')'
  if (b.type === 'tool_result') return String(b.content || '').slice(0, 200)
  return (b.text || b.thinking || JSON.stringify(b)).slice(0, 200)
}
</script>

<style scoped>
.flow-pane { padding: 12px; overflow: auto; }
.row { display: flex; gap: 8px; padding: 4px 0; font-size: 12px; border-bottom: 1px solid var(--border); }
.row.user { color: var(--text-secondary); }
.row.assistant { color: var(--text-primary); }
.seq { color: var(--text-tertiary); width: 30px; }
.role { width: 70px; }
.type { width: 80px; color: var(--text-tertiary); }
.text { flex: 1; word-break: break-all; }
</style>
