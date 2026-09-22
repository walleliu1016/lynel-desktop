# 终端侧边文件编辑分屏 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「终端」子页改成左右分屏 —— 左边终端、右边可编辑的文件编辑器（含多文件 tab、保存、blame、diff），中间可拖宽，点终端里的文件路径直接在右栏打开而不切走终端。

**Architecture:** 把 `CodeView` 的编辑器区（`FileTabs` + `CodeEditor` + `CodeDiffView`）抽成 `FileEditorPanel.vue`，由 HomeView 的一个 computed `hostInSplit` 决定它挂在「分屏右栏」还是「文件子页」—— 用同一个条件驱动两处互斥渲染，保证全应用同一时刻只有一个 `CodeEditor` 实例（Monaco 对同一 model URI 只允许一个 model，两个实例会直接抛错）。终端子页的终端与右栏共用 `stores/files.ts` 的会话级现场，所以两处看到的 tab 组、激活文件、草稿是同一份。

**Tech Stack:** Electron + Vue 3 (`<script setup lang="ts">`) + Pinia (setup style) + Monaco + vitest 4 (`src/renderer/vitest.config.ts`，jsdom) + `@vue/test-utils`

**设计文档：** `docs/superpowers/specs/2026-09-22-terminal-file-split-design.md`
**可交互草图：** `docs/superpowers/specs/2026-09-22-terminal-file-split-mockup.html`

## Global Constraints

- 所有代码注释、commit message、文档一律**简体中文**。
- 样式用 `styles/theme.css` 的 CSS 变量，**不硬编码颜色**。
- 图标统一 `@lucide/vue` 经 `components/Icon.vue`；**本计划只用已注册的图标**（已核对 `Icon.vue` 的 `icons` 映射）：`close`、`panel-right-open`、`maximize`、`file-text`。禁止用 emoji / Unicode 符号当图标。
- Pinia 的 `ref<Record<K, V>>` 更新必须整体 spread：`state.value = { ...state.value, [id]: v }`。
- 错误走 `error` / reject，不抛未捕获异常（主进程未捕获异常会导致窗口白屏）。
- 渲染进程的纯函数工具放 `src/renderer/src/utils/`；跨组件复用的逻辑不许各写一份。
- `src/renderer/src/composables/useElectron.ts` 是唯一接触 `window.electronAPI` 的文件。
- 渲染层测试命令：`cd src/renderer && npx vitest run`（`npm run test:main` **只跑** `tests/main`，不含渲染层）。
- 每个 commit 前必须全绿：`npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit` + `cd src/renderer && npx vitest run`。
- commit 前在仓库内设 local git identity（不要依赖全局）。本仓库 local 已配置好，核对即可：
  ```bash
  git config user.name "walleliu1016"
  git config user.email "walleliu1016@gmail.com"
  ```
- 一个 task 一个 commit，格式 `<type>: <subject>`（type: feat / fix / refactor / test / docs / chore / ci）。
- 不提交构建产物或诊断文件（`.vsix`、`dist/`、`dist-electron/`、`*.log`、临时 `.cmd` / `.exe`）。

### 关键不变量（本计划必须维持）

- **同一时刻全应用只允许一个 `CodeEditor` 实例。** 驱动条件是 HomeView 的 `hostInSplit`（见 Task 8），两处宿主必须用它做 `v-if`，不能靠外层 `v-show` 之外的条件。
- **`BottomPanel`、`FileTree`、`GitPanel` 的内部实现不动**；`BottomPanel` 必须保持常挂载（项目终端 PTY 不能重建）。
- **终端子页的 `.sub-pane` 继续用 `v-show`**，`SessionTabContent` 不卸载（否则 xterm buffer 与 PTY 丢失）。
- 右栏宽度钳制保证左侧终端**至少 400px**；宽度全局持久化，展开态按会话持久化。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/composables/useResizablePanel.ts` | 「可拖宽面板」的三段式鼠标逻辑 + 宽度持久化（被 CodeView / GitPanel / EditorSplitPane 共用） | 新建 |
| `src/renderer/src/composables/useResizablePanel.test.ts` | 上述逻辑的单测 | 新建 |
| `src/renderer/src/components/code/FileEditorPanel.vue` | 编辑器区：`FileTabs` + 互斥的 `CodeEditor` / `CodeDiffView` | 新建 |
| `src/renderer/src/components/code/EditorSplitPane.vue` | 分屏右栏：拖宽手柄 + 头部（文件名 / 在文件中打开 / 收起）+ `FileEditorPanel` | 新建 |
| `src/renderer/src/components/code/EditorSplitPane.test.ts` | 右栏单测 | 新建 |
| `src/renderer/src/styles/code.css` | `.code-workspace-theme`：把 UI 变量重映射为 `--term-*` 的共享类 | 新建 |
| `src/renderer/src/stores/files.test.ts` | `splitOpen` / `openInSplit` / 会话现场恢复 | 新建 |
| `src/renderer/src/components/code/CodeView.vue` | 去掉内联拖宽、改用 `FileEditorPanel`、加 `editorInSplit` prop | 修改 |
| `src/renderer/src/components/code/GitPanel.vue` | 去掉内联拖宽、改用 composable | 修改 |
| `src/renderer/src/main.ts` | import `styles/code.css` | 修改 |
| `src/renderer/src/stores/files.ts` | `splitOpen` 状态 + `openInSplit()` + 现场快照 | 修改 |
| `src/renderer/src/views/HomeView.vue` | `hostInSplit`、终端子页分屏结构、`onTerminalOpenFile` 改走 `openInSplit` | 修改 |
| `src/renderer/src/components/code/CodeView.test.ts` | 补 mock + 新用例 | 修改 |
| `src/renderer/src/components/XtermTerminal.test.ts` | 补 mock | 修改 |
| `CLAUDE.md` | 记录新布局不变量 | 修改 |

---

## Task 1: 修渲染层测试基线（mock 漂移）

渲染层测试当前 **8 例失败**，与本次功能无关但会妨碍验证：`CodeView.test.ts` 的 `useElectron` mock 缺 `GitChanged`（`stores/git.ts:314` 在 setup 里调用它，组件挂载直接失败），`XtermTerminal.test.ts` 的 xterm `Terminal` mock 缺 `registerLinkProvider`（`FileLinkProvider` 后加的）。两者都是那个测试防线的 mock 漂移 —— 因为 `npm run test:main` 只跑 `tests/main`，渲染层测试从来没进门禁。

> 注：这两处修改**已经写在工作区里**（未提交），本 task 只需验证并提交。

**Files:**
- Modify: `src/renderer/src/components/code/CodeView.test.ts:9-19`
- Modify: `src/renderer/src/components/XtermTerminal.test.ts:33-56`

**Interfaces:**
- Consumes: 无
- Produces: 渲染层测试全绿的基线（后续所有 task 的验证前提）

- [ ] **Step 1: 确认两处 mock 补丁已就位**

`src/renderer/src/components/code/CodeView.test.ts` 的 `vi.mock('../../composables/useElectron', ...)` 里应有：

```ts
  FileChanged: vi.fn(() => vi.fn()),
  GitChanged: vi.fn(() => vi.fn()),
}))
```

`src/renderer/src/components/XtermTerminal.test.ts` 的 `Terminal` mock 返回对象里应有：

```ts
      dispose: vi.fn(),
      // FileLinkProvider 在 initializeTerminal 里注册；缺失会让挂载抛 TypeError
      // （jsdom 下没有真实 xterm，mock 必须补齐这个 API）
      registerLinkProvider: vi.fn(),
```

若缺失则补上。

- [ ] **Step 2: 跑测试确认全绿**

Run: `cd src/renderer && npx vitest run`
Expected: `Test Files  18 passed (18)` / `Tests  113 passed (113)`

（已实测：补这两处后即为上面的结果，无需再补别的 mock。）

- [ ] **Step 3: 确认主进程测试与类型检查未被影响**

Run: `npm run test:main && cd src/renderer && npx vue-tsc --noEmit`
Expected: 均无错误输出

- [ ] **Step 4: Commit**

```bash
git config user.name "walleliu1016"
git config user.email "walleliu1016@gmail.com"
git add src/renderer/src/components/code/CodeView.test.ts src/renderer/src/components/XtermTerminal.test.ts
git commit -m "test: 补齐渲染层测试的 mock 漂移（GitChanged / registerLinkProvider）"
```

---

## Task 2: `useResizablePanel` composable

把 `CodeView.vue:40-89` 与 `GitPanel.vue:69-119` 里逐字重复的三段式拖宽逻辑抽成一处。新增两项能力：`handle: 'left'` 的反向计算（右栏手柄在其左侧，向右拖是变窄），以及 `dynamicMax`（保证左侧终端至少 400px）。

**Files:**
- Create: `src/renderer/src/composables/useResizablePanel.ts`
- Test: `src/renderer/src/composables/useResizablePanel.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export interface ResizablePanelOptions {
    storageKey: string
    defaultWidth: number
    min: number
    max?: number
    dynamicMax?: () => number
    handle: 'right' | 'left'
  }
  export interface ResizablePanel {
    width: Ref<number>
    dragging: Ref<boolean>
    onResizeStart: (e: MouseEvent) => void
    clamp: () => void
  }
  export function useResizablePanel(opts: ResizablePanelOptions): ResizablePanel
  ```
  `dynamicMax` 存在时优先于 `max`；`dynamicMax` 返回 `Infinity` 表示不设上限（元素尚未挂载时用它）。`clamp()` 供容器尺寸变化后重新钳制。

- [ ] **Step 1: 写失败测试**

Create `src/renderer/src/composables/useResizablePanel.test.ts`:

```ts
// 验证可拖宽面板 composable：上下限钳制、反向手柄、动态上限、持久化
import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { useResizablePanel, type ResizablePanelOptions } from './useResizablePanel'

const KEY = 'lynel:test-panel-width'

/** composable 里用了 onBeforeUnmount，必须在组件上下文里调用 */
function mountPanel(opts: Partial<ResizablePanelOptions> = {}) {
  // 只能 shallowRef：深 ref 会把返回句柄里的 ref 拆掉（`api.value.width` 直接变成 number，
  // 运行时报 undefined、类型上 TS2551），`api.value!.width.value` 就取不到值
  const api = shallowRef<ReturnType<typeof useResizablePanel> | null>(null)
  const wrapper = mount(defineComponent({
    setup() {
      api.value = useResizablePanel({
        storageKey: KEY,
        defaultWidth: 300,
        min: 240,
        max: 600,
        handle: 'right',
        ...opts,
      })
      return () => null
    },
  }))
  return { wrapper, api }
}

describe('useResizablePanel', () => {
  beforeEach(() => { localStorage.clear(); document.body.style.userSelect = '' })
  afterEach(() => { document.body.style.userSelect = '' })

  it('无持久化值时用 defaultWidth', () => {
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it('读取 localStorage 里合法的宽度', () => {
    localStorage.setItem(KEY, '450')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(450)
  })

  it('localStorage 值超上限时收敛到上限（不整个丢弃用户的宽度偏好）', () => {
    localStorage.setItem(KEY, '9999')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(600)
  })

  it('localStorage 值非法时回退 defaultWidth', () => {
    localStorage.setItem(KEY, 'abc')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it('localStorage 值低于下限时回退 defaultWidth（下限不靠 clamp 收敛）', () => {
    localStorage.setItem(KEY, '100')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it("handle:'right' 向右拖变宽", () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }))
    expect(api.value!.width.value).toBe(450)
  })

  it('宽度钳制到上限', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    expect(api.value!.width.value).toBe(600)
  })

  it('宽度钳制到下限', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    expect(api.value!.width.value).toBe(240)
  })

  it("handle:'left' 向右拖变窄（手柄在面板左侧）", () => {
    // defaultWidth 提到 500：300 起步时任何「变窄」都会被 min(240) 截断，
    // 断言就变成在测钳制而不是在测方向
    const { api } = mountPanel({ handle: 'left', defaultWidth: 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 500 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 }))
    expect(api.value!.width.value).toBe(400)
  })

  it("handle:'left' 向左拖变宽（与 'right' 方向相反）", () => {
    const { api } = mountPanel({ handle: 'left', defaultWidth: 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 500 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    expect(api.value!.width.value).toBe(600)
  })

  it('dynamicMax 优先于 max', () => {
    const { api } = mountPanel({ dynamicMax: () => 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    expect(api.value!.width.value).toBe(500)
  })

  it('dynamicMax 返回 Infinity 时不设上限', () => {
    const { api } = mountPanel({ dynamicMax: () => Number.POSITIVE_INFINITY })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }))
    expect(api.value!.width.value).toBe(5200)
  })

  it('clamp() 按当前上限重新钳制', async () => {
    let limit = 600
    const { api } = mountPanel({ dynamicMax: () => limit })
    api.value!.width.value = 580
    limit = 400
    api.value!.clamp()
    await nextTick()
    expect(api.value!.width.value).toBe(400)
  })

  it('mouseup 写 localStorage 并结束拖拽', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(localStorage.getItem(KEY)).toBe('450')
    expect(api.value!.dragging.value).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })

  it('mouseup 之后 mousemove 不再改宽度', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }))
    expect(api.value!.width.value).toBe(300)
  })

  it('卸载时清理监听（拖拽中卸载不报错）', () => {
    const { wrapper, api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    expect(() => wrapper.unmount()).not.toThrow()
    expect(api.value!.dragging.value).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/composables/useResizablePanel.test.ts`
Expected: FAIL —— `Failed to resolve import "./useResizablePanel"`

- [ ] **Step 3: 实现 composable**

Create `src/renderer/src/composables/useResizablePanel.ts`:

```ts
import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface ResizablePanelOptions {
  /** 宽度持久化的 localStorage 键 */
  storageKey: string
  /** 读取失败 / 越界时的回退宽度 */
  defaultWidth: number
  min: number
  /** 静态上限（与 dynamicMax 二选一） */
  max?: number
  /** 动态上限，优先于 max。返回 Infinity 表示不设上限（元素尚未挂载时用它） */
  dynamicMax?: () => number
  /** 手柄所在边：'right' = 面板在左、向右拖变宽；'left' = 面板在右、向右拖变窄 */
  handle: 'right' | 'left'
}

export interface ResizablePanel {
  width: Ref<number>
  dragging: Ref<boolean>
  onResizeStart: (e: MouseEvent) => void
  /** 容器尺寸变化后按当前上限重新钳制（如窗口缩放、侧栏折叠） */
  clamp: () => void
}

/**
 * 可拖宽面板的三段式鼠标逻辑 + 宽度持久化。
 * CodeView（文件树宽）、GitPanel（变更列表宽）、EditorSplitPane（分屏右栏宽）共用。
 * 必须在组件 setup 里调用：内部用 onBeforeUnmount 兜底清理监听。
 */
export function useResizablePanel(opts: ResizablePanelOptions): ResizablePanel {
  const upper = () => (opts.dynamicMax ? opts.dynamicMax() : (opts.max ?? Number.POSITIVE_INFINITY))
  const clampTo = (v: number) => Math.min(upper(), Math.max(opts.min, v))

  function loadWidth(): number {
    try {
      const v = Number(localStorage.getItem(opts.storageKey))
      // 高于当前上限的值（上次拖到 900、后来换了更窄的窗口）交给 clampTo 收敛，
      // 不直接回退 defaultWidth —— 那会把用户的宽度偏好整个丢掉；
      // 低于下限的值（min 被调大过，或存储被写坏）与 NaN 一律回退 defaultWidth
      if (Number.isFinite(v) && v >= opts.min) return clampTo(v)
    } catch {}
    return opts.defaultWidth
  }

  const width = ref(loadWidth())
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
    const dx = e.clientX - startX
    width.value = clampTo(startWidth + (opts.handle === 'right' ? dx : -dx))
  }

  function onResizeEnd() {
    if (!dragging.value) return
    dragging.value = false
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    try {
      localStorage.setItem(opts.storageKey, String(width.value))
    } catch {}
  }

  // 拖拽中组件被卸载（切子页 / 关会话）：清理 document 上的监听，否则会泄漏到全局
  onBeforeUnmount(() => {
    if (dragging.value) onResizeEnd()
  })

  return { width, dragging, onResizeStart, clamp: () => { width.value = clampTo(width.value) } }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/composables/useResizablePanel.test.ts`
Expected: `Tests  16 passed (16)`

- [ ] **Step 5: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/composables/useResizablePanel.ts src/renderer/src/composables/useResizablePanel.test.ts
git commit -m "refactor: 抽出 useResizablePanel，合并重复的拖宽逻辑"
```

---

## Task 3: `CodeView` 与 `GitPanel` 改用 composable

**Files:**
- Modify: `src/renderer/src/components/code/CodeView.vue:1-10`（imports）、`:40-89`（删）、`:114`（:`style` 用 `width`）
- Modify: `src/renderer/src/components/code/GitPanel.vue:69-119`（删）、模板里的宽度绑定
- Test: `src/renderer/src/components/code/CodeView.test.ts`（现有 6 例必须保持绿，**不改断言**）

**Interfaces:**
- Consumes: `useResizablePanel`（Task 2）
- Produces: `CodeView` 里 `width` / `dragging` / `onResizeStart` 三个同名标识符（模板已用它们，语义不变）

- [ ] **Step 1: 先确认现有测试是绿的（改动前的基线）**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 2: 替换 `CodeView.vue` 的宽度/拖拽代码**

删除 `CodeView.vue:40-89`（整段「文件树面板宽度」+「拖宽」注释块与代码，含 `onBeforeUnmount(() => { if (dragging.value) onResizeEnd() })`），替换为：

```ts
// ---------- 文件树面板宽度（localStorage 持久化，240–600px） ----------
const { width, dragging, onResizeStart } = useResizablePanel({
  storageKey: 'lynel:code-tree-width',
  defaultWidth: 300,
  min: 240,
  max: 600,
  handle: 'right',
})
```

同时把 `vue` 的 import 改成 `import { computed, watch } from 'vue'` —— `ref` 与 `onBeforeUnmount` 在原文件里只被删掉的那段拖宽代码用到，留着会产生未使用导入（`vue-tsc` 是否报错取决于 tsconfig 的 `noUnusedLocals`，别赌）。

- [ ] **Step 3: 同样替换 `GitPanel.vue` 的宽度/拖拽代码**

删除 `GitPanel.vue:69-119`（「左右分栏宽度」注释块到 `onBeforeUnmount`），替换为：

```ts
// ---------- 左右分栏宽度（localStorage 持久化，200–640px） ----------
const { width: changesWidth, dragging, onResizeStart } = useResizablePanel({
  storageKey: 'lynel:git-changes-width',
  defaultWidth: 320,
  min: 200,
  max: 640,
  handle: 'right',
})
```

模板里的宽度绑定与手柄不变（仍用 `changesWidth` / `dragging` / `onResizeStart`）。

`vue` 的 import 改成 `import { computed, ref } from 'vue'` —— GitPanel 里 `onBeforeUnmount` 只被删掉的那段用到（`:117-119`），而 `ref` 还被 `message` / `committing` / `branchOpen` 等使用，必须保留。

- [ ] **Step 4: 跑测试确认仍绿**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: 类型检查 + 全量渲染层测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 无类型错误；`Tests  129 passed (129)`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/code/CodeView.vue src/renderer/src/components/code/GitPanel.vue
git commit -m "refactor: CodeView / GitPanel 改用 useResizablePanel"
```

---

## Task 4: 抽出 `FileEditorPanel.vue`

**Files:**
- Create: `src/renderer/src/components/code/FileEditorPanel.vue`
- Modify: `src/renderer/src/components/code/CodeView.vue:1-10`（imports）、`:33-38`（删）、`:134-144`（模板）、`:248-260`（样式）
- Test: `src/renderer/src/components/code/CodeView.test.ts`（新增 1 例）

**Interfaces:**
- Consumes: `stores/files.ts` 的 `openFiles` / `activeRelPath` / `activeView` / `diffRequest`（全部已存在）
- Produces: `FileEditorPanel.vue`（无 props、无 emits），根节点 class `.editor-panel`

- [ ] **Step 1: 写失败测试**

在 `src/renderer/src/components/code/CodeView.test.ts` 的 `describe` 内追加：

```ts
  it('editorInSplit 为 true 时不渲染编辑器区（编辑器已由分屏承载）', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView, { props: { editorInSplit: true } })
    expect(wrapper.find('.tree-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(false)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: FAIL —— 用例期望 `.editor-panel` 不存在但它存在（`editorInSplit` prop 还没实现）

- [ ] **Step 3: 新建 `FileEditorPanel.vue`**

Create `src/renderer/src/components/code/FileEditorPanel.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import FileTabs from './FileTabs.vue'
import CodeEditor from './CodeEditor.vue'
import CodeDiffView from './CodeDiffView.vue'
import { useFilesStore } from '../../stores/files'

/** 编辑器区：文件 tab 条 + 互斥的「编辑器 / diff」两个视图。
 *  宿主有两处 —— 「文件」子页的 CodeView 与「终端」子页的分屏右栏。
 *  两处用同一个条件互斥渲染（HomeView 的 hostInSplit），保证同一时刻全应用
 *  只有一个实例：CodeEditor 用 `file:///${relPath}` 建 Monaco model，而 Monaco
 *  对同一 URI 只允许一个 model，两个实例会直接抛
 *  `Cannot add model because it already exists!`。 */
const store = useFilesStore()

/** 编辑器区显示 diff 还是文件。必须**恰好一个**为真 —— 用互斥的 computed 表达，
 *  而不是各自判断：一旦 activeView 取到意外值（例如热更新后 store 实例陈旧、
 *  没有 activeView 字段，`undefined === 'file'` 为假），两个 v-show 会同时隐藏，
 *  编辑器区整块空白（连「从左侧文件树选择文件」都不出现）。 */
const showDiff = computed(() => store.activeView === 'diff' && !!store.diffRequest)
const showEditor = computed(() => !showDiff.value)
</script>

<template>
  <section class="editor-panel">
    <!-- tab 栏常驻：diff 是并列的一个 tab，不能因为看 diff 就把文件 tab 藏掉 -->
    <FileTabs />
    <!-- 用 v-show 而非 v-if：保留两个组件实例，避免 Monaco 反复重建 -->
    <div v-show="showEditor" class="editor-slot">
      <CodeEditor />
    </div>
    <div v-show="showDiff" class="editor-slot">
      <CodeDiffView />
    </div>
  </section>
</template>

<style scoped>
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
</style>
```

- [ ] **Step 4: 改造 `CodeView.vue`**

去掉 `import FileTabs / CodeEditor / CodeDiffView`（`:5-7`），改为 `import FileEditorPanel from './FileEditorPanel.vue'`。

删除 `:33-38` 的 `showDiff` / `showEditor` computed（连同注释，已搬到 `FileEditorPanel`）。

props 改为：

```ts
/** 「文件」子页当前是否可见。由 HomeView 传入 —— CodeView 被 v-show 常挂载，
 *  自身感知不到子页切换，而底部面板的终端要据此决定是否启动。 */
const props = withDefaults(defineProps<{
  visible?: boolean
  /** 编辑器已由终端子页的分屏右栏承载：本组件不再渲染编辑器区，
   *  保证同一时刻全应用只有一个 CodeEditor 实例（Monaco model URI 唯一）。 */
  editorInSplit?: boolean
}>(), { visible: true, editorInSplit: false })
```

模板 `:134-144`（`<section class="editor-panel">` 整块）替换为：

```html
      <FileEditorPanel v-if="!props.editorInSplit" />
```

样式 `:248-260` 的 `.editor-panel` / `.editor-slot` 两条删除（已搬到 `FileEditorPanel`）。

- [ ] **Step 5: 跑测试确认通过（含原有 6 例）**

Run: `cd src/renderer && npx vitest run src/components/code/CodeView.test.ts`
Expected: `Tests  7 passed (7)`

- [ ] **Step 6: 类型检查 + 全量渲染层测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 无类型错误；`Tests  130 passed (130)`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/code/FileEditorPanel.vue src/renderer/src/components/code/CodeView.vue src/renderer/src/components/code/CodeView.test.ts
git commit -m "refactor: 抽出 FileEditorPanel，为分屏复用做准备"
```

---

## Task 5: 把终端主题变量重映射抽成全局类

`CodeView.vue:155-187` 在 `.code-view` 根节点上把一批 UI 变量重映射为 `--term-*`（`CodeEditor` 与 `GitPanel` 都依赖）。编辑器搬到分屏右栏后不再位于 `.code-view` 内，会丢掉这套配色。抽成全局类 `.code-workspace-theme`，两个宿主都挂。

**Files:**
- Create: `src/renderer/src/styles/code.css`
- Modify: `src/renderer/src/main.ts:1-11`
- Modify: `src/renderer/src/components/code/CodeView.vue`（根节点加类、scoped 里删掉重映射块）

**Interfaces:**
- Consumes: 无
- Produces: 全局类名 `.code-workspace-theme`（Task 7 的 `EditorSplitPane` 根节点也要用）

- [ ] **Step 1: 新建 `styles/code.css`**

把 `CodeView.vue` 的 `<style scoped>` 里 `.code-view { ... }` 中**变量重映射那部分原样搬出**（保留原有注释），放到全局类里：

Create `src/renderer/src/styles/code.css`:

```css
/* 代码工作区配色跟随终端主题：把 UI 变量重映射为 --term-*（html 上全局可用）。
   放在全局样式表而非组件的 scoped style —— 「文件」子页的 CodeView 与
   「终端」子页的分屏右栏是两个组件，都要挂这个类。 */
.code-workspace-theme {
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
}
```

- [ ] **Step 2: 在 `main.ts` 里 import**

`src/renderer/src/main.ts`，在 `import './styles/tasks.css'` 之后加一行：

```ts
import './styles/code.css'
```

- [ ] **Step 3: `CodeView.vue` 挂类、删重复**

`CodeView.vue` 的模板根节点加类：

```html
  <div class="code-view code-workspace-theme" :class="{ dragging }">
```

`<style scoped>` 的 `.code-view { ... }` 里删掉那 24 行变量重映射（含两段注释），只留布局属性：

```css
.code-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  overflow: hidden;
}
```

- [ ] **Step 4: 结构化验证（子代理可做）**

没有自动化测试覆盖 CSS 变量，但可以静态确认「搬对了」：

```bash
# 重映射块必须只在全局类里，CodeView 的 scoped 样式里不能再有
grep -n -- '--bg-panel\|--status-ok\|--text-inverse' src/renderer/src/components/code/CodeView.vue src/renderer/src/styles/code.css
```

Expected: 命中的 `--status-ok` / `--text-inverse` 只出现在 `styles/code.css`；`CodeView.vue` 里一行都没有。

```bash
# main.ts 必须 import 了它
grep -n "styles/code.css" src/renderer/src/main.ts
```

**Step 5（视觉确认）不在本 task 做**：它需要真实渲染，子代理看不到画面。已并入 Task 8 Step 6 的人工验证清单，届时连同分屏一起在 `npm run dev` 里一次性过。

- [ ] **Step 5: 视觉确认并入 Task 8**

在 Task 8 的 `npm run dev` 人工验证里追加三项（Task 5 单独无法验证）：

1. 文件子页的编辑器背景仍是终端底色（不是 UI 面板色）；
2. Git 面板里「已暂存 / ahead」是绿色（`--status-ok` 生效）；
3. Git 面板的提交按钮是深色底浅色字（`--text-inverse` 生效，不是白字浅底）。

（`styles/code.css` 里的变量只被 `.code-workspace-theme` 后代使用，全局 import 不影响其他页面。）

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `npm run test:main && cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 全绿（渲染层仍是 19 files / 130 tests）

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/styles/code.css src/renderer/src/main.ts src/renderer/src/components/code/CodeView.vue
git commit -m "refactor: 终端主题变量重映射抽成全局类 .code-workspace-theme"
```

---

## Task 6: `stores/files.ts` 加 `splitOpen` 与 `openInSplit`

**Files:**
- Modify: `src/renderer/src/stores/files.ts:20-26`（`SessionWorkspace`）、`:36` 附近（新增 ref）、`:60-107`（`setSession` 保存/恢复）、`:158-170`（`openFile` 之后新增 `openInSplit`）、`:298-305`（导出）
- Test: `src/renderer/src/stores/files.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `store.splitOpen: Ref<boolean>`
  - `store.openInSplit(relPath: string): Promise<void>`
  - `SessionWorkspace` 新增字段 `splitOpen: boolean`

- [ ] **Step 1: 写失败测试**

Create `src/renderer/src/stores/files.test.ts`:

```ts
// 验证分屏展开态：openInSplit 打开文件并展开右栏；展开态按会话记忆
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFilesStore } from './files'

vi.mock('../composables/useElectron', () => ({
  FileListDir: vi.fn(() => Promise.resolve([])),
  FileRead: vi.fn((_wd: string, rel: string) =>
    Promise.resolve({ content: `// ${rel}`, binary: false, truncated: false })),
  FileWrite: vi.fn(() => Promise.resolve({ ok: true })),
  FileCreate: vi.fn(() => Promise.resolve({ ok: true })),
  FileRename: vi.fn(() => Promise.resolve({ ok: true })),
  FileDelete: vi.fn(() => Promise.resolve({ ok: true })),
  FileWatch: vi.fn(() => Promise.resolve()),
  FileUnwatch: vi.fn(() => Promise.resolve()),
  FileChanged: vi.fn(() => vi.fn()),
}))

describe('files store · 分屏展开态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认不展开', () => {
    expect(useFilesStore().splitOpen).toBe(false)
  })

  it('openInSplit 打开文件并展开右栏', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    expect(store.splitOpen).toBe(true)
    expect(store.activeRelPath).toBe('src/main/app.ts')
    expect(store.openFiles.map((f) => f.relPath)).toEqual(['src/main/app.ts'])
  })

  it('切走再切回恢复该会话的展开态', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    await store.setSession('s2', '/other')
    expect(store.splitOpen).toBe(false)
    await store.setSession('s1', '/repo')
    expect(store.splitOpen).toBe(true)
    expect(store.activeRelPath).toBe('src/main/app.ts')
  })

  it('展开态但没有任何打开文件时不恢复展开（避免空右栏）', async () => {
    const store = useFilesStore()
    await store.setSession('s1', '/repo')
    await store.openInSplit('src/main/app.ts')
    store.closeFile('src/main/app.ts')
    await store.setSession('s2', '/other')
    await store.setSession('s1', '/repo')
    expect(store.splitOpen).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/stores/files.test.ts`
Expected: FAIL —— `store.openInSplit is not a function`

- [ ] **Step 3: 实现**

`src/renderer/src/stores/files.ts`：

`SessionWorkspace` 增字段（放在 `activeRelPath` 之后）：

```ts
/** 按会话记忆的工作区现场（tab / 草稿 / 激活文件 / 展开态 / 分屏展开态） */
export interface SessionWorkspace {
  openFiles: OpenFile[]
  drafts: Record<string, string>
  activeRelPath: string | null
  expanded: string[]
  /** 终端子页右侧的文件编辑分屏是否展开 */
  splitOpen: boolean
}
```

新增 ref（放在 `blameEnabled` 之后）：

```ts
/** 终端子页右侧的「文件编辑分屏」是否展开。与文件 tab 组一起按会话记忆：
 *  切回会话时右栏仍是上次那组文件，语义连贯。 */
const splitOpen = ref(false)
```

`setSession` 的「保存当前会话现场」里加一行：

```ts
          activeRelPath: activeRelPath.value,
          expanded: [...expanded.value],
          splitOpen: splitOpen.value,
```

`setSession` 的「恢复新会话现场」两处分别加：

```ts
      activeRelPath.value = saved.activeRelPath
      expanded.value = new Set(saved.expanded)
      splitOpen.value = saved.splitOpen && saved.openFiles.length > 0
```

与（无现场分支）：

```ts
      activeRelPath.value = null
      expanded.value = new Set()
      splitOpen.value = false
```

在 `openFile` 之后新增：

```ts
/** 在分屏右栏打开文件（终端里点路径的入口）：打开文件并展开右栏。
 *  与 openFile 分开，是因为文件树 / git 面板走的是「文件」子页，不该把分屏也拉出来。 */
async function openInSplit(relPath: string) {
  await openFile(relPath)
  splitOpen.value = true
}
```

`return { ... }` 整块（`files.ts:298-305`）替换为：

```ts
  return {
    workDir, currentSessionId, tree, expanded, openFiles, drafts, activeRelPath, collapsed, rootCreateRequest,
    splitOpen,
    diffRequest, activeView, blameEnabled, openDiff, closeDiff, activateFile,
    setSession, forgetSession, loadDir, toggleExpand, openFile, openInSplit, closeFile, saveFile, reloadFile,
    setDraft, clearDraft,
    createEntry, renameEntry, deleteEntry,
    cleanupWatcher: () => { fileChangedCleanup?.(); fileChangedCleanup = null },
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/stores/files.test.ts`
Expected: `Tests  4 passed (4)`

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 全绿 —— 若 `saved.splitOpen` 报「属性不存在」，说明 `SessionWorkspace` 的字段没加。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/files.ts src/renderer/src/stores/files.test.ts
git commit -m "feat: files store 增加分屏展开态与 openInSplit"
```

---

## Task 7: `EditorSplitPane.vue`

**Files:**
- Create: `src/renderer/src/components/code/EditorSplitPane.vue`
- Test: `src/renderer/src/components/code/EditorSplitPane.test.ts`

**Interfaces:**
- Consumes: `useResizablePanel`（Task 2）、`.code-workspace-theme`（Task 5）、`stores/files.ts` 的 `activeRelPath` / `activeView` / `diffRequest`、`FileEditorPanel`（Task 4）
- Produces: `EditorSplitPane.vue`，emits `collapse`（点 `×`）与 `open-in-files`（点「在文件中打开」）；根节点 class `.editor-split`，手柄 class `.split-handle`

- [ ] **Step 1: 写失败测试**

Create `src/renderer/src/components/code/EditorSplitPane.test.ts`:

```ts
// 验证分屏右栏：头部标签、收起/跳转事件、拖宽钳制（保证左侧终端至少 400px）
import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import EditorSplitPane from './EditorSplitPane.vue'
import { useFilesStore } from '../../stores/files'

vi.mock('./FileEditorPanel.vue', () => ({
  default: { name: 'FileEditorPanelStub', template: '<div class="editor-panel" />' },
}))
vi.mock('../Icon.vue', () => ({
  default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' },
}))

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

const WIDTH_KEY = 'lynel:editor-split-width'

/** 用固定容器宽度模拟真实分屏容器（jsdom 的 clientWidth 恒为 0）。
 *  容器宽必须在挂载**之前**写好 —— 组件 onMounted 里的 clamp() 会读它。 */
function mountPane(containerWidth: number) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: containerWidth, configurable: true })
  document.body.appendChild(container)
  return mount(EditorSplitPane, { attachTo: container })
}

describe('EditorSplitPane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.userSelect = ''
  })

  it('渲染编辑器面板与头部文件名', () => {
    const store = useFilesStore()
    store.openFiles = [{
      relPath: 'src/main/app.ts', content: '', dirty: false, binary: false,
      truncated: false, externalChanged: false, savedVersion: 0,
    }]
    store.activeRelPath = 'src/main/app.ts'
    const wrapper = mountPane(1200)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.split-head .name').text()).toBe('src/main/app.ts')
  })

  it('没有激活文件时头部显示占位文案', () => {
    const wrapper = mountPane(1200)
    expect(wrapper.find('.split-head .name').text()).toBe('未打开文件')
  })

  it('看 diff 时头部显示路径与对比说明', () => {
    const store = useFilesStore()
    store.diffRequest = { relPath: 'src/main/app.ts', left: 'HEAD', right: 'WORKTREE', label: '工作区' }
    store.activeView = 'diff'
    const wrapper = mountPane(1200)
    expect(wrapper.find('.split-head .name').text()).toBe('src/main/app.ts · 工作区')
  })

  it('点 × emit collapse', async () => {
    const wrapper = mountPane(1200)
    await wrapper.find('.split-head .hbtn.icon').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)
  })

  it('点「在文件中打开」emit open-in-files', async () => {
    const wrapper = mountPane(1200)
    const btn = wrapper.findAll('.split-head .hbtn').find((b) => b.text().includes('在文件中打开'))
    await btn!.trigger('click')
    expect(wrapper.emitted('open-in-files')).toHaveLength(1)
  })

  it('默认宽度 480px', () => {
    const wrapper = mountPane(1200)
    expect((wrapper.element as HTMLElement).style.width).toBe('480px')
  })

  it('拖宽上限保证左侧终端至少 400px（容器 1200 → 上限 796）', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 800 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    expect((wrapper.element as HTMLElement).style.width).toBe('796px')
  })

  it('拖宽下限 320px', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 200 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('容器过窄时上限退化为 320px', () => {
    localStorage.setItem(WIDTH_KEY, '500')
    const wrapper = mountPane(600)
    // 挂载后按动态上限收敛：max(320, 600 - 400 - 4) = 320
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('容器量到 0 宽（祖先 v-show 隐藏）时不钳制，保留恢复的宽度', async () => {
    // 必须与「过窄」区分开：0 宽 = 量不到（不设上限），不是「容器只有 0px」
    localStorage.setItem(WIDTH_KEY, '680')
    const wrapper = mountPane(0)
    // 必须 await nextTick()：`:style` 更新是批处理的，同步读会读到 clamp 前的 680px，
    // 那样这个用例在**旧守卫下也会通过**（0 宽被算成上限 320 → 实际是 320），完全失去判别性
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('680px')
  })

  it('拖拽结束写入 localStorage', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 600 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    // 手柄在右栏左侧：左移 200px → 右栏变宽 480 → 680
    expect(localStorage.getItem(WIDTH_KEY)).toBe('680')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/code/EditorSplitPane.test.ts`
Expected: FAIL —— `Failed to resolve import "./EditorSplitPane.vue"`

- [ ] **Step 3: 实现组件**

Create `src/renderer/src/components/code/EditorSplitPane.vue`:

```vue
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

/** 手柄宽 4px（见 .split-handle），算动态上限时要扣掉 */
const HANDLE_WIDTH = 4
/** 左侧终端最小宽度：再窄 Claude 的 TUI 会碎成一行行 */
const TERMINAL_MIN_WIDTH = 400
const MIN_WIDTH = 320

/** 右栏宽度上限：容器宽 - 终端最小宽 - 手柄宽。
 *  容器量不到时返回 Infinity（不设上限），交给挂载后的 clamp 收敛。
 *
 *  「量不到」有**两种**，少判一种会丢用户宽度：
 *  ① setup 阶段元素还没挂载 → parentElement 为 null；
 *  ② 祖先处于 v-show 的 `display:none`（切到设置 / 首页等其它 tab 时整块隐藏）→
 *     元素在、但 clientWidth 为 0。
 *  ②若不设防，上限会算成 max(320, -404) = 320，`onMounted` / ResizeObserver 的 clamp()
 *  立刻把刚恢复的用户宽度压到 320；而 clampTo 只按当前值收敛（不会回弹），localStorage
 *  又只在 mouseup 落盘 —— 切一圈 tab 回来宽度就永久变成 320。 */
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/components/code/EditorSplitPane.test.ts`
Expected: `Tests  10 passed (10)`

若「容器过窄时上限退化为 320px」失败：确认 `onMounted` 里调了 `clamp()`（挂载前 `parentElement.clientWidth` 还没被测试改成 600，只有挂载后 clamp 一次才会收敛到 320）。

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/code/EditorSplitPane.vue src/renderer/src/components/code/EditorSplitPane.test.ts
git commit -m "feat: 新增终端子页的文件编辑分屏右栏"
```

---

### Task 7 勘误（实施中修正，以提交 `48efb17` 的测试文件为准）

本 task 的测试文件在实施时被发现**按原样从来跑不过**，组件本身是逐字实现的、无需改动。四处修正记录如下，后续写同类 jsdom 测试直接照抄：

1. **缺 `useElectron` 整层 mock。** `useFilesStore()` 在**创建 store 时**就 `initWatcher()` 订阅 `FileChanged`，而 `useElectron` 的 `api()` 在 `window.electronAPI` 缺失时直接抛错 —— jsdom 下没有 preload，所以不 mock 的话每个用例都在 setup 阶段炸。按 `CodeView.test.ts` 的先例补齐 10 个成员（含 `GitChanged`）。
2. **`clientWidth` 不能只写在 `attachTo` 的容器上。** `@vue/test-utils` 2.4.11 会在该容器与组件根节点之间再插一层自己的挂载点 `div`，组件的 `rootEl.parentElement` 是那一层，量到的是 0。改为在 `Element.prototype` 上打掉这个只读 getter：
   ```ts
   const spy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(containerWidth)
   ```
   清理时只 `spy.mockRestore()` 这一处，**不要用 `vi.restoreAllMocks()`** —— 它会连 `useElectron` 那层 mock 的实现一起清空。
3. **拖宽断言要 `await nextTick()`。** Vue 对 `:style` 的更新是批处理的，同步读 `style.width` 读到的是旧值。（断言 `localStorage` 的那条不需要 —— `setItem` 是同步写的。）
4. **原 Step 4 的提示是错的。** 它说「若容器过窄用例失败，确认 `onMounted` 里调了 `clamp()`」—— 实际 `clamp()` 一直都在，失败原因是上面第 1、2 条。

计数相应变化：渲染层此时是 **21 files / 144 tests**（原写 20 files / 130 是 Task 6 之后的数）。

---

## Task 8: `HomeView` 接入分屏

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue:1-20`（imports）、`:187-219`（终端子页结构 + CodeView 传参）、`:595-606`（`onTerminalOpenFile`）、`:1268`（`.sub-pane` 样式）

**Interfaces:**
- Consumes: `store.splitOpen` / `store.openInSplit`（Task 6）、`EditorSplitPane`（Task 7）、`CodeView` 的 `editorInSplit` prop（Task 4）
- Produces: 可用的分屏交互（无下游消费者）

- [ ] **Step 1: 加 import 与 `hostInSplit`**

`HomeView.vue` 顶部 import 区加：

```ts
import EditorSplitPane from '../components/code/EditorSplitPane.vue'
```

在 `activeSubTab` / `setSubTab`（`:350-359`）之后加：

```ts
/** 编辑器区是否由分屏右栏承载。必须用**同一个**条件驱动两处互斥渲染（分屏右栏 v-if、
 *  CodeView 的 editorInSplit），否则会出现两个 CodeEditor 实例并存 ——
 *  Monaco 对同一个 model URI 只允许一个 model，第二个会直接抛错。
 *
 *  刻意**不**带 `openFiles.length > 0`：用户当面关掉最后一个文件 tab 时，右栏保留空态
 *  （FileEditorPanel 显示「从左侧文件树选择文件」），不自动收起 —— 否则布局会在用户
 *  手下突然跳变。只有「切走会话再切回」才不恢复空右栏，那条由 stores/files.ts 的
 *  setSession 恢复守卫（`saved.splitOpen && saved.openFiles.length > 0`）负责。 */
const hostInSplit = computed(() => activeSubTab.value === 'terminal' && files.splitOpen)
```

- [ ] **Step 2: 改造终端子页结构**

把 `:200-210` 的终端 sub-pane 替换为：

```html
              <div v-show="activeSubTab === 'terminal'" class="sub-pane" :class="{ 'has-split': hostInSplit }">
                <!-- 包一层是为了给终端留 flex 容器：分屏时 .sub-pane 变成横向 flex，
                     终端必须能被压缩（min-width: 0），否则 xterm 不会 resize -->
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
                <EditorSplitPane
                  v-if="hostInSplit"
                  @collapse="files.splitOpen = false"
                  @open-in-files="setSubTab('code')"
                />
              </div>
```

`CodeView` 那行（`:215`）改为：

```html
                <CodeView :visible="activeSubTab === 'code'" :editor-in-split="hostInSplit" />
```

- [ ] **Step 3: 改 `onTerminalOpenFile`**

`:595-606` 改为（注释与 doc 同步更新，删掉 `setSubTab('code')`）：

```ts
/** 终端里点击 workdir 内文件路径：在右侧分屏打开，终端保持可见 */
async function onTerminalOpenFile(p: { sessionId: string; workdir: string; relPath: string }) {
  if (!p.sessionId || !p.workdir || !p.relPath) return
  // 只有当前激活会话的终端可点击；不一致时忽略（防错位切 store）
  if (activeSessionId.value !== p.sessionId) return
  try {
    await files.setSession(p.sessionId, p.workdir)
    await files.openInSplit(p.relPath)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'file', message: `打开文件失败：${e?.message ?? e}` })
  }
}
```

- [ ] **Step 4: 加样式**

`:1268` 的 `.sub-pane` 之后加：

```css
.sub-pane.has-split { flex-direction: row; }
.terminal-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
```

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `npm run test:main && cd src/renderer && npx vue-tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 6: 手动验证（`npm run dev`）—— 由 controller / 人工执行，子代理跳过**

逐项确认：

1. 终端里点文件路径 → 右栏展开、文件打开，**终端仍在跑**（没有跳子页）。
2. 右栏编辑器能改能存（改一下按 Ctrl+S，再看文件内容确实变了）。
3. 拖手柄：右栏变宽变窄；往左拖到底时右栏最多到「容器 - 404」，终端不被压到 400px 以下。
4. 点右栏 `×` → 收起，终端占满；再点路径又能展开。
5. 切到「文件」子页 → 看到的是同一组文件 tab、同一个激活文件；Git 面板与底部终端正常。
6. 切到 Trace 子页 → 右侧编辑器消失且**没有报 Monaco model 冲突**（这是本方案最关键的回归点）。
7. 切走会话再切回 → 分屏展开态与文件 tab 组都恢复。
8. 折叠左栏 / 缩小窗口 → 右栏宽度被自动收回，布局不破。
9. 拖宽文件子页的文件树、以及 Git 面板的分栏 —— 两个宽度仍能独立记忆（composable 没串味）。
10. **把右栏拖到一个非默认宽度（如 700），切到「设置」/「首页」tab 再切回会话** → 右栏宽度仍是 700，**不能变成 320**（Task 7 修复轮那条零宽守卫的端到端验证）。
11. 文件子页的编辑器背景仍是终端底色（不是 UI 面板色）—— Task 5 的视觉项。
12. Git 面板里「已暂存 / ahead」是绿色（`--status-ok` 生效）—— Task 5 的视觉项。
13. Git 面板的提交按钮是深色底浅色字（`--text-inverse` 生效，不是白字浅底）—— Task 5 的视觉项。

### Task 8 勘误不需要

本 task 的代码片段均经 Task 4/5/6/7 的实际接口核对，未发现需要修正处。若实施中发现片段与真实文件不符，按「先问再改」处理，不要自行发明布局。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "feat: 终端子页改为左右分屏，点路径在右侧打开文件"
```

---

## Task 9: 更新 `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`（§11 两栏布局与每会话子页、§16 Git 面板与文件工作区、相关文档清单）

**Interfaces:**
- Consumes: Task 1-8 的最终实现
- Produces: 无（文档）

- [ ] **Step 1: 订正过时描述**

`CLAUDE.md` 的「常用命令」小节里有一句：

```
- 根目录和 `src/renderer/` 是两个独立的 npm 项目，渲染进程有独立的 `package.json` 和 `vitest`/`@playwright/test` 依赖，但其 `test` 脚本目前是占位符（`echo "no tests yet" && exit 0`）。
```

改为：

```
- 根目录和 `src/renderer/` 是两个独立的 npm 项目，渲染进程有独立的 `package.json` 和 `vitest`/`@playwright/test` 依赖。渲染层测试用 `cd src/renderer && npx vitest run`（jsdom + `@vue/test-utils`，`src/renderer/vitest.config.ts`）—— 注意 `npm run test:main` **只跑** `tests/main`，不含渲染层。
```

并补一条到「常用命令」的注意列表：

```
- 渲染层测试（`cd src/renderer && npx vitest run`）与主进程测试（`npm run test:main`）是两套，改渲染层时两个都要跑；`npx vue-tsc --noEmit` 也在 `src/renderer` 下执行。
```

- [ ] **Step 2: 补第 11 节的分屏说明**

在「## 11. 两栏布局与每会话子页（Two-Panel Layout）」的「中间内容区」条目下，把「会话标签页内是「**终端 / Trace**」两个子页」这句改为「会话标签页内是「**终端 / Trace / 文件**」三个子页」，并追加一段：

```
- **终端子页左右分屏**：点终端输出里的 **workdir 内**文件路径不再跳「文件」子页，而是在终端右侧开出文件编辑分屏（左终端 / 右编辑器，中间可拖宽，右栏可收起）。目录与 workdir 外的路径仍走系统默认程序，由 `terminal/FileLinkProvider.ts` 分流，只有 workdir 内文件才 emit 到 `HomeView.onTerminalOpenFile` → `files.openInSplit()`。展开态存在 `stores/files.ts` 的 `splitOpen`；宽度是全局 localStorage `lynel:editor-split-width`（默认 480，钳制 320–动态上限，保证左侧终端至少 400px）。
  - 展开态**与文件现场一起按会话记忆**，恢复时有守卫：`saved.splitOpen && saved.openFiles.length > 0` —— 上次开着右栏但文件都被关掉了的会话，切回来不再恢复空右栏。注意这与「运行中关掉最后一个 tab」不同：后者右栏**保持展开**并显示编辑器空态（见下条 `hostInSplit` 的说明），只有切走再切回才不恢复。
- **编辑器区只有一个实例**：`FileEditorPanel`（= `FileTabs` + 互斥的 `CodeEditor` / `CodeDiffView`）挂在「分屏右栏」或「CodeView」两处之一，由 `HomeView` 的 `hostInSplit` 同一个条件驱动 `v-if` 互斥。**不能让两个实例并存** —— `CodeEditor` 用 `file:///${relPath}` 建 Monaco model，Monaco 对同一 URI 只允许一个 model，第二个实例直接抛 `Cannot add model because it already exists!`。分屏右栏那一侧必须用 `v-if`（不能只靠子页的 `v-show`），因为切到 Trace / 文件子页时终端子页只是被 `v-show` 隐藏。
- **切换瞬间也只有一个实例，靠的是 `CodeEditor.vue` 里的两处时序**：宿主互换时 `.sub-pane` 的补丁顺序会「先挂新 `CodeEditor`、后卸 `CodeView` 里的 `FileEditorPanel`」。之所以不冲突，是因为 (1) **调用方**在 `onMounted`（`CodeEditor.vue:272`）与 `watch(activeRelPath)`（`:207`）里先 `await nextTick()` 才调 `switchModel()`，而 `onMounted` 本身就是 post-flush 回调，`switchModel()` 内部还要再经 `ensureMonaco` / `ensureEditor` / `languageForPath` / `installTextMate` 等 await 才 `createModel()`（`:176`）；(2) 旧实例的 `model.dispose()` 在 `onBeforeUnmount`（`:280`）里**同步**执行。两者叠加 → 新的 `createModel` 总在旧 model 消失之后跑。**改动这两处 `nextTick` / `dispose` 时序前，必须先回来确认这条不变量还成立**，否则会出现两个 model 争同一 URI 的短暂窗口。
- 已知代价：宿主切换（终端子页 ↔ 文件子页、展开 / 收起分屏）会重建 Monaco 编辑器，**撤销栈丢失**；文件内容不丢（草稿在 `stores/files.ts` 的 `drafts`）。
- `styles/code.css` 的 `.code-workspace-theme` 是 `.code-view` 与 `EditorSplitPane` 共用的变量重映射类（把 UI 变量映射到 `--term-*`）。新增代码工作区容器时**必须挂这个类**，否则编辑器 / Git 面板配色会回退成 UI 面板色。
- `composables/useResizablePanel.ts` 是**代码工作区**拖宽面板的实现（`CodeView` 文件树 / `GitPanel` 变更列表 / `EditorSplitPane` 右栏共用），这三处不要再各写一份。**但它不是全仓唯一**：任务面板的 `components/tasks/TasksPane.vue`（`lynel:tasks-list-width`）与 `components/code/BottomPanel.vue`（垂直拖高）各有一份自己的拖拽实现 —— 将来若统一，把它们一并收编，别以为改这一个就够。`handle` 表示手柄所在边：`'right'` 是面板在左、向右拖变宽；`'left'` 是面板在右、向右拖变窄。
```

- [ ] **Step 3: 把新文档加进「相关文档」**

在「## 相关文档」列表末尾加：

```
- `docs/superpowers/specs/2026-09-22-terminal-file-split-design.md` —— 终端侧边文件编辑分屏设计文档。
- `docs/superpowers/plans/2026-09-22-terminal-file-split.md` —— 终端侧边文件编辑分屏实施计划。
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 记录终端分屏布局与单编辑器实例的不变量"
```

---

## 收尾

- 全部 task 完成后按 `superpowers:finishing-a-development-branch` 收口。
- **本计划不包含发版**（不改 `package.json` 版本、不写 `docs/changelog/`）—— 需要发版时另起流程。
- 计划中的两个**待确认项**（用户尚未答复）：
  1. 是否顺带订正 `CLAUDE.md` 里「渲染层 test 脚本是占位符」的过时描述（已并入 Task 9，若不要则删掉该 Step）。
  2. 设计文档与草图的 commit 尚未执行 —— 用户全局约定是「没主动要求就不碰 git」。
