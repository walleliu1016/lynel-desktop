<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Icon from '../Icon.vue'
import FileTree from './FileTree.vue'
import FileTabs from './FileTabs.vue'
import CodeEditor from './CodeEditor.vue'
import { useFilesStore } from '../../stores/files'

const store = useFilesStore()

// ---------- 宽度（localStorage 持久化，240–600px） ----------
const WIDTH_KEY = 'lynel:code-sidebar-width'
const MIN_WIDTH = 240
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 360
const COLLAPSED_WIDTH = 32

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v
  } catch {}
  return DEFAULT_WIDTH
}

const width = ref<number>(loadWidth())

// ---------- 拖宽（右边缘 4px 手柄） ----------
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
/** 刷新已展开目录（含根目录） */
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
  <div
    class="code-sidebar"
    :class="{ dragging }"
    :style="{ width: (store.collapsed ? COLLAPSED_WIDTH : width) + 'px' }"
  >
    <template v-if="!store.collapsed">
      <div class="sidebar-toolbar">
        <button class="tool-btn" title="刷新文件树" aria-label="刷新文件树" @click="onRefresh">
          <Icon name="refresh-cw" :size="14" />
        </button>
        <button class="tool-btn" title="新建文件" aria-label="新建文件" @click="onNewFile">
          <Icon name="plus" :size="14" />
        </button>
        <span class="toolbar-spacer" />
        <button class="tool-btn" title="折叠代码编辑器" aria-label="折叠代码编辑器" @click="onCollapse">
          <Icon name="panel-right-close" :size="14" />
        </button>
      </div>
      <div class="sidebar-tree">
        <FileTree :rel-path="''" :depth="0" />
      </div>
      <div class="sidebar-editor">
        <FileTabs />
        <CodeEditor />
      </div>
      <div
        class="resize-handle"
        title="拖拽调整宽度"
        @mousedown.prevent="onResizeStart"
      />
    </template>

    <!-- 折叠态：仅窄条 + 展开按钮，编辑器区不渲染（节省 Monaco 资源） -->
    <div v-else class="sidebar-collapsed" title="展开代码编辑器" @click="onExpand">
      <Icon name="panel-right-open" :size="16" />
    </div>
  </div>
</template>

<style scoped>
.code-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.15s ease;
}
.code-sidebar.dragging {
  transition: none;
  cursor: col-resize;
}
.sidebar-toolbar {
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
  -webkit-app-region: no-drag;
  transition: color 0.12s, background 0.12s;
}
.tool-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.toolbar-spacer {
  flex: 1;
}
.sidebar-tree {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sidebar-editor {
  flex: 1.6 1.6 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}
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
.resize-handle:hover {
  background: var(--accent);
}
.sidebar-collapsed {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.sidebar-collapsed:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
</style>
