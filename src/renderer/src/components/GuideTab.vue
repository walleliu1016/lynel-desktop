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
    <main ref="contentEl" class="content" @scroll="onScroll">
      <article v-if="activeChapter" class="markdown" v-html="activeChapter.html" />
      <div v-else class="empty">暂无指南内容</div>
    </main>
    <aside v-if="activeToc.length > 0" class="toc">
      <div class="toc-title">目录</div>
      <nav>
        <a
          v-for="item in activeToc"
          :key="item.id"
          class="toc-item"
          :class="{ active: item.id === activeHeadingId }"
          :style="{ paddingLeft: (item.level - 1) * 12 + 8 + 'px' }"
          :href="'#' + item.id"
          @click.prevent="scrollToHeading(item.id)"
        >
          {{ item.text }}
        </a>
      </nav>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { marked } from 'marked'

interface TocItem {
  id: string
  text: string
  level: number
}

interface Chapter {
  key: string
  title: string
  html: string
  toc: TocItem[]
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function extractToc(markdown: string): TocItem[] {
  const toc: TocItem[] = []
  const headingRe = /^(#{1,3})\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = headingRe.exec(markdown)) !== null) {
    const level = match[1].length
    const text = match[2].replace(/[`*_~\[\]]/g, '').trim()
    toc.push({ id: slugify(text), text, level })
  }
  return toc
}

function renderMarkdown(markdown: string): { html: string; toc: TocItem[] } {
  const toc = extractToc(markdown)

  const renderer = new marked.Renderer()
  renderer.heading = function ({ text, depth }: { text: string; depth: number }): string {
    const cleanText = text.replace(/<[^>]*>/g, '')
    const id = slugify(cleanText)
    const tag = `h${depth}`
    return `<${tag} id="${id}">${text}</${tag}>`
  }

  let html: string
  try {
    html = marked.parse(markdown, { renderer }) as string
  } catch {
    html = `<pre>${escapeHtml(markdown)}</pre>`
  }
  return { html, toc }
}

// 文件名格式 NN-章节名.md：数字前缀定序，去前缀为章节名
const chapters: Chapter[] = Object.keys(rawModules)
  .sort()
  .map((path) => {
    const file = path.split('/').pop() ?? path
    const key = file.replace(/\.md$/, '')
    const title = key.replace(/^\d+-/, '')
    const { html, toc } = renderMarkdown(rawModules[path])
    return { key, title, html, toc }
  })

const activeKey = ref(chapters[0]?.key ?? '')
const contentEl = ref<HTMLElement | null>(null)
const activeHeadingId = ref<string>('')

const activeChapter = computed(() => chapters.find((c) => c.key === activeKey.value) ?? null)
const activeToc = computed(() => activeChapter.value?.toc ?? [])

function selectChapter(key: string) {
  activeKey.value = key
  activeHeadingId.value = ''
  contentEl.value?.scrollTo({ top: 0 })
}

function scrollToHeading(id: string) {
  const el = contentEl.value?.querySelector(`#${CSS.escape(id)}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activeHeadingId.value = id
  }
}

function onScroll() {
  if (!contentEl.value) return
  const headings = contentEl.value.querySelectorAll('h1[id], h2[id], h3[id]')
  let current = ''
  const scrollTop = contentEl.value.scrollTop + 60
  headings.forEach((h) => {
    if ((h as HTMLElement).offsetTop <= scrollTop) {
      current = h.id
    }
  })
  activeHeadingId.value = current
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
.toc {
  width: 200px;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: 16px 12px;
  flex-shrink: 0;
  overflow-y: auto;
}
.toc-title {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.toc-item {
  display: block;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: 4px;
  border-left: 2px solid transparent;
  transition: all 0.12s;
}
.toc-item:hover { color: var(--text-primary); background: var(--accent-soft-bg); }
.toc-item.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: var(--accent-soft-bg);
}
.markdown { color: var(--text-primary); font-size: 14px; line-height: 1.7; }
.markdown :deep(h1) { font-size: 22px; font-weight: 700; margin: 0 0 16px; scroll-margin-top: 24px; }
.markdown :deep(h2) { font-size: 17px; font-weight: 700; margin: 24px 0 10px; scroll-margin-top: 24px; }
.markdown :deep(h3) { font-size: 15px; font-weight: 650; margin: 18px 0 8px; scroll-margin-top: 24px; }
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
.markdown :deep(img) {
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 4px 0 12px;
  display: block;
}
</style>
