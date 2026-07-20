<template>
  <div class="messages-pane">
    <div v-for="(m, i) in messages" :key="i" class="block">
      <div class="h">
        <span>{{ m.label }}</span>
        <span :class="['tag', m.type === 'tool_use' ? 'tool' : m.type === 'tool_result' ? 'result' : '']">
          {{ m.type }}
        </span>
      </div>
      <pre>{{ m.text }}</pre>
    </div>
    <div v-if="!messages.length" class="empty">无 messages</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ detail: any }>()

const messages = computed(() => {
  const body = props.detail?.request?.body || {}
  const list: any[] = []
  if (Array.isArray(body.messages)) {
    body.messages.forEach((m: any, mi: number) => {
      const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
      content.forEach((b: any, bi: number) => {
        let text = ''
        if (b.type === 'tool_use') {
          text = JSON.stringify(b.input ?? {}, null, 2)
        } else if (b.type === 'tool_result') {
          text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2)
        } else {
          text = b.text ?? JSON.stringify(b, null, 2)
        }
        list.push({ label: `msg[${mi}].${m.role}[${bi}]`, type: b.type || 'text', text })
      })
    })
  }
  return list
})
</script>

<style scoped>
.messages-pane { padding: 12px; overflow: auto; }
.block { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 4px; }
.h { padding: 4px 8px; background: var(--bg-card, rgba(0,0,0,0.03)); display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); }
.tag { padding: 0 6px; border-radius: 2px; font-size: 10px; }
.tag.tool { background: #5e35b1; color: #fff; }
.tag.result { background: #43a047; color: #fff; }
pre { padding: 8px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
