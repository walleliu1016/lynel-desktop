<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import FileTree from './FileTree.vue'
import FileTabs from './FileTabs.vue'
import CodeEditor from './CodeEditor.vue'
import CodeDiffView from './CodeDiffView.vue'
import BottomPanel from './BottomPanel.vue'
import { useFilesStore } from '../../stores/files'
import { useGitStore } from '../../stores/git'

/** 「文件」子页当前是否可见。由 HomeView 传入 —— CodeView 被 v-show 常挂载，
 *  自身感知不到子页切换，而底部面板的终端要据此决定是否启动。 */
const props = withDefaults(defineProps<{ visible?: boolean }>(), { visible: true })

const store = useFilesStore()
const gitStore = useGitStore()

// 会话切换 → git 面板跟着换目录并重挂 .git watcher
watch(
  () => store.workDir,
  (wd) => { void gitStore.setSession(wd) },
  { immediate: true },
)

/** 项目目录 basename（title 展示完整路径） */
const dirName = computed(() => {
  const wd = store.workDir
  if (!wd) return ''
  return wd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? wd
})

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
    <div class="main-row">
      <aside v-if="!store.collapsed" class="tree-panel" :style="{ width: width + 'px' }">
        <div class="panel-toolbar">
          <button class="tool-btn" title="刷新文件树" aria-label="刷新文件树" @click="onRefresh">
            <Icon name="refresh-cw" :size="14" />
          </button>
          <button class="tool-btn" title="新建文件" aria-label="新建文件" @click="onNewFile">
            <Icon name="plus" :size="14" />
          </button>
          <span class="toolbar-dir" :title="store.workDir">{{ dirName }}</span>
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
        <!-- 用 v-show 而非 v-if：保留两个组件实例，避免 Monaco 反复重建 -->
        <div v-show="!store.diffRequest" class="editor-slot">
          <FileTabs />
          <CodeEditor />
        </div>
        <div v-show="!!store.diffRequest" class="editor-slot">
          <CodeDiffView />
        </div>
      </section>
    </div>
    <BottomPanel
      :session-id="store.currentSessionId"
      :work-dir="store.workDir"
      :visible="props.visible"
    />
  </div>
</template>

<style scoped>
.code-view {
  /* 代码工作区配色跟随终端主题：把 UI 变量重映射为 --term-*（html 上全局可用） */
  --bg-panel: var(--term-bg);
  --text-primary: var(--term-fg);
  --text-secondary: var(--term-fg);
  --text-tertiary: var(--term-fg);
  --bg-hover: var(--code-hover);
  --tab-hover-bg: var(--code-hover);
  --accent-soft-bg: var(--term-selection);
  --accent: var(--term-fg);
  --border: var(--code-border);
  --border-strong: var(--code-border);
  --bg-input: var(--term-bg);
  --border-focus: var(--code-border);
  --status-warn: var(--term-yellow);
  --status-warn-soft: var(--code-hover);
  --status-warn-border: var(--code-border);
  --status-error: var(--term-red);
  --status-error-soft: var(--code-hover);
  /* GitPanel 用到的两个变量需在此补齐：
     - theme.css 未定义 --status-ok（只有 --status-success），不补则「ahead / 已暂存」的
       绿色会失效退化为继承色；
     - --accent 在上方已被重映射为 --term-fg，而全局 --text-inverse 是白色，
       提交按钮会变成白字浅底；把 inverse 重映射为终端背景色才是「反色」的本意。 */
  --status-ok: var(--term-green);
  --text-inverse: var(--term-bg);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  overflow: hidden;
}
.code-view.dragging { cursor: col-resize; }
.main-row {
  flex: 1;
  min-height: 0;
  display: flex;
}
.tree-panel {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
}
.panel-toolbar {
  height: 32px;
  min-height: 32px;
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
.toolbar-dir {
  margin-left: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  color: var(--term-bright-black);
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
.resize-handle:hover { background: var(--accent); }
.editor-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-slot {
  flex: 1;
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
