<template>
  <div v-if="!fold" class="markdown-body" v-html="html" />
  <details v-else class="fold" :open="false">
    <summary>
      <span class="more show">&gt; show {{ lines }} lines</span>
      <span class="more hide">v hide</span>
    </summary>
    <div class="markdown-body" v-html="html" />
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  gfm: true,
  breaks: false,
})

const props = defineProps<{ text: string; maxLen?: number; maxLines?: number }>()

const lines = computed(() => {
  const t = props.text || ''
  return t.split('\n').length
})

const fold = computed(() => {
  const t = props.text || ''
  return t.length > (props.maxLen ?? 800) || lines.value > (props.maxLines ?? 18)
})

const html = computed(() => {
  const t = props.text || ''
  if (!t) return ''
  const rawHtml = marked.parse(t, { async: false }) as string
  return DOMPurify.sanitize(rawHtml)
})
</script>

<style scoped>
.markdown-body {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary);
  word-break: break-word;
  max-height: 460px;
  overflow: auto;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 10px 0 6px;
  color: var(--text-primary);
  font-weight: 600;
}
.markdown-body :deep(h1) { font-size: 16px; }
.markdown-body :deep(h2) { font-size: 15px; }
.markdown-body :deep(h3) { font-size: 14px; }
.markdown-body :deep(h4) { font-size: 13px; }
.markdown-body :deep(p) { margin: 6px 0; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.markdown-body :deep(li) { margin: 2px 0; }
.markdown-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--code-bg);
  color: var(--code-text);
}
.markdown-body :deep(pre) {
  margin: 6px 0;
  padding: 8px;
  border-radius: 4px;
  background: var(--code-bg);
  overflow-x: auto;
}
.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: var(--code-text);
  font-size: 12px;
}
.markdown-body :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--border);
  color: var(--text-secondary);
}
.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.markdown-body :deep(a:hover) { text-decoration: underline; }
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 6px 0;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
}
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 8px 0;
}
.markdown-body :deep(strong) { font-weight: 600; }

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
</style>
