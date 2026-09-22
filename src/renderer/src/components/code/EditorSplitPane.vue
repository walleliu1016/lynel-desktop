<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import Icon from '../Icon.vue'
import FileEditorPanel from './FileEditorPanel.vue'
import { useFilesStore } from '../../stores/files'
import { useResizablePanel } from '../../composables/useResizablePanel'

/** 终端子页右侧的文件编辑分屏。
 *  与「文件」子页共用 stores/files.ts 的会话级现场：同一组文件 tab、同一个激活文件、
 *  同一份草稿。上一级（HomeView）用 hostInSplit 保证它与 CodeView 里的
 *  FileEditorPanel 互斥 —— 同一时刻全应用只有一个 CodeEditor 实例。 */

const emit = defineEmits<{
  (e: 'collapse'): void
  (e: 'open-in-files'): void
}>()

const store = useFilesStore()
const rootEl = ref<HTMLElement | null>(null)

/** 算动态上限时保守多扣 4px。真正占布局宽度的只有根节点的 `border-left`（1px）——
 *  `.split-handle` 是 position: absolute，不占布局。数值本身无害，且改动会动测试期望，
 *  故保留 4 只订正说明。 */
const HANDLE_WIDTH = 4
/** 左侧终端最小宽度：再窄 Claude 的 TUI 会碎成一行行 */
const TERMINAL_MIN_WIDTH = 400
const MIN_WIDTH = 320

/** 右栏宽度上限：容器宽 - 终端最小宽 - 手柄宽。
 *  容器量不到时返回 Infinity（不设上限），交给挂载后的 clamp 收敛。
 *
 *  「量不到」有两种：① setup 阶段元素尚未挂载 → parentElement 为 null；
 *  ② 容器当下量到 0（窗口被最小化 / 隐藏，或挂载瞬间布局还没完成）。
 *  ②若不设防，上限会算成 max(320, -404) = 320，`onMounted` / ResizeObserver 的 clamp()
 *  会把当前宽度压到 320。
 *  ②在常见交互里基本走不到：切子页 / 离会话都会让 hostInSplit 变假、右栏直接卸载
 *  （`setSession('', '')` 置 splitOpen=false），而宽度只在 mouseup 落盘，一次瞬时钳制
 *  也不会留存。留着是因为「0 宽 = 量不出容器」这个判据本身是对的，不钳制是更安全的一侧。 */
function dynamicMax(): number {
  const container = rootEl.value?.parentElement
  if (!container || container.clientWidth === 0) return Number.POSITIVE_INFINITY
  return Math.max(MIN_WIDTH, container.clientWidth - TERMINAL_MIN_WIDTH - HANDLE_WIDTH)
}

const { width, dragging, onResizeStart, clamp } = useResizablePanel({
  storageKey: 'lynel:editor-split-width',
  defaultWidth: 480,
  min: MIN_WIDTH,
  dynamicMax,
  handle: 'left',
})

/** 头部标签：看 diff 时带上对比说明（工作区 / 暂存区 / 短 hash） */
const headLabel = computed(() => {
  if (store.activeView === 'diff' && store.diffRequest) {
    return `${store.diffRequest.relPath} · ${store.diffRequest.label}`
  }
  return store.activeRelPath ?? '未打开文件'
})

// 容器变窄（拖窗口 / 折叠左侧栏）后把宽度收回来，否则左栏会被挤没
let observer: ResizeObserver | null = null
onMounted(() => {
  clamp()
  const container = rootEl.value?.parentElement
  if (!container || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => clamp())
  observer.observe(container)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div
    ref="rootEl"
    class="editor-split code-workspace-theme"
    :class="{ dragging }"
    :style="{ width: width + 'px' }"
  >
    <div class="split-handle" title="拖拽调整宽度" @mousedown.prevent="onResizeStart" />
    <div class="split-head">
      <span class="name" :title="headLabel">{{ headLabel }}</span>
      <span class="spacer" />
      <button
        class="hbtn"
        title="在「文件」子页打开（可用文件树与 Git 面板）"
        @click="emit('open-in-files')"
      >
        <Icon name="maximize" :size="12" />
        <span>在文件中打开</span>
      </button>
      <button class="hbtn icon" title="收起右栏" aria-label="收起右栏" @click="emit('collapse')">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <FileEditorPanel />
  </div>
</template>

<style scoped>
.editor-split {
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--code-border);
  background: var(--term-bg);
}
.split-handle {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 5;
  background: transparent;
}
.split-handle:hover,
.editor-split.dragging .split-handle { background: var(--accent); }
.editor-split.dragging { cursor: col-resize; }
.split-head {
  height: 32px;
  min-height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;
  border-bottom: 1px solid var(--code-border);
  user-select: none;
}
.split-head .name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--text-primary);
}
.split-head .spacer { flex: 1; }
.hbtn {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}
.hbtn:hover { background: var(--code-hover); }
.hbtn.icon { width: 24px; justify-content: center; padding: 0; border-color: transparent; }
</style>
