<template>
  <div class="bubble" :class="role">
    <div class="role-row">
      <span class="role-label">{{ roleLabel }}</span>
      <span class="time">{{ timeStr }}</span>
    </div>
    <div class="content">
      <pre v-if="role === 'tool'" class="code"><code>{{ content }}</code></pre>
      <div v-else class="text markdown-body" v-html="html" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps<{ role: 'user' | 'assistant' | 'tool'; content: string; ts?: number }>()

const roleLabel = computed(() => ({
  user: '你',
  assistant: 'Claude',
  tool: '工具',
}[props.role]))

const timeStr = computed(() => {
  if (!props.ts) return ''
  return new Date(props.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})

const html = computed(() => {
  try {
    return marked.parse(props.content) as string
  } catch {
    return props.content
  }
})
</script>

<style scoped>
.bubble { padding: 6px 0; }
.role-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.role-label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; }
.time { font-size: 10px; color: var(--text-tertiary); }
.content { font-size: 14px; line-height: 1.65; }

/* Markdown 渲染内容 */
.markdown-body :deep(p) { margin: 4px 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 20px; margin: 4px 0; }
.markdown-body :deep(li) { margin: 2px 0; }
.markdown-body :deep(blockquote) {
  border-left: 2px solid var(--accent); padding-left: 10px; margin: 8px 0;
  color: var(--text-secondary);
}
.markdown-body :deep(a) { color: var(--accent-light); text-decoration: none; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3),
.markdown-body :deep(h4), .markdown-body :deep(h5), .markdown-body :deep(h6) {
  margin: 10px 0 4px; font-weight: 600;
}
.markdown-body :deep(h1) { font-size: 18px; }
.markdown-body :deep(h2) { font-size: 16px; }
.markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(table) {
  border-collapse: collapse; margin: 6px 0; width: 100%;
}
.markdown-body :deep(th), .markdown-body :deep(td) {
  border: 1px solid var(--border); padding: 4px 8px; font-size: 12px; text-align: left;
}
.markdown-body :deep(th) { background: var(--bg-input); }
.markdown-body :deep(pre) {
  background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius-md);
  padding: 10px 12px; margin: 8px 0; overflow-x: auto; font-size: 13px; line-height: 1.5;
}
.markdown-body :deep(code) {
  background: var(--bg-input); padding: 1px 5px; border-radius: 3px;
  font-size: 13px; font-family: var(--font-mono); color: var(--accent-light);
}
.markdown-body :deep(pre code) {
  background: transparent; padding: 0; color: var(--text-primary);
}
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
.markdown-body :deep(strong) { font-weight: 600; }
.markdown-body :deep(img) { max-width: 100%; border-radius: var(--radius-md); }

.text { color: var(--text-primary); word-wrap: break-word; }
.code {
  background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 10px;
  font-size: var(--font-size-code); color: var(--text-primary);
  overflow-x: auto;
}
</style>
