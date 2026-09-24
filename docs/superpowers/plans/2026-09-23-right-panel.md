# 会话右栏文件工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「文件」子页改造成从标签行起对半分的会话右侧常驻折叠栏（文件树 + 编辑器 + 底部 Git/终端面板），与终端路径弹出的旧分屏统一。

**Architecture:** 新建 `RightWorkspacePane.vue` 承载右栏（顶部行 = 文件标识 tab + FileTabs + 全屏/收起；主体 = 现有 `CodeView`），挂进 `HomeView` 的左右分栏结构；删除 `EditorSplitPane` 与 `editorInSplit` 双宿主互斥逻辑，`FileEditorPanel` 收敛为全应用唯一挂载点（在 `CodeView` 内）。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vitest/@vue/test-utils + `useResizablePanel`（localStorage 宽度持久化）。

**Spec:** `docs/superpowers/specs/2026-09-23-right-panel-design.md`；草图 `docs/superpowers/specs/2026-09-23-right-panel-mockup.html`（v7）。

## Global Constraints

- 只动渲染层（`src/renderer/`）；主进程零改动，最后跑 `npm run test:main` 回归必须全绿。
- 每个任务完成后必须全绿：`cd src/renderer && npx vitest run` 与 `cd src/renderer && npx vue-tsc --noEmit`。
- **本计划不含 git commit 步骤**：是否提交、何时提交由用户决定（用户未要求时不执行任何 git 提交）。
- 样式只用 `styles/theme.css` / `styles/code.css` 的 CSS 变量，不硬编码颜色；注释一律简体中文。
- 图标一律经 `components/Icon.vue`；本计划用到的 `panel-right-open`、`panel-right-close`、`folder-tree`、`maximize`、`restore`、`terminal`、`activity` **均已注册**，不要改 Icon.vue。
- 右栏收起**只能用 CSS 隐藏（`v-show`），禁止 `v-if` 卸载**：底部面板的项目终端 xterm / shell PTY 缓冲随挂载存活。
- 全应用同一时刻**只能有一个 `FileEditorPanel` 挂载点**（Monaco 同 URI 单 model）。改造后该点在 `CodeView.vue`。
- 拖宽 key：`lynel:right-panel-width`（新）；左区最小 400px、右栏 min 320px、首展开 = 容器 50%。
- `BottomPanel` 已默认折叠（`lynel:code-bottom-collapsed` 缺省即折叠、整条即展开按钮），**不需要改代码**，只做验证。

---

### Task 1: 新建 RightWorkspacePane 右栏组件（未接线）

**Files:**
- Create: `src/renderer/src/components/code/RightWorkspacePane.vue`
- Test: `src/renderer/src/components/code/RightWorkspacePane.test.ts`

**Interfaces:**
- Consumes: `useResizablePanel({ storageKey, defaultWidth, min, dynamicMax, handle })`（`src/renderer/src/composables/useResizablePanel.ts`，返回 `{ width, dragging, onResizeStart, clamp }`）；`FileTabs.vue`（无 props，读 `stores/files.ts`）；`CodeView.vue`（props `{ visible?: boolean }`）。
- Produces: 组件 `RightWorkspacePane`，props `{ visible: boolean; maximized?: boolean }`，emits `collapse`、`toggle-fullscreen`。Task 2 的 HomeView 依赖这两个 props 与两个 emit。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/components/code/RightWorkspacePane.test.ts`：

```ts
// 验证会话右栏：顶部行（文件标识/全屏/收起）、宽度初始化（首展开=容器50%）、
// 拖宽钳制（左区至少 400px）、全屏态、collapse / toggle-fullscreen 事件
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import RightWorkspacePane from './RightWorkspacePane.vue'

// files store 创建时即 initWatcher() 订阅 FileChanged，jsdom 无 preload，
// 按 CodeView.test.ts 先例 mock 整层 IPC 转发
vi.mock('../../composables/useElectron', () => ({
  FileListDir: vi.fn(() => Promise.resolve([])),
  FileRead: vi.fn(() => Promise.resolve({ content: '', binary: false, truncated: false })),
  FileWrite: vi.fn(() => Promise.resolve({ ok: true })),
  FileCreate: vi.fn(() => Promise.resolve({ ok: true })),
  FileRename: vi.fn(() => Promise.resolve({ ok: true })),
  FileDelete: vi.fn(() => Promise.resolve({ ok: true })),
  FileWatch: vi.fn(() => Promise.resolve()),
  FileUnwatch: vi.fn(() => Promise.resolve()),
  FileChanged: vi.fn(() => vi.fn()),
  GitChanged: vi.fn(() => vi.fn()),
}))
// CodeView 深层会拉 Monaco 相关组件，整棵 stub 掉
vi.mock('./CodeView.vue', () => ({
  default: { name: 'CodeViewStub', props: ['visible'], template: '<div class="code-view-stub" />' },
}))
vi.mock('./FileTabs.vue', () => ({
  default: { name: 'FileTabsStub', template: '<div class="file-tabs-stub" />' },
}))
vi.mock('../Icon.vue', () => ({
  default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' },
}))

const WIDTH_KEY = 'lynel:right-panel-width'

let observers: ResizeObserverStub[] = []
class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor() { observers.push(this) }
}

/** 当前挂载的右栏，afterEach 统一卸载（必须真卸载：否则 ResizeObserver /
 *  document 上的 mousemove 监听会活到下一个用例） */
let current: VueWrapper | null = null
function unmountCurrent() {
  const w = current
  current = null
  w?.unmount()
}

/** jsdom 的 clientWidth 恒为 0：从 Element.prototype 打掉这个只读 getter，
 *  只让「包含 .right-pane 的容器」报出模拟宽度，其余（body、右栏自身）一律 0。
 *  必须在挂载前生效 —— onMounted 的宽度初始化要读它。 */
let restoreClientWidth: (() => void) | null = null
function mountPane(containerWidth: number, props: { visible: boolean; maximized?: boolean } = { visible: true }) {
  restoreClientWidth?.()
  const spy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this !== document.body && !!this.querySelector('.right-pane') ? containerWidth : 0
  })
  restoreClientWidth = () => spy.mockRestore()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const wrapper = mount(RightWorkspacePane, { props, attachTo: container })
  current = wrapper
  return wrapper
}

describe('RightWorkspacePane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    observers = []
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    document.body.style.userSelect = ''
  })
  afterEach(() => {
    unmountCurrent()
    restoreClientWidth?.()
    restoreClientWidth = null
    document.body.innerHTML = ''
    document.body.style.userSelect = ''
  })

  it('渲染文件标识 tab、全屏/收起按钮与 CodeView', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    expect(wrapper.find('.ws-label').text()).toContain('文件')
    expect(wrapper.findAll('.head-btn').some((b) => b.text().includes('全屏'))).toBe(true)
    expect(wrapper.find('.head-btn[aria-label="收起右栏"]').exists()).toBe(true)
    expect(wrapper.find('.code-view-stub').exists()).toBe(true)
  })

  it('visible=false 时用 v-show 隐藏（不卸载，底部终端缓冲不丢）', async () => {
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    expect(wrapper.find('.code-view-stub').exists()).toBe(true)
    expect((wrapper.element as HTMLElement).style.display).toBe('none')
  })

  it('无存量宽度时首展开 = 容器 50%（容器 1200 → 600）', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('600px')
  })

  it('有存量宽度时优先用存量（700）', async () => {
    localStorage.setItem(WIDTH_KEY, '700')
    const wrapper = mountPane(1200)
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('700px')
  })

  it('拖宽上限保证左区至少 400px（容器 1200 → 796 = 1200-400-4）', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 800 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('796px')
  })

  it('拖宽下限 320px', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 200 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('容器量到 0 宽（隐藏中挂载）时不钳制，保留存量宽度', async () => {
    localStorage.setItem(WIDTH_KEY, '680')
    const wrapper = mountPane(0, { visible: false })
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('680px')
  })

  it('拖拽结束写入 localStorage', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 600 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    // 手柄在左缘：向左拖 200px → 右栏 600 → 800（800 ≤ 上限 796 时取 796，
    // 故从 600 拖到 400 的期望是 800 与 796 取小；这里往右拖 200 → 400）
    expect(Number(localStorage.getItem(WIDTH_KEY))).toBeGreaterThan(0)
  })

  it('点收起 emit collapse', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    await wrapper.find('.head-btn[aria-label="收起右栏"]').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)
  })

  it('点全屏 emit toggle-fullscreen；maximized=true 时挂 maximized 类且不写 width', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    const btn = wrapper.findAll('.head-btn').find((b) => b.text().includes('全屏'))
    await btn!.trigger('click')
    expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1)
    await wrapper.setProps({ maximized: true })
    expect(wrapper.find('.right-pane.maximized').exists()).toBe(true)
    expect(wrapper.findAll('.head-btn').some((b) => b.text().includes('还原'))).toBe(true)
    expect((wrapper.element as HTMLElement).style.width).toBe('')
  })

  it('卸载时断开 ResizeObserver', async () => {
    mountPane(1200)
    await nextTick()
    const ro = observers[observers.length - 1]
    expect(ro.disconnect).not.toHaveBeenCalled()
    unmountCurrent()
    expect(ro.disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/renderer && npx vitest run src/renderer/src/components/code/RightWorkspacePane.test.ts`
Expected: FAIL —— 找不到模块 `./RightWorkspacePane.vue`。

- [ ] **Step 3: 实现组件**

创建 `src/renderer/src/components/code/RightWorkspacePane.vue`：

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import FileTabs from './FileTabs.vue'
import CodeView from './CodeView.vue'
import { useResizablePanel } from '../../composables/useResizablePanel'

/** 会话右侧文件工作区折叠栏：顶部行（「文件」标识 tab + 文件 tabs + 全屏/收起）
 *  + 文件树/编辑器（CodeView）+ 底部 Git/终端面板。
 *  与左侧 终端/Trace 子页独立常驻：收起用 v-show 隐藏、不卸载 ——
 *  底部面板的项目终端 xterm / shell PTY 缓冲随挂载存活，收起再展开不能丢。
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
}>()

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

watch(() => props.visible, (v) => { if (v) initWidth() })

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
    v-show="props.visible"
    ref="rootEl"
    class="right-pane"
    :class="{ dragging, maximized: props.maximized }"
    :style="props.maximized ? undefined : { width: width + 'px' }"
  >
    <div
      v-if="!props.maximized"
      class="split-handle"
      title="拖拽调整宽度"
      @mousedown.prevent="onResizeStart"
    />
    <!-- 顶部行：与左侧 sub-tabs（34px）同行同高、同配色（root 不挂 code-workspace-theme，
         顶部行用原始 UI 变量对齐左侧标签行；CodeView 自带 code-workspace-theme） -->
    <div class="right-head">
      <span class="ws-label"><Icon name="folder-tree" :size="13" />文件</span>
      <FileTabs class="head-tabs" />
      <span class="spacer" />
      <button
        class="head-btn"
        :title="props.maximized ? '还原' : '全屏'"
        @click="emit('toggle-fullscreen')"
      >
        <Icon :name="props.maximized ? 'restore' : 'maximize'" :size="12" />
        <span>{{ props.maximized ? '还原' : '全屏' }}</span>
      </button>
      <button class="head-btn icon" title="收起右栏" aria-label="收起右栏" @click="emit('collapse')">
        <Icon name="panel-right-close" :size="13" />
      </button>
    </div>
    <CodeView :visible="props.visible" />
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
}
/* 「文件」标识 tab：右栏身份，与左侧 sub-tab.active 同款配色（静态不可点） */
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
}
/* FileTabs 移到顶行后去掉它自带的底色/底边（由 right-head 统一提供） */
.right-head :deep(.file-tabs) {
  height: 34px;
  background: transparent;
  border-bottom: none;
  padding: 0;
  margin-left: 4px;
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/renderer && npx vitest run src/renderer/src/components/code/RightWorkspacePane.test.ts`
Expected: PASS（全部 12 个用例）。

- [ ] **Step 5: 类型检查 + 全量渲染层测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 全绿（此时新组件未被任何地方引用，旧链路不受影响）。

---

### Task 2: HomeView 换接右栏，删除旧分屏与双宿主互斥

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`（模板 216-257 行、script 332-408 行、样式 1352-1380 行）
- Modify: `src/renderer/src/components/code/CodeView.vue`（props / 模板 / 树宽）
- Modify: `src/renderer/src/components/code/FileEditorPanel.vue`（移除 FileTabs）
- Modify: `src/renderer/src/components/code/CodeView.test.ts`
- Rewrite: `src/renderer/src/views/HomeView.invariant.test.ts`
- Delete: `src/renderer/src/components/code/EditorSplitPane.vue`、`src/renderer/src/components/code/EditorSplitPane.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RightWorkspacePane`（props `visible`/`maximized`，emits `collapse`/`toggle-fullscreen`）。
- Produces: `HomeView` 暴露 `subTabBySession`/`activeSubTab`/`setSubTab` 收窄为 `'terminal' | 'trace'`；`CodeView` props 只剩 `{ visible?: boolean }`；`FileEditorPanel` 不再含 FileTabs。Task 3 的文档改动以这些事实为准。

- [ ] **Step 1: 改 HomeView 模板（换接右栏）**

替换 216-257 行会话内容区为：

```html
          <div
            v-show="tabsStore.activeType === 'session'"
            class="content-pane session-content"
            :class="{ 'right-maximized': rightFullscreen }"
          >
            <template v-if="sessionTabs.length > 0">
              <div class="session-left">
                <div class="sub-tabs">
                  <button class="sub-tab" :class="{ active: activeSubTab === 'terminal' }" @click="setSubTab('terminal')">
                    <Icon name="terminal" :size="13" /> 终端
                  </button>
                  <button class="sub-tab" :class="{ active: activeSubTab === 'trace' }" @click="setSubTab('trace')">
                    <Icon name="activity" :size="13" /> Trace
                  </button>
                  <!-- 收起态的展开入口：面板图标（纯折叠/展开切换），展开后由右栏顶部「收起」接管 -->
                  <button
                    v-if="!files.splitOpen"
                    class="sub-tab sub-expand"
                    title="展开文件工作区"
                    aria-label="展开文件工作区"
                    @click="files.splitOpen = true"
                  >
                    <Icon name="panel-right-open" :size="13" />
                  </button>
                </div>
                <div v-show="activeSubTab === 'terminal'" class="sub-pane">
                  <div class="terminal-side">
                    <SessionTabContent
                      v-for="tab in sessionTabs"
                      :key="tab.payload?.sessionId as string"
                      v-show="activeSessionId === tab.payload?.sessionId"
                      :session-id="tab.payload?.sessionId as string"
                      :workdir="tab.payload?.workdir as string"
                      :visible="activeSessionId === tab.payload?.sessionId"
                      @open-file="onTerminalOpenFile"
                    />
                  </div>
                </div>
                <div v-show="activeSubTab === 'trace'" class="sub-pane">
                  <TracePane />
                </div>
              </div>
              <RightWorkspacePane
                :visible="files.splitOpen"
                :maximized="rightFullscreen"
                @collapse="onCollapseRight"
                @toggle-fullscreen="rightFullscreen = !rightFullscreen"
              />
            </template>
            <div v-else class="empty"><div class="empty-text">未选择会话</div></div>
          </div>
```

- [ ] **Step 2: 改 HomeView script**

1. 删除 import：`import EditorSplitPane from '../components/code/EditorSplitPane.vue'`；新增：`import RightWorkspacePane from '../components/code/RightWorkspacePane.vue'`。
2. 子页类型收窄（原 388-398 行）：

```ts
// 每个会话各自的 终端/Trace 选中态（按 sessionId 记录），切回会话时保留。
// 「文件」不再是子页 —— 它是会话右栏（files.splitOpen），与本映射无关。
const subTabBySession = ref<Record<string, 'terminal' | 'trace'>>({})
const activeSubTab = computed<'terminal' | 'trace'>(() => {
  const sid = activeSessionId.value
  return (sid && subTabBySession.value[sid]) || 'terminal'
})

function setSubTab(tab: 'terminal' | 'trace') {
  const sid = activeSessionId.value
  if (!sid) return
  subTabBySession.value = { ...subTabBySession.value, [sid]: tab }
}
```

3. 删除整个 `hostInSplit` computed（原 400-408 行，含注释），替换为全屏态与收起处理：

```ts
/** 右栏全屏铺满态（左半隐藏）。瞬态：切会话 / 收起即重置，不持久化；
 *  宽度本身由 RightWorkspacePane 的 localStorage 存量恢复，全屏期间不改宽度。 */
const rightFullscreen = ref(false)
// 右栏收起（任意路径：头部 ×、会话现场恢复守卫、setSession 清场）→ 一并退出全屏
watch(() => files.splitOpen, (open) => { if (!open) rightFullscreen.value = false })

function onCollapseRight() {
  files.splitOpen = false
  rightFullscreen.value = false
}
```

4. 切会话时重置全屏（在原 511 行 `watch(activeSessionId, ...)` 回调开头加一行）：

```ts
watch(activeSessionId, (newId) => {
  rightFullscreen.value = false
  if (!newId) return
  // ...原有逻辑不动
```

- [ ] **Step 3: 改 HomeView 样式**

在 `<style scoped>` 中（原 `.sub-tabs` 规则附近）：

1. 删除 `.sub-pane.has-split { flex-direction: row; }` 这一条（`.sub-pane` 保留）。
2. 新增：

```css
/* 会话内容区：左右分栏（左 = 标签行 + 终端/Trace，右 = 文件工作区折叠栏），
   分割从标签行开始、贯通整高 */
.session-content { flex-direction: row; }
.session-left {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 全屏：右栏铺满，左半整体隐藏（右栏仍挂载，终端现场不丢） */
.session-content.right-maximized .session-left { display: none; }
/* 展开入口推到标签行最右 */
.sub-expand { margin-left: auto; padding: 0 8px; }
```

- [ ] **Step 4: 改 CodeView.vue（去双宿主、树宽固定）**

1. props 区（11-18 行）替换为：

```ts
/** 右栏是否可见（由 HomeView 传 splitOpen）。CodeView 被 v-show 常挂载，
 *  自身感知不到展开/收起，底部面板的终端要据此决定是否启动。 */
const props = withDefaults(defineProps<{
  visible?: boolean
}>(), { visible: true })
```

2. 删除 `import { useResizablePanel } from '../../composables/useResizablePanel'` 与整段树宽拖拽 setup（37-44 行）。
3. 模板：`<div class="code-view code-workspace-theme" :class="{ dragging }">` 改为 `<div class="code-view code-workspace-theme">`；删除 `.resize-handle` div（84 行）；`<FileEditorPanel v-if="!props.editorInSplit" />` 改为 `<FileEditorPanel />`。
4. 样式：`.tree-panel` 规则里加 `width: 300px;`（固定宽，沿用原 defaultWidth；拖拽 handle 样式 `.resize-handle` 一并删除，`.code-view.dragging` 规则删除）。

- [ ] **Step 5: 改 FileEditorPanel.vue（FileTabs 移出）**

1. 删除 `import FileTabs from './FileTabs.vue'`。
2. 模板删除 `<FileTabs />` 行及其上方注释行（`<!-- tab 栏常驻：... -->`）。
3. 顶部注释块替换为：

```ts
/** 编辑器区：互斥的「编辑器 / diff」两个视图。
 *  全应用唯一挂载点（CodeView 内）。FileTabs 已上移到右栏顶部行
 *  （RightWorkspacePane），Monaco 同 URI 单 model 不变量由
 *  「结构上只有一个宿主」保证 —— 不得再新增第二处 FileEditorPanel 挂载。 */
```

- [ ] **Step 6: 删除旧分屏组件与其测试**

```bash
rm src/renderer/src/components/code/EditorSplitPane.vue src/renderer/src/components/code/EditorSplitPane.test.ts
```

- [ ] **Step 7: 重写 HomeView.invariant.test.ts（新不变量）**

整文件替换为：

```ts
// 右栏单宿主不变量（源码级，脆是设计的一部分）。
//
// Monaco 对同一 model URI 只允许一个 model，第二个 FileEditorPanel 实例会直接抛
// `Cannot add model because it already exists!`。改造后宿主唯一：HomeView 挂
// RightWorkspacePane（内部 → CodeView → FileEditorPanel），旧的 hostInSplit 双宿主
// 闸门与 EditorSplitPane 已删除。这里做源码级文本匹配：类型检查与组件测试
// （各自挂载、看不见全局）都发现不了「又加了第二个挂载点」，这几行能。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(p, 'utf8')
const homeSrc = read(join(here, 'HomeView.vue'))
// 刻意不用 new URL(...)：Vite 会把字面量模式当资源 URL 改写（见同文件旧版注释）
const rendererSrc = resolve(here, '..')
const codeViewSrc = read(join(rendererSrc, 'components', 'code', 'CodeView.vue'))
const fedSrc = read(join(rendererSrc, 'components', 'code', 'FileEditorPanel.vue'))

describe('右栏单宿主不变量', () => {
  it('HomeView 挂唯一右栏，旧分屏闸门已删净', () => {
    expect(homeSrc.includes('RightWorkspacePane'), 'HomeView 必须挂 RightWorkspacePane').toBe(true)
    expect(homeSrc.includes('hostInSplit'), 'hostInSplit 双宿主闸门必须已删除').toBe(false)
    expect(homeSrc.includes('EditorSplitPane'), '旧分屏组件必须已删除').toBe(false)
    expect(homeSrc.includes("setSubTab('code')"), '「文件」不再是子页').toBe(false)
    // 右栏收起必须是 CSS 隐藏：RightWorkspacePane 上不许出现 v-if
    const rp = homeSrc.match(/<RightWorkspacePane[^>]*>/)?.[0] ?? ''
    expect(rp.includes('v-if'), 'RightWorkspacePane 禁止 v-if（收起会卸载、丢底部终端缓冲）').toBe(false)
  })

  it('FileEditorPanel 全应用只有一个挂载点，且不再内含 FileTabs', () => {
    const inCodeView = codeViewSrc.match(/<FileEditorPanel\b/g)?.length ?? 0
    expect(inCodeView, `CodeView 内 FileEditorPanel 挂载数应为 1，实际 ${inCodeView}`).toBe(1)
    expect(homeSrc.includes('<FileEditorPanel'), 'HomeView 不得直接挂 FileEditorPanel').toBe(false)
    expect(codeViewSrc.includes('editorInSplit'), 'editorInSplit 双宿主条件必须已删除').toBe(false)
    expect(fedSrc.includes('<FileTabs'), 'FileTabs 必须已上移到右栏顶部行').toBe(false)
  })
})
```

- [ ] **Step 8: 更新 CodeView.test.ts**

1. 删除 `const WIDTH_KEY = 'lynel:code-tree-width'`、`vi.mock('./FileTabs.vue', ...)` 两行 mock。
2. 删除「折叠态」用例里的 `expect(wrapper.find('.tabs-stub').exists()).toBe(true)` 断言。
3. 删除 4 个拖宽用例：「拖宽超上限时宽度钳制到 600px」「拖宽超下限时宽度钳制到 240px」「拖宽结束写入 localStorage 持久化」「挂载时读取 localStorage 预存宽度」。
4. 删除「editorInSplit 为 true 时不渲染编辑器区」用例。
5. 新增两个用例（替换被删的拖宽用例）：

```ts
  it('文件树固定 300px：不再有拖拽 handle，也不写内联宽度', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    expect(wrapper.find('.resize-handle').exists()).toBe(false)
    expect((wrapper.find('.tree-panel').element as HTMLElement).style.width).toBe('')
  })

  it('不再接收 editorInSplit：编辑器区始终渲染', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView, { props: { editorInSplit: true } as any })
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
  })
```

- [ ] **Step 9: 运行渲染层测试与类型检查**

Run: `cd src/renderer && npx vitest run && npx vue-tsc --noEmit`
Expected: 全绿。若 `RightWorkspacePane.test` 中「点全屏」用例因 head-btn 文案匹配失败，先核对组件模板文案（`全屏`/`还原`）再动断言——**组件文案以 Task 1 为准，不许反过来改文案迁就测试**。

- [ ] **Step 10: 主进程回归**

Run: `npm run test:main`
Expected: 全绿（主进程零改动，仅作仓库约定回归）。

---

### Task 3: 文档与注释同步

**Files:**
- Modify: `CLAUDE.md`（第 11 节「两栏布局与每会话子页」）
- Modify: `src/renderer/src/composables/useResizablePanel.ts:27`（共用者注释）
- Modify: `src/renderer/src/stores/files.ts`（`splitOpen` / `SessionWorkspace` / `openInSplit` 注释语义）

**Interfaces:**
- Consumes: Task 2 落地后的事实（组件名、key、不变量）。
- Produces: 无代码行为变化；后续会话读到的架构描述与代码一致。

- [ ] **Step 1: 更新 useResizablePanel 注释**

`useResizablePanel.ts` 第 26-29 行注释中，把共用者列表改为：

```ts
/**
 * 可拖宽面板的三段式鼠标逻辑 + 宽度持久化。
 * GitPanel（变更列表宽）、RightWorkspacePane（会话右栏宽）共用。
 * （CodeView 文件树已改固定宽、EditorSplitPane 已删除。）
 * 必须在组件 setup 里调用：内部用 onBeforeUnmount 兜底清理监听。
 */
```

- [ ] **Step 2: 更新 files.ts 注释**

1. `SessionWorkspace.splitOpen` 字段注释（26-27 行）改为：

```ts
  /** 会话右栏（文件工作区折叠栏）是否展开 */
  splitOpen: boolean
```

2. `splitOpen` ref 声明注释（55-57 行）改为：

```ts
  /** 会话右栏（文件工作区折叠栏）是否展开。与文件 tab 组一起按会话记忆：
   *  切回会话时右栏仍是上次那组文件，语义连贯。 */
```

3. `openInSplit` 注释（181-182 行）改为：

```ts
  /** 在右栏打开文件（终端里点路径的入口）：打开文件并展开右栏。
   *  与 openFile 分开：openFile 只切 tab（文件树/树内点击本就处于已展开的右栏），
   *  openInSplit 额外负责把收起的右栏拉出来。 */
```

- [ ] **Step 3: 更新 CLAUDE.md 第 11 节**

将第 11 节开头的布局结构与相关条目按落地事实改写（保持该文档原有条目风格）：

1. 布局结构条目改为：

```markdown
- 布局结构：左侧栏（280px，可折叠为 44px） | 中间内容区（flex:1）。**没有右侧 Trace 侧栏**。
  - 左侧栏（`HomeView.vue`）：顶部收起按钮 + 云状态；入口按钮（首页 / DeepSeek Harness / 搜索 / 任务 / 收藏夹）；中部 SessionList；底部（账户 / 使用指南 / 设置）。
  - 中间内容区：GlobalTabs（首页 / 会话 / 设置 / 使用指南 / Harness / 任务）+ `.content`。
  - 会话标签页内左侧是「**终端 / Trace**」两个子页（`activeSubTab` + `subTabBySession` 按会话记忆，类型只有 `'terminal' | 'trace'`）；**「文件」不是子页**。
  - **会话右栏（`RightWorkspacePane.vue`）**：从标签行起整高对半的文件工作区折叠栏（顶部行 = 「文件」标识 tab + `FileTabs` + 全屏/收起，主体 = `CodeView` 即文件树 + 编辑器，底部 = `BottomPanel` Git/终端）。展开态 `stores/files.ts` 的 `splitOpen` 按会话记忆（恢复守卫 `saved.splitOpen && saved.openFiles.length > 0`）；宽度全局 `lynel:right-panel-width`（首展开 = 容器 50%，min 320，max = 容器−400−4，存 px）；全屏态 `rightFullscreen`（HomeView 内瞬态，收起/切会话重置）。收起用 `v-show`，**禁止 v-if**（底部项目终端 xterm/PTY 缓冲随挂载存活）。入口：左标签行最右 `panel-right-open` 图标（仅收起态显示）/ 终端输出点 workdir 内路径（`openInSplit`）。
```

2. 删除/替换以下旧条目（原文核对后改）：
   - 「会话标签页内是『终端 / Trace / 文件』三个子页」→ 已并入上面第 3 条。
   - 「终端子页左右分屏…`EditorSplitPane`」整段 → 改为一句话：旧 `EditorSplitPane` 已删除，路径点击统一走右栏（`openInSplit` → `splitOpen`）。
   - 「**编辑器区只有一个实例**…`hostInSplit`…两处时序 nextTick/dispose」两段 → 改为：**编辑器区只有一个实例**：`FileEditorPanel` 全应用唯一挂载点在 `CodeView`（右栏内），由结构保证；`FileTabs` 位于右栏顶部行。源码级守卫见 `HomeView.invariant.test.ts`。
   - `useResizablePanel` 条目中「（`CodeView` 文件树 / `GitPanel` 变更列表 / `EditorSplitPane` 右栏共用」→ 改为「（`GitPanel` 变更列表 / `RightWorkspacePane` 右栏共用；`CodeView` 文件树已改固定 300px）」。
   - `BottomPanel`/底部面板若提及展开时机 → 补注：默认折叠（`lynel:code-bottom-collapsed` 缺省即折叠），点整条展开。
3. 「已删除」列表补：`EditorSplitPane.vue`（及其测试）、`hostInSplit`、「文件」子页。

- [ ] **Step 4: 全量验证**

Run: `cd src/renderer && npx vitest run && npx vue-tsc --noEmit`
Run: `npm run test:main`
Expected: 两套全绿。

- [ ] **Step 5: 对照草图手测清单（`npm run dev`）**

- 收起态：左标签行最右有 `panel-right-open` 图标；点击展开，右栏默认约 50%。
- 拖分割线：320px 下限、左区不被挤没；刷新后宽度保持（`lynel:right-panel-width`）。
- 顶部行与 终端/Trace 标签同行同高；「文件」标识 tab 在最左；文件树固定宽、无拖拽手柄、可折叠。
- 终端输出点 workdir 内路径 → 自动展开右栏并激活该文件；workdir 外路径仍走系统默认程序。
- 「全屏」→ 左半消失、右栏铺满、按钮变「还原」；「还原」回原宽度；「收起」→ 退出全屏并收起。
- 切 Trace → 右栏不动；切会话 → 按现场恢复（有打开文件才恢复展开）。
- 底部 Git/终端默认折叠，点整条展开；Git / 终端切换正常。
- 关掉右栏最后一个文件 tab → 右栏保持展开空态（不突然收起）。
- Monaco：右栏展开/收起、切子页、全屏来回，控制台无 `Cannot add model because it already exists!`；编辑器撤销栈在右栏不卸载期间保持。
- 收起右栏再展开：底部终端 buffer 不丢、shell PTY 不重建。

---

## Self-Review 记录

1. **Spec 覆盖**：§3 布局 → Task 2 Step 1/3；§4.1 右栏组件 → Task 1、FileTabs 提升 → Task 2 Step 5 + Task 1 模板、CodeView → Task 2 Step 4、HomeView → Task 2 Step 1-3、BottomPanel → Spec 中「已默认折叠」，Task 3 Step 5 手测验证（无代码改动）；§4.2 删除 → Task 2 Step 6；§4.3 状态表 → key 分布在 Task 1（宽度）、Task 2（全屏/展开）、BottomPanel 既有（底部面板）；§5 交互 → Task 2 Step 1/2 + Task 1 emits；§6 不变量 → Task 2 Step 7 新不变量测试 + Task 3 文档；§7 测试 → 各任务步骤。
2. **占位符**：无 TBD/TODO；所有代码步骤均给完整代码。
3. **类型一致性**：`RightWorkspacePane` props/emits 在 Task 1 定义、Task 2 消费一致；storage key `lynel:right-panel-width`、常量 400/320/4、`rightFullscreen`/`onCollapseRight` 名称全文一致。
