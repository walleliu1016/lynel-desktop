<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '../Icon.vue'
import GitPanel from './GitPanel.vue'
import ProjectTerminal from './ProjectTerminal.vue'
import { useGitStore } from '../../stores/git'

const props = defineProps<{
  sessionId: string
  workDir: string
  /** 「文件」子页是否可见（由 CodeView 透传）。终端必须据此决定是否启动进程：
   *  CodeView 被 HomeView 用 v-show 常挂载，自身感知不到子页切换。 */
  visible?: boolean
}>()

const gitStore = useGitStore()
/** Git 标签上的变更数徽章 */
const gitBadge = computed(() => gitStore.totalChanges)

const HEIGHT_KEY = 'lynel:code-bottom-height'
const COLLAPSED_KEY = 'lynel:code-bottom-collapsed'
const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 320

const rootEl = ref<HTMLElement | null>(null)

/** 面板可占的最大高度：以父容器实际高度为准（面板在 .code-view 内，比 window 矮），
 *  拿不到容器时回退到窗口的 70%。 */
function maxHeight(): number {
  const parentH = rootEl.value?.parentElement?.clientHeight ?? 0
  const base = parentH > 0 ? parentH : window.innerHeight
  return Math.round(base * 0.7)
}

function loadHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY))
    if (Number.isFinite(v) && v >= MIN_HEIGHT) return Math.min(v, maxHeight())
  } catch { /* localStorage 不可用则用默认值 */ }
  return DEFAULT_HEIGHT
}

/** 面板折叠态。从未设置过（key 不存在）时默认折叠 —— 终端不应默认占着编辑器的高度。
 *  用户手动展开/折叠后以 localStorage 为准。 */
function loadCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSED_KEY)
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

const height = ref(loadHeight())
const collapsed = ref(loadCollapsed())
// Git 更常用，作为展开后的默认标签
const activeTab = ref<'git' | 'terminal'>('git')

// ---------- 拖高（面板上边缘） ----------
const dragging = ref(false)
let startY = 0
let startHeight = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  startY = e.clientY
  startHeight = height.value
  dragging.value = true
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!dragging.value) return
  // 上边缘向上拖 = 变高，故用减法
  const next = startHeight - (e.clientY - startY)
  height.value = Math.min(maxHeight(), Math.max(MIN_HEIGHT, next))
}

function onResizeEnd() {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  try { localStorage.setItem(HEIGHT_KEY, String(height.value)) } catch { /* 忽略 */ }
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0') } catch { /* 忽略 */ }
}

// 窗口缩小后容器也变矮，重新夹取，避免面板把编辑器区压到 0
function onWindowResize() {
  const max = maxHeight()
  if (height.value > max) height.value = Math.max(MIN_HEIGHT, max)
}

onMounted(() => window.addEventListener('resize', onWindowResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (dragging.value) onResizeEnd()
})
</script>

<template>
  <section
    ref="rootEl"
    class="bottom-panel"
    :class="{ dragging, collapsed }"
    :style="{ height: collapsed ? '32px' : height + 'px' }"
  >
    <div v-if="!collapsed" class="panel-resize-handle" @mousedown.prevent="onResizeStart" />
    <div class="panel-bar">
      <template v-if="collapsed">
        <!-- 折叠态：整条即展开按钮，点任意位置都能展开（原先只有右侧 chevron 可点，太难点中） -->
        <button
          class="bar-expand"
          title="展开面板"
          aria-label="展开面板"
          @click="toggleCollapse"
        >
          <Icon :name="activeTab === 'git' ? 'git-branch' : 'terminal'" :size="13" />
          <span>{{ activeTab === 'git' ? 'Git' : '终端' }}</span>
          <span class="bar-spacer" />
          <Icon name="chevron-up" :size="14" />
        </button>
      </template>
      <template v-else>
        <button
          class="panel-tab"
          :class="{ active: activeTab === 'git' }"
          @click="activeTab = 'git'"
        >
          <Icon name="git-branch" :size="13" /> Git
          <span v-if="gitBadge > 0" class="tab-badge">{{ gitBadge }}</span>
        </button>
        <button
          class="panel-tab"
          :class="{ active: activeTab === 'terminal' }"
          @click="activeTab = 'terminal'"
        >
          <Icon name="terminal" :size="13" /> 终端
        </button>
        <span class="bar-spacer" />
        <button
          class="bar-btn"
          title="折叠面板"
          aria-label="折叠面板"
          @click="toggleCollapse"
        >
          <Icon name="chevron-down" :size="14" />
        </button>
      </template>
    </div>
    <!-- v-show 而非 v-if：终端实例必须常驻，切走再切回不能丢 buffer / 重建 PTY -->
    <div v-show="!collapsed" class="panel-body">
      <GitPanel v-show="activeTab === 'git'" />
      <ProjectTerminal
        v-show="activeTab === 'terminal'"
        :session-id="props.sessionId"
        :work-dir="props.workDir"
        :visible="(props.visible ?? true) && !collapsed && activeTab === 'terminal'"
      />
    </div>
  </section>
</template>

<style scoped>
.bottom-panel {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}
.bottom-panel.dragging { cursor: row-resize; }
.panel-resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: row-resize;
  z-index: 5;
  background: transparent;
}
.panel-resize-handle:hover { background: var(--accent); }
.panel-bar {
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
.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.panel-tab:hover { color: var(--text-primary); background: var(--bg-hover); }
.panel-tab.active { color: var(--text-primary); background: var(--code-hover); }
.panel-tab .tab-badge {
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--accent-soft-bg);
  color: var(--text-primary);
  font-size: 10px;
}
.bar-spacer { flex: 1; }
.bar-btn {
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
.bar-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
/* 折叠态整条展开按钮：撑满标签条，扩大点击热区 */
.bar-expand {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 4px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  cursor: pointer;
  text-align: left;
  transition: color 0.12s, background 0.12s;
}
.bar-expand:hover { color: var(--text-primary); background: var(--bg-hover); }
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
