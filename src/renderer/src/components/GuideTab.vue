<template>
  <div class="guide-tab">
    <nav class="sidebar">
      <button
        v-for="ch in chapters"
        :key="ch.key"
        class="chapter"
        :class="{ active: ch.key === activeKey }"
        @click="selectChapter(ch.key)"
      >
        {{ ch.title }}
      </button>
    </nav>
    <main ref="contentEl" class="content">
      <article v-if="activeChapter" class="markdown" v-html="activeChapter.html" />
      <div v-else class="empty">暂无指南内容</div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { marked } from 'marked'

interface Chapter {
  key: string
  title: string
  html: string
}

// 构建期打包全部章节，运行时零 IO
const rawModules = import.meta.glob<string>('../guide/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 文件名格式 NN-章节名.md：数字前缀定序，去前缀为章节名
const chapters: Chapter[] = Object.keys(rawModules)
  .sort()
  .map((path) => {
    const file = path.split('/').pop() ?? path
    const key = file.replace(/\.md$/, '')
    const title = key.replace(/^\d+-/, '')
    let html: string
    try {
      html = marked.parse(rawModules[path]) as string
    } catch {
      // 解析失败时显示转义后的原始文本兜底
      html = `<pre>${escapeHtml(rawModules[path])}</pre>`
    }
    return { key, title, html }
  })

const activeKey = ref(chapters[0]?.key ?? '')
const contentEl = ref<HTMLElement | null>(null)
const activeChapter = computed(() => chapters.find((c) => c.key === activeKey.value) ?? null)

function selectChapter(key: string) {
  activeKey.value = key
  contentEl.value?.scrollTo({ top: 0 })
}
</script>

<style scoped>
.guide-tab {
  flex: 1;
  display: flex;
  min-height: 0;
  background: var(--bg-primary);
}
.sidebar {
  width: 200px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
  flex-shrink: 0;
  overflow-y: auto;
}
.chapter {
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.chapter:hover { color: var(--text-primary); background: var(--accent-soft-bg); }
.chapter.active { color: var(--accent); background: var(--accent-soft-bg); font-weight: 650; }
.content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: 24px 32px;
}
.empty {
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 24px;
}
.markdown { max-width: 760px; color: var(--text-primary); font-size: 14px; line-height: 1.7; }
.markdown :deep(h1) { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
.markdown :deep(h2) { font-size: 17px; font-weight: 700; margin: 24px 0 10px; }
.markdown :deep(h3) { font-size: 15px; font-weight: 650; margin: 18px 0 8px; }
.markdown :deep(p) { margin: 0 0 12px; }
.markdown :deep(ul), .markdown :deep(ol) { margin: 0 0 12px; padding-left: 22px; }
.markdown :deep(li) { margin: 4px 0; }
.markdown :deep(a) { color: var(--accent); }
.markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}
.markdown :deep(pre) {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0 0 12px;
}
.markdown :deep(pre code) { border: none; background: transparent; padding: 0; }
.markdown :deep(blockquote) {
  margin: 0 0 12px;
  padding: 6px 14px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft-bg);
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
}
.markdown :deep(table) { border-collapse: collapse; margin: 0 0 12px; }
.markdown :deep(th), .markdown :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-size: 13px;
}
.markdown :deep(th) { background: var(--bg-panel); }
.markdown :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
</style>
