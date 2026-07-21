<template>
  <div class="messages-pane">
    <div
      v-for="(m, i) in messages"
      :key="i"
      :class="['block', m.paired ? 'paired' : '']"
      :style="m.paired && m.callId ? { borderLeftColor: hueColor(m.callId) } : undefined"
    >
      <div class="h">
        <span>{{ m.label }}</span>
        <span class="tags">
          <span v-if="m.cache" class="tag cache">cache 1h</span>
          <span v-if="m.isError" class="tag err">error</span>
          <span
            :class="['tag', m.type === 'tool_use' ? 'tool' : m.type === 'tool_result' ? 'result' : '']"
          >{{ m.type === 'tool_use' ? m.name : m.type }}</span>
          <span
            v-if="m.paired && m.callId"
            class="tag id"
            :style="{ background: hueBg(m.callId), color: hueFg(m.callId) }"
          >{{ String(m.callId).slice(-8) }}</span>
        </span>
      </div>
      <FoldingPre :text="m.text" />
    </div>
    <div v-if="!messages.length" class="empty">暂无消息块</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FoldingPre from '../FoldingPre.vue'
import { hueBg, hueColor, hueFg } from '../../../composables/useIdHue'

const props = defineProps<{ detail: any }>()

const messages = computed(() => {
  const body = props.detail?.request?.body || {}
  const list: any[] = []
  if (Array.isArray(body.messages)) {
    body.messages.forEach((m: any, mi: number) => {
      const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
      content.forEach((b: any, bi: number) => {
        let text = ''
        const isToolUse = b.type === 'tool_use'
        const isToolResult = b.type === 'tool_result'
        if (isToolUse) {
          text = JSON.stringify(b.input ?? {}, null, 2)
        } else if (isToolResult) {
          text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2)
        } else {
          text = b.text ?? JSON.stringify(b, null, 2)
        }
        list.push({
          label: `msg[${mi}].${m.role}[${bi}]`,
          type: b.type || 'text',
          text,
          name: b.name || '',
          callId: b.id || b.tool_use_id || null,
          isError: isToolResult ? !!b.is_error : false,
          paired: isToolUse || isToolResult,
          cache: !!b.cache_control,
        })
      })
    })
  }
  return list
})
</script>

<style scoped>
.messages-pane { padding: 12px; overflow: auto; }
.block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: 0 4px 4px 0;
}
.block.paired { border-left-width: 3px; }
.h {
  padding: 6px 12px;
  background: var(--bg-input);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
.tags { display: flex; gap: 4px; align-items: center; }
.tag {
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-family: var(--font-mono);
}
.tag.tool { background: var(--accent); color: var(--text-inverse); }
.tag.result { background: var(--status-success); color: var(--bg-primary); }
.tag.err { background: var(--status-error); color: var(--text-inverse); }
.tag.cache { background: var(--status-warn); color: var(--bg-primary); }
.tag.id { letter-spacing: .3px; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
