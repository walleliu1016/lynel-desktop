# 代码编辑器改为第三个子页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把代码编辑器从会话页最右侧窄栏改为第三个子页「代码」，整页显示「左文件树 + 右多文件编辑器」，与终端/Trace 一样大。

**Architecture:** 新建 `CodeView.vue` 作为子页容器（横向 flex：左树面板 + 右编辑器面板），迁移 `CodeSidebar.vue` 的宽度/折叠/工具条逻辑；`HomeView` 的 `sub-tabs` 增加「代码」按钮与 `code` sub-pane，并删除布局层级的 `CodeSidebar` 窄栏。FileTree/FileTabs/CodeEditor 与 files store 全部复用。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia setup store、Monaco（懒加载单例）、Vite。

## Global Constraints

- 所有代码注释与 commit message 用简体中文。
- 提交前必须 `cd src/renderer && npx vue-tsc --noEmit` 与根目录 `npm run test:main` 全绿（本改造仅动前端，主进程测试仅需确认不受影响）。
- 禁止直接 `window.electronAPI`，统一走 `composables/useElectron`。
- 图标统一经 `components/Icon.vue` 引用（@lucide/vue），界面禁止 emoji / Unicode 符号当图标。
- 样式用 `styles/theme.css` 的 CSS 变量，不硬编码颜色。
- **provide/inject 注入键必须声明在普通 `<script>` 块（模块顶层）**：`<script setup>` 内的 `const KEY = Symbol(...)` 会被编译器搬进 setup 作用域、每实例新建 symbol，导致注入链断裂与递归组件无限挂载（本次改造的前置 bug 根因，不得复发）。
- 删除文件必须同步清理引用（删除 `CodeSidebar.vue` 的同时移除 `HomeView.vue` 的 import 与挂载），否则 vue-tsc 报错。
- 子页切换沿用现有 `sub-pane` 的 `v-show` 机制，切走不卸载 `CodeView`（草稿存 store 不丢）。

---

### Task 1: 新建 CodeView.vue 子页容器（左树右编辑器）

**Files:**
- Create: `src/renderer/src/components/code/CodeView.vue`
- Test: `src/renderer/src/components/code/CodeView.test.ts`

**Interfaces:**
- Consumes: `stores/files.ts` 的 `useFilesStore`（`workDir`/`expanded`/`collapsed`/`loadDir`/`rootCreateRequest`）；`components/code/FileTree.vue`、`FileTabs.vue`、`CodeEditor.vue`、`components/Icon.vue`。
- Produces: `CodeView`（默认导出）——子页容器，无 props，内部为左文件树面板（可拖宽 240–600、默认 300、可折叠为 32px 图标条）+ 右编辑器面板（`FileTabs` + `CodeEditor`）。供 Task 2 在 `HomeView` 的 code sub-pane 挂载。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/components/code/CodeView.test.ts`：

```ts
// 验证 CodeView 子页容器：展开态渲染树面板+编辑器面板，折叠态渲染展开按钮
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import CodeView from './CodeView.vue'
import { useFilesStore } from '../../stores/files'

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
}))

vi.mock('./FileTree.vue', () => ({ default: { name: 'FileTreeStub', template: '<div class="tree-stub" />' } }))
vi.mock('./FileTabs.vue', () => ({ default: { name: 'FileTabsStub', template: '<div class="tabs-stub" />' } }))
vi.mock('./CodeEditor.vue', () => ({ default: { name: 'CodeEditorStub', template: '<div class="editor-stub" />' } }))
vi.mock('../Icon.vue', () => ({ default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' } }))

describe('CodeView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('展开态渲染树面板 + 编辑器面板', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(false)
  })

  it('折叠态仅渲染展开按钮', () => {
    useFilesStore().collapsed = true
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(false)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: FAIL，提示找不到 `./CodeView.vue` 模块（组件尚不存在）。

- [ ] **Step 3: 写 CodeView.vue**

创建 `src/renderer/src/components/code/CodeView.vue`：

```vue
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
    <template v-if="!store.collapsed">
      <aside class="tree-panel" :style="{ width: width + 'px' }">
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
      <section class="editor-panel">
        <FileTabs />
        <CodeEditor />
      </section>
    </template>
    <div v-else class="tree-collapsed" title="展开文件树" @click="onExpand">
      <Icon name="panel-left-open" :size="16" />
    </div>
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
  color: var(--text-secondary);
  cursor: pointer;
  border-right: 1px solid var(--border);
  transition: color 0.12s, background 0.12s;
}
.tree-collapsed:hover { color: var(--text-primary); background: var(--bg-hover); }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。此时 `HomeView` 仍引用旧 `CodeSidebar`，不受本 Task 影响。

- [ ] **Step 6: 主进程测试确认不受影响（commit 前全绿规范）**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿（本次仅新增前端组件，主进程无改动）。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/code/CodeView.vue src/renderer/src/components/code/CodeView.test.ts
git commit -m "feat: 代码编辑器子页容器 CodeView（左文件树右编辑器，可拖宽/折叠）"
```

---

### Task 2: HomeView 集成「代码」子页 + 移除右侧窄栏 + 删除 CodeSidebar

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`（sub-tabs、code sub-pane、import、移除 CodeSidebar 挂载）
- Modify: `src/renderer/src/components/Icon.vue`（白名单加 `file-code`）
- Delete: `src/renderer/src/components/code/CodeSidebar.vue`

**Interfaces:**
- Consumes: Task 1 的 `CodeView`（默认导出子页容器）。
- Produces: 会话页 `sub-tabs` 顺序 `[终端] [Trace] [代码]`；`subTabBySession` 键类型扩展 `'terminal' | 'trace' | 'code'`。

- [ ] **Step 1: Icon.vue 白名单补 `file-code`**

修改 `src/renderer/src/components/Icon.vue`：

1. import 列表中 `Trash2,` 之后加 `FileCode,`（保持字母序：`FileCode` 应加在 `FileText` 之后）：

```ts
  FileCode,
  FileText,
```

2. `icons` map 中 `'file-text': FileText,` 之后加一行：

```ts
  'file-code': FileCode,
```

- [ ] **Step 2: HomeView.vue 增加「代码」sub-tab**

在 `src/renderer/src/views/HomeView.vue` 模板 `sub-tabs` 区块（当前为 `终端`、`Trace` 两个按钮），`Trace` 按钮之后追加：

```html
<button class="sub-tab" :class="{ active: activeSubTab === 'code' }" @click="setSubTab('code')">
  <Icon name="file-code" :size="13" /> 代码
</button>
```

- [ ] **Step 3: HomeView.vue 增加 code sub-pane**

在 `TracePane` 的 `sub-pane`（`v-show="activeSubTab === 'trace'"`）之后追加：

```html
<div v-show="activeSubTab === 'code'" class="sub-pane">
  <CodeView />
</div>
```

- [ ] **Step 4: HomeView.vue 移除 CodeSidebar 挂载与 import**

1. 删除模板尾部 `<CodeSidebar v-if="tabsStore.activeType === 'session' && activeSessionWorkdir" />` 这一行（当前在第 195 行附近）。
2. import 区把 `import CodeSidebar from '../components/code/CodeSidebar.vue'` 替换为 `import CodeView from '../components/code/CodeView.vue'`。
3. `subTabBySession` 类型从 `Record<string, 'terminal' | 'trace'>` 改为 `Record<string, 'terminal' | 'trace' | 'code'>`；`activeSubTab` computed 返回类型同步改为 `'terminal' | 'trace' | 'code'`。
4. `activeSessionWorkdir` 保留（`watch(activeSessionId)` 中仍使用），不要删。

- [ ] **Step 5: 删除 CodeSidebar.vue**

Run: `rm src/renderer/src/components/code/CodeSidebar.vue`

- [ ] **Step 6: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。若报 `CodeSidebar` 未找到，说明 import 未清理干净。

- [ ] **Step 7: 主进程测试确认不受影响**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/HomeView.vue src/renderer/src/components/Icon.vue
git rm src/renderer/src/components/code/CodeSidebar.vue
git commit -m "feat: 代码编辑器改为会话页第三个子页，移除右侧窄栏"
```

- [ ] **Step 9: 手动冒烟清单（dev server 运行中）**

启动 `npm run dev`（若未运行），逐项验证：

1. 会话页 `sub-tabs` 显示 `[终端] [Trace] [代码]`，点击「代码」整页显示代码工作区（高度占满、宽度占满）。
2. 文件树默认宽 300px；拖右边缘手柄可调宽（240–600）；折叠为 32px 图标条、再点展开恢复。
3. 工具条：刷新文件树、新建文件（树根弹行内输入）正常。
4. 打开多个文件 → 编辑器区 tab 依次排列；切 tab；编辑置脏圆点；Ctrl+S 保存；外部改动提示条（重新加载/保留本地）。
5. 未打开文件时编辑器区显示「从左侧文件树选择文件」。
6. 切走「代码」子页（到终端/Trace）再切回：未保存草稿保留；子页选中态按会话记忆（`subTabBySession`）。
7. 切换会话：文件树切到新 workDir、openFiles 重置。
8. 回归：不再出现 `Maximum call stack size exceeded`；右侧不再有窄栏残留。
