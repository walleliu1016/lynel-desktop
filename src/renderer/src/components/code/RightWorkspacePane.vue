<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import FileTabs from './FileTabs.vue'
import CodeView from './CodeView.vue'
import { useResizablePanel } from '../../composables/useResizablePanel'
import { useFilesStore } from '../../stores/files'

/** 会话右侧文件工作区折叠栏：顶部行（「文件」标识 tab + 文件 tabs + 全屏/收起）
 *  + 文件树/编辑器（CodeView）+ 底部 Git/终端面板。
 *  收起时完全隐藏顶部行与主体，右缘只留一个展开按钮（panel-right-open，
 *  与收起的 panel-right-close 对应）当唯一入口 —— 早期版本收起态保留顶部行
 *  当展开热区，用户「点收起没反应再点一次」的第二击落在顶部行被翻回展开，
 *  净视觉效果 = 毫无反应，故整体改为图标入口。
 *  主体用 v-show 不卸载，底部面板的项目终端 xterm / shell PTY 缓冲随挂载存活，
 *  收起再展开不能丢；收起态不写内联 width（宽度自适应展开按钮）。
 *  全应用唯一挂载 FileEditorPanel 的链路是 CodeView → FileEditorPanel，
 *  本组件不得再渲染第二个编辑器宿主（Monaco 同 URI 单 model）。 */

const props = defineProps<{
  /** 右栏是否展开（HomeView 用 files.splitOpen 驱动） */
  visible: boolean
  /** 是否全屏铺满（左半由 HomeView 隐藏） */
  maximized?: boolean
}>()
const emit = defineEmits<{
  (e: 'collapse'): void
  (e: 'toggle-fullscreen'): void
  /** 点右缘展开按钮时请求展开 */
  (e: 'expand'): void
}>()

/** 收起防抖窗口：收起瞬间原收起按钮的位置立刻被展开按钮占据 ——
 *  用户「点收起没反应，再点一次」的第二击会落在展开按钮上，<500ms 内把刚收起的
 *  又展开，净视觉效果 = 毫无反应。visible true→false 后 500ms 内吞掉 expand 请求。 */
const EXPAND_DEBOUNCE_MS = 500
let collapsedAt = 0

function requestExpand(): void {
  if (Date.now() - collapsedAt < EXPAND_DEBOUNCE_MS) return
  emit('expand')
}

const filesStore = useFilesStore()

/** 「文件」标识 tab：仅展开态可见（收起态整条顶部行已隐藏），点击翻转文件树折叠
 *  （store.collapsed），这是树重新展开的唯一入口（工具条折叠按钮只负责收起）。 */
function onLabelClick(): void {
  filesStore.collapsed = !filesStore.collapsed
}

/** 「文件」tab 的 hover 提示，与 onLabelClick 动作对应 */
const labelTitle = computed(() => (filesStore.collapsed ? '展开文件树' : '折叠文件树'))

const rootEl = ref<HTMLElement | null>(null)

/** 左区（终端/Trace）最小宽度：再窄 Claude 的 TUI 会碎成一行行 */
const LEFT_MIN_WIDTH = 400
/** 动态上限保守多扣 4px（沿用 EditorSplitPane 先例：border-left 1px + 余量） */
const HANDLE_WIDTH = 4
const MIN_WIDTH = 320

/** 容器量不到（隐藏中 / 未挂载）返回 Infinity = 不设上限，交给展开后的 clamp 收敛 */
function dynamicMax(): number {
  const container = rootEl.value?.parentElement
  if (!container || container.clientWidth === 0) return Number.POSITIVE_INFINITY
  return Math.max(MIN_WIDTH, container.clientWidth - LEFT_MIN_WIDTH - HANDLE_WIDTH)
}

/** defaultWidth: 0 是「无存量宽度」哨兵 —— 首次展开时按容器 50% 初始化（见 initWidth）。
 *  存量值存在时 loadWidth 直接取存量（隐藏中 dynamicMax=Infinity，不会被误钳）。 */
const { width, dragging, onResizeStart, clamp } = useResizablePanel({
  storageKey: 'lynel:right-panel-width',
  defaultWidth: 0,
  min: MIN_WIDTH,
  dynamicMax,
  handle: 'left',
})

let observer: ResizeObserver | null = null

/** 首次展开：无存量宽度取容器 50%，随后按动态上限收敛 */
function initWidth(): void {
  if (width.value <= 0) {
    const container = rootEl.value?.parentElement
    if (container && container.clientWidth > 0) {
      width.value = Math.round(container.clientWidth / 2)
    }
  }
  if (width.value > 0) clamp()
}

/** 根元素内联样式：全屏交给 CSS（width:100%）；收起态完全隐藏后只剩展开按钮，
 *  不写任何内联样式（宽度自适应按钮，天然不会挤破左区，max-width 钳制随之删除）；
 *  展开态照旧只写 width —— 存量 / 首展 50% / clamp 逻辑一字不动。 */
const rootStyle = computed(() => {
  if (props.maximized) return undefined
  if (!props.visible) return undefined
  return { width: `${width.value}px` }
})

// 文件树折叠态不在此处干预：首次进入默认展开、之后按会话记忆用户上一次状态
// （files store 的 setSession 保存/恢复 collapsed）
watch(() => props.visible, (v) => {
  if (v) initWidth()
  else collapsedAt = Date.now()
})

onMounted(() => {
  initWidth()
  const container = rootEl.value?.parentElement
  if (!container || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    if (props.visible && width.value > 0) clamp()
  })
  observer.observe(container)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <aside
    ref="rootEl"
    class="right-pane"
    :class="{ dragging, maximized: props.maximized, collapsed: !props.visible }"
    :style="rootStyle"
  >
    <!-- 收起态完全隐藏顶部行与主体，右缘只留展开按钮（收起的 panel-right-close 对应
         panel-right-open）；宽度自适应按钮，collapsed 类负责去左描边与高度收口。 -->
    <div
      v-if="!props.maximized"
      v-show="props.visible"
      class="split-handle"
      title="拖拽调整宽度"
      @mousedown.prevent="onResizeStart"
    />
    <!-- 收起态唯一展开入口：纯 UI，v-if 渲染（展开态不挂） -->
    <div v-if="!props.visible" class="expand-rail">
      <button class="head-btn icon" title="展开右栏" aria-label="展开右栏" @click="requestExpand">
        <Icon name="panel-right-open" :size="13" />
      </button>
    </div>
    <!-- 顶部行：与左侧 sub-tabs（34px）同行同高、同配色（root 不挂 code-workspace-theme，
         顶部行用原始 UI 变量对齐左侧标签行；CodeView 自带 code-workspace-theme） -->
    <div v-show="props.visible" class="right-head">
      <span class="ws-label" :title="labelTitle" @click.stop="onLabelClick"><Icon name="folder-tree" :size="13" />文件</span>
      <FileTabs class="head-tabs" />
      <span class="spacer" />
      <!-- 全屏/还原纯图标（expand/shrink 对角箭头），hover title 提示；与收起同款 icon 按钮 -->
      <button
        class="head-btn icon"
        :title="props.maximized ? '还原' : '全屏'"
        :aria-label="props.maximized ? '还原' : '全屏'"
        @click="emit('toggle-fullscreen')"
      >
        <Icon :name="props.maximized ? 'shrink' : 'expand'" :size="13" />
      </button>
      <button class="head-btn icon" title="收起右栏" aria-label="收起右栏" @click="emit('collapse')">
        <Icon name="panel-right-close" :size="13" />
      </button>
    </div>
    <!-- 主体必须 v-show：底部 shell xterm / PTY 缓冲随挂载存活，v-if 会卸载丢失 -->
    <CodeView v-show="props.visible" :visible="props.visible" />
  </aside>
</template>

<style scoped>
.right-pane {
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-primary);
}
/* 收起态：顶部行与主体全部隐藏，只剩展开按钮。absolute 脱离 flex 流贴右缘 ——
   留在流里宽度 = 按钮 ~40px，左侧终端（.session-left flex:1）铺不满；
   定位锚是 HomeView 的 .session-content（position:relative）。
   CodeView 仍 v-show 挂载不卸载。 */
.right-pane.collapsed {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 5;
  border-left: none;
}
/* 收起态唯一内容：右缘展开按钮，与收起的 panel-right-close 图标对应 */
.expand-rail {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 5px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
}
/* 全屏：宽度交给 CSS（left 半区由 HomeView 隐藏），拖宽手柄一并隐去 */
.right-pane.maximized { width: 100% !important; }
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
.right-pane.dragging .split-handle { background: var(--accent); }
.right-pane.dragging { cursor: col-resize; }
.right-head {
  height: 34px;
  min-height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 6px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
  /* 宽度受根元素内联 width 钳制后，头部内容不得反向撑宽根元素：
     overflow 兜底裁切 + min-width:0 允许自身被压缩 */
  overflow: hidden;
  min-width: 0;
}
/* 「文件」标识 tab：右栏身份，与左侧 sub-tab.active 同款配色。
   点击翻转文件树折叠（onLabelClick），仅展开态可见 */
.ws-label {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  margin-left: 6px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft-bg);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  cursor: pointer;
}
/* FileTabs 移到顶行后去掉它自带的底色/底边（由 right-head 统一提供）。
   flex-shrink:1 + min-width:0 必须在展开态就生效：FileTabs 基础样式是
   flex-shrink:0，多 tab 时会把右侧全屏/收起按钮推出 .right-head
   （overflow:hidden）视口，按钮不可见也点不到。放开收缩后溢出交给它内部
   .tab-scroll 横向滚动，按钮固定留在头部右侧（收起态同理）。 */
.right-head :deep(.file-tabs) {
  height: 34px;
  background: transparent;
  border-bottom: none;
  padding: 0;
  margin-left: 4px;
  flex-shrink: 1;
  min-width: 0;
}
.spacer { flex: 1; }
.head-btn {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s;
}
.head-btn:hover { background: var(--bg-hover); }
.head-btn.icon { width: 24px; justify-content: center; padding: 0; border-color: transparent; }
</style>
