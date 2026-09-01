<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Icon from '../Icon.vue'
import FileTree from './FileTree.vue'
import FileTabs from './FileTabs.vue'
import CodeEditor from './CodeEditor.vue'
import { useFilesStore } from '../../stores/files'

const store = useFilesStore()

// ---------- 文件树面板宽度（localStorage 持久化，240–600px） ----------
const WIDTH_KEY = 'lynel:code-tree-width'
const MIN_WIDTH = 240
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 300

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v
  } catch {}
  return DEFAULT_WIDTH
}

const width = ref<number>(loadWidth())

// ---------- 拖宽（树面板右边缘手柄） ----------
const dragging = ref(false)
let startX = 0
let startWidth = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  startX = e.clientX
  startWidth = width.value
  dragging.value = true
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!dragging.value) return
  width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)))
}

function onResizeEnd() {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  try {
    localStorage.setItem(WIDTH_KEY, String(width.value))
  } catch {}
}

onBeforeUnmount(() => {
  if (dragging.value) onResizeEnd()
})

// ---------- 工具条动作 ----------
function onRefresh() {
  const dirs = new Set([''])
  for (const d of store.expanded) dirs.add(d)
  void Promise.all(Array.from(dirs).map((d) => store.loadDir(d).catch(() => {})))
}

function onNewFile() {
  store.rootCreateRequest++
}

function onCollapse() {
  store.collapsed = true
}

function onExpand() {
  store.collapsed = false
}
</script>

<template>
  <div class="code-view" :class="{ dragging }">
    <aside v-if="!store.collapsed" class="tree-panel" :style="{ width: width + 'px' }">
      <div class="panel-toolbar">
        <button class="tool-btn" title="刷新文件树" aria-label="刷新文件树" @click="onRefresh">
          <Icon name="refresh-cw" :size="14" />
        </button>
        <button class="tool-btn" title="新建文件" aria-label="新建文件" @click="onNewFile">
          <Icon name="plus" :size="14" />
        </button>
        <span class="toolbar-spacer" />
        <button class="tool-btn" title="折叠文件树" aria-label="折叠文件树" @click="onCollapse">
          <Icon name="panel-left-close" :size="14" />
        </button>
      </div>
      <FileTree :rel-path="''" :depth="0" />
      <div class="resize-handle" title="拖拽调整宽度" @mousedown.prevent="onResizeStart" />
    </aside>
    <button v-else type="button" class="tree-collapsed" title="展开文件树" aria-label="展开文件树" @click="onExpand">
      <Icon name="panel-left-open" :size="16" />
    </button>
    <section class="editor-panel">
      <FileTabs />
      <CodeEditor />
    </section>
  </div>
</template>

<style scoped>
.code-view {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--bg-panel);
  overflow: hidden;
}
.code-view.dragging { cursor: col-resize; }
.tree-panel {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
}
.panel-toolbar {
  height: 40px;
  min-height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.tool-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.tool-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.toolbar-spacer { flex: 1; }
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 5;
  background: transparent;
}
.resize-handle:hover { background: var(--accent); }
.editor-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tree-collapsed {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  border-right: 1px solid var(--border);
  transition: color 0.12s, background 0.12s;
}
.tree-collapsed:hover { color: var(--text-primary); background: var(--bg-hover); }
</style>
