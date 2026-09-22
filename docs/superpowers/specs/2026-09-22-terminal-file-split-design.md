# 终端侧边文件编辑分屏设计

日期：2026-09-22

## 背景与目标

现状：点击终端输出里的文件路径 → `HomeView.onTerminalOpenFile()` 打开文件并**切到「文件」子页**（`HomeView.vue:595-606`）。问题是看代码时终端被整块替换掉，来回切换要丢上下文 —— 尤其「Claude 改完文件我核对一眼」这个高频动作。

目标：把「终端」子页改造成**左右分屏** —— 左边终端、右边文件编辑器，中间可拖宽。点终端里的文件路径直接在右栏打开，终端不再消失。右栏可收起回终端占满。

## 已确认需求

1. **可编辑**：右栏是完整的编辑器（多文件 tab、脏标记、Ctrl+S 保存、行内 blame、diff tab），不是只读预览。
2. **触发**：点终端输出中的 workdir 内文件路径 → 右栏**自动展开**并打开该文件，**不再跳「文件」子页**。
3. **可收起**：右栏头部有 `×`，收起后终端占满。
4. **可拖宽**：中间拖拽手柄调整右栏宽度。
5. **「文件」子页保留**：树、多 tab、Git/终端底栏全部原样留在文件子页，本次不动。
6. **记忆**：是否展开**按会话**记忆（随该会话的文件 tab 组一起恢复）；宽度**全局**记忆。
7. **Trace 子页不分屏**。

## 布局与交互

```
会话页 sub-tabs: [终端] [Trace] [文件]        ← 停留在「终端」

右栏收起时（默认）：
┌──────────────────────────────────────────────┐
│  终端（占满）                                 │
└──────────────────────────────────────────────┘

点终端里的 `src/main/tasks/runner.ts` → 右栏自动展开：
┌────────────────────────┬─┬───────────────────┐
│                        │ │ app.ts        ×  │ ← 头部：当前文件名 + 在文件中打开 + 收起
│   终端（resize 后变窄） │⇔│ [app.ts][x.ts]    │ ← FileTabs（多文件、脏点、关闭）
│                        │ │                   │
│  · 点路径 → 右栏打开   │ │   Monaco 编辑器   │
│                        │ │                   │
└────────────────────────┴─┴───────────────────┘
              ⇔ = 拖拽手柄（右栏宽度 320–900，全局记忆）
```

- 右栏头部：当前文件名（取自 `store.activeRelPath`，看 diff 时显示 `diffRequest.label`）+「在文件中打开」按钮（跳「文件」子页，方便用文件树和 Git 面板）+ `×` 收起。
- 右栏内容与「文件」子页共用同一份会话级现场（`openFiles` / `activeRelPath` / 草稿 / diff），所以右栏打开的 tab 组切到「文件」子页仍是同一组 —— 语义连贯，不是两套状态。

## 关键约束与设计决策

### 1. 全应用同一时刻只允许一个编辑器实例

`CodeEditor.vue` 用 `file:///${relPath}` 建 Monaco model（`CodeEditor.vue:175`），而 Monaco 对同一 URI 只允许一个 model —— 第二次 `createModel` 直接抛 `Cannot add model because it already exists!`。

注意 `CodeEditor` 内部的 `editor` / `model` / `activeModelRelPath` **不是**模块级单例：`<script setup>` 把顶层绑定编译进每个实例各自的 `setup()` 作用域（源码里「同一时刻只维护一个 live 编辑器」那句说的是「一个实例内部只维护一个编辑器」，不构成全应用互斥）。所以全应用唯一性没有任何语言层面的兜底 —— 它**只**由 Monaco 的 URI 唯一性加上下一段的单闸门保证。

`CodeView` 在会话页是 `v-show` 常挂载的，所以**不能**简单地在右栏再挂一个 `CodeEditor`。

决策：把编辑器区抽成 `FileEditorPanel.vue`，用**同一个 computed**驱动两个宿主，保证互斥：

```ts
// HomeView.vue
const hostInSplit = computed(() => activeSubTab.value === 'terminal' && files.splitOpen)
```

- 右栏：`<EditorSplitPane v-if="hostInSplit" />`
- `CodeView`：`<CodeView :editor-in-split="hostInSplit" />`，内部 `v-if="!props.editorInSplit"` 才渲染 `.editor-panel`

右栏这一侧必须用 `v-if`（而不是靠外层子页的 `v-show`）：切到 Trace / 文件子页时终端子页只是被 `v-show` 隐藏，若右栏仍挂载就会与 CodeView 的实例并存，直接触发上面的 URI 冲突。

### 2. 已知代价：宿主切换会重建 Monaco，撤销栈丢失

右栏展开/收起、以及「终端 ↔ 文件」子页互切时，`FileEditorPanel` 会卸载再挂载 → Monaco 编辑器重建 → **Ctrl+Z 历史丢失**。文件内容不丢（未保存草稿存在 `stores/files.ts` 的 `drafts`，`CodeEditor` 卸载时有意保留）。这是本方案唯一的实质损失，接受。

### 3. 终端变窄是固有代价

`XtermTerminal` 靠 `ResizeObserver` + 150ms debounce 重新 `fit()`，分屏后终端 cols 会减少，Claude 的 TUI 换行更碎。这是分屏固有的，用「终端至少保留 400px」的下限约束把影响限制在可接受范围。

### 4. 配色重映射必须跟着编辑器走

`CodeView.vue:155-187` 在 `.code-view` 根节点上把一批 UI 变量重映射为 `--term-*`（编辑器与 `GitPanel` 都依赖）。编辑器搬到分屏后不再位于 `.code-view` 内，会丢掉这套配色。

决策：把这段重映射抽成全局类 `.code-workspace-theme`，放 `styles/code.css`（与 `styles/tasks.css` 同一先例，在 `main.ts` import），`.code-view` 与 `EditorSplitPane` 根节点都挂上。

### 5. 拖拽逻辑已经重复两份，这次收债

`CodeView.vue:54-89`（文件树宽）与 `GitPanel.vue:69-119`（变更列表宽）是几乎逐字相同的三段式鼠标事件。本方案是新右栏的第三份使用方，先抽 `composables/useResizablePanel.ts`，三处共用。

## 组件结构

### 新增 `composables/useResizablePanel.ts`

```ts
interface ResizablePanelOptions {
  storageKey: string                                    // localStorage key
  defaultWidth: number                                  // 读取失败 / 越界时的回退值
  min: number
  /** 手柄所在边：'right' = 面板在左、向右拖变宽；'left' = 面板在右、向右拖变窄 */
  handle: 'right' | 'left'
  /** 动态上限（如「保证左侧终端至少 400px」）。缺省用静态 max */
  max?: number | (() => number)
}

function useResizablePanel(opts: ResizablePanelOptions): {
  width: Ref<number>
  dragging: Ref<boolean>
  onResizeStart: (e: MouseEvent) => void
}
```

行为与现有两处逐字一致：`mousedown` 时 `e.preventDefault()`、记录 `startX/startWidth`、`document.body.style.userSelect = 'none'`、在 `document` 上挂 `mousemove`/`mouseup`；`mouseup` 写 localStorage 并清理；`onBeforeUnmount` 兜底清理（现有两处已有该清理）。新增 `handle: 'left'` 的反向计算与 `max` 的动态求值。

### 新增 `components/code/FileEditorPanel.vue`

内容 = `CodeView.vue:134-144` 原样搬入：

```html
<FileTabs />
<div v-show="showEditor" class="editor-slot"><CodeEditor /></div>
<div v-show="showDiff" class="editor-slot"><CodeDiffView /></div>
```

`showDiff` / `showEditor` 的互斥 computed（`CodeView.vue:37-38`，含「必须恰好一个为真」的注释）一并搬入。

**布局归属**：原 `CodeView` 里 `.editor-panel`（`flex:1; min-width:0; min-height:0` + 纵向 flex）与 `.editor-slot`（`flex:1; min-height:0` + 纵向 flex）的样式随组件一起搬入 `FileEditorPanel.vue` 的 scoped style，并把 `.editor-panel` 作为组件根节点 —— 否则编辑器拿不到高度、渲染成 0 高。组件不含宽度/边框/背景，宽度由宿主容器（`.main-row` 的 flex 或 `EditorSplitPane` 的固定像素宽）决定。

### 新增 `components/code/EditorSplitPane.vue`

右栏整体：拖拽手柄 + 头部 + `FileEditorPanel`。

- 根节点：`position: relative`、`flex-shrink: 0`、`display: flex`、`flex-direction: column`、`min-width: 0`、挂 `.code-workspace-theme`、`border-left: 1px solid var(--border)`，宽度 `:style="{ width: width + 'px' }"`。
- 内部用 `useResizablePanel({ storageKey: 'lynel:editor-split-width', defaultWidth: 480, min: 320, handle: 'left', max: dynamicMax })`。
- `dynamicMax()`：读根元素的 `parentElement.clientWidth`，返回 `Math.max(320, containerWidth - TERMINAL_MIN_WIDTH - HANDLE_WIDTH)`，`TERMINAL_MIN_WIDTH = 400`。用 `ResizeObserver` 监听容器，容器变窄时重新钳制 `width`（避免拖窗口 / 折叠左栏后左栏被挤没）。
- 手柄：`position: absolute; left: 0; top: 0; bottom: 0; width: 4px; cursor: col-resize; z-index: 5`。
- 头部：当前文件名 / diff 标签 +「在文件中打开」按钮 + `×`。`×` emit `collapse`。
- 抽成独立组件而非内联进 `HomeView`：`HomeView.vue` 已 1200+ 行，且独立组件可直接单测（渲染/收起/拖拽钳制），不必挂载整个 HomeView。

### 改造 `components/code/CodeView.vue`

- 删除 `:40-89` 的宽度/拖拽代码，改用 `useResizablePanel({ storageKey: 'lynel:code-tree-width', defaultWidth: 300, min: 240, max: 600, handle: 'right' })`。
- `<section class="editor-panel"> … </section>` 整块替换为 `<FileEditorPanel v-if="!props.editorInSplit" />`（`.editor-panel` 由 `FileEditorPanel` 自己渲染；原有 `.editor-panel` / `.editor-slot` 样式一并删掉，避免两份）。
- 新增 prop `editorInSplit?: boolean`（默认 `false`）：为 `true` 时**不渲染**编辑器区（编辑器已由分屏承载）。
- 根节点加全局类 `code-workspace-theme`；原 scoped 里的变量重映射块删除（迁到 `styles/code.css`），保留布局属性。
- `BottomPanel`、`FileTree`、`GitPanel`、工具栏一律不动；`BottomPanel` 常挂载 → 项目终端 PTY 不重建。

### 改造 `stores/files.ts`

```ts
const splitOpen = ref(false)
/** 在分屏右栏打开文件（终端路径点击入口）：打开文件并展开右栏 */
async function openInSplit(relPath: string) {
  await openFile(relPath)
  splitOpen.value = true
}
```

- `SessionWorkspace` 增字段 `splitOpen: boolean`；`setSession` 的「保存现场」与「恢复现场」两处各加一行（`splitOpen` 与 `openFiles` / `drafts` / `activeRelPath` / `expanded` 同一份快照）。
- **恢复时的守卫**：`splitOpen.value = saved.splitOpen && saved.openFiles.length > 0` —— 避免切回一个「上次展开了右栏但文件都被关掉了」的会话时看到空右栏。
- 导出 `splitOpen` / `openInSplit`。

### 改造 `views/HomeView.vue`

- 新增 `const hostInSplit = computed(() => activeSubTab.value === 'terminal' && files.splitOpen)`。
- 终端子页结构（`.sub-pane` 由 `v-show` 保持，`SessionTabContent` 仍常挂载 → 终端不重建）：

```html
<div v-show="activeSubTab === 'terminal'" class="sub-pane" :class="{ 'has-split': hostInSplit }">
  <div class="terminal-side">
    <SessionTabContent v-for="tab in sessionTabs" v-show="..." ... @open-file="onTerminalOpenFile" />
  </div>
  <EditorSplitPane v-if="hostInSplit" @collapse="files.splitOpen = false" />
</div>
```

- `<CodeView :visible="activeSubTab === 'code'" :editor-in-split="hostInSplit" />`。
- `onTerminalOpenFile`：`await files.setSession(p.sessionId, p.workdir)` → `await files.openInSplit(p.relPath)`；**删除 `setSubTab('code')`**。原有的 sessionId 一致性守卫与 try/catch toast 保留。
- 样式：`.sub-pane.has-split { flex-direction: row }`；新增 `.terminal-side { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative }`（`min-width: 0` 必需，否则 xterm 不会收缩）。

### 新增 `styles/code.css` + `main.ts`

- `.code-workspace-theme { ... }`：从 `CodeView.vue` 迁出那批 `--term-*` 重映射（逐行照搬，含 `--status-ok` / `--text-inverse` 那两条的注释说明）。
- `main.ts` 加 `import './styles/code.css'`。

## 状态与记忆

| 状态 | 归属 | 理由 |
|---|---|---|
| 右栏是否展开 | `stores/files.ts` 的 `splitOpen`，进 `SessionWorkspace` 快照 | 要与「这个会话打开了哪些文件」一起恢复 |
| 右栏宽度 | `localStorage` `lynel:editor-split-width`，默认 480，钳制 [320, 动态上限] | 手感全局一致，与 `lynel:code-tree-width` 同一套做法 |
| 当前文件 / tab 组 / 草稿 / diff | 沿用 `stores/files.ts` 现有现场（不动） | 右栏与文件子页共用，跨子页连贯 |

宽度动态上限：`Math.max(320, 容器宽 - 400 - 4)`。容器宽 < 724px 时上限退化为 320（终端拿不到 400 保证），这是窗口极小下的固有取舍，不额外处理。

## 边界与错误处理

- **`splitOpen` 为真但 `activeRelPath` 为 null**（右栏展开后关掉了所有 tab）：右栏显示 `CodeEditor` 既有空态「从左侧文件树选择文件」，不自动收起（自动收起会让「我关个 tab 分屏突然没了」显得突兀）。
- **二进制 / 超大文件**：沿用 `CodeEditor` 既有占位文案（「二进制文件，无法编辑」/「文件过大（只读，已截断显示）」）。
- **文件被删除 / 重命名**：`deleteEntry` / `renameEntry` 已处理 `openFiles` 与 `activeRelPath`，右栏自然跟随（`activeRelPath` 变 null → 空态）。
- **打开失败**：沿用 `onTerminalOpenFile` 现有 `pushToast({ level: 'error', source: 'file' })`。
- **外部变更**：沿用 `initWatcher` 的冲突处理（未脏则 reload，脏则标 `externalChanged` 由 `code-editor` 的 conflict-bar 提示）。
- **容器极窄**：右栏上限退化为 320，不做「自动收起」之类的隐式行为。

## 非目标

- 不改 `BottomPanel`（Git / 项目终端）、`FileTree`、`GitPanel` 的内部实现。
- 不取消「文件」子页，不做「文件树搬进右栏」。
- Trace 子页不分屏。
- 不做上下分屏、多窗格、tab 拖拽跨区域移动。
- 不改 `terminal/FileLinkProvider.ts` 的路径识别，也不改主进程 `OpenTerminalPath` 的 kind 判定。
- 不做「双击编辑器全屏」之类的额外模式。

## 顺带修基线（渲染层测试已红）

`npm run test:main` 只跑 `tests/main`，渲染层测试（`cd src/renderer && npx vitest run`）当前 **8 例失败**，属于 mock 漂移，与本次改动无关但会妨碍验证：

1. **`components/code/CodeView.test.ts`（6 例全挂）**：`vi.mock('../../composables/useElectron')` 缺 `GitChanged`，而 `stores/git.ts:314` 在 setup 里调用它 → 整个组件挂载失败。修法：往 mock 里补 `GitChanged: vi.fn(() => vi.fn())`。
2. **`components/XtermTerminal.test.ts`（2 例失败）**：`@xterm/xterm` 的 `Terminal` mock 缺 `registerLinkProvider`（`FileLinkProvider` 后来才加），抛 `TypeError`。修法：补 `registerLinkProvider: vi.fn()`。

本方案的测试依赖 `CodeView.test.ts` 能跑起来，所以这两处基线修复放进第一个 commit。

> 附注：`CLAUDE.md` 说渲染层 `test` 脚本是占位符，实际已是 `vitest run`（配 `vitest.config.ts` + jsdom + `@vue/test-utils`），可正常运行 —— 该行描述已过时。

## 测试

- **`composables/useResizablePanel.test.ts`（新增）**：上下限钳制；`handle: 'left'` 方向取反；`max` 传函数时动态求值；`mouseup` 写 localStorage；挂载时读 localStorage；非法 / 越界值回退 `defaultWidth`；卸载时清理 `mousemove`/`mouseup` 监听与 `body.style.userSelect`。
- **`components/code/CodeView.test.ts`**：现有 6 例（修基线后）保持绿 —— 断言不用改（`.editor-panel` 改由 `FileEditorPanel` 渲染、`.tabs-stub` / `.editor-stub` 仍是其后代，`FileTabs` / `CodeEditor` 的 mock 保持原样即可）；新增「`editorInSplit` 为 true 时不渲染 `.editor-panel`」。
- **`components/code/EditorSplitPane.test.ts`（新增）**：渲染 `FileEditorPanel`；头部展示 `activeRelPath`；`×` emit `collapse`；拖拽时按动态上限钳制（模拟容器宽，验证不把左侧压到 400px 以下）。
- **`stores/files.test.ts`（若不存在则新增）**：`openInSplit` 置 `splitOpen = true` 且激活目标文件；`setSession` 切走再切回恢复 `splitOpen`；恢复时 `openFiles` 为空则 `splitOpen` 为 `false`。
- **手动验证**：`npm run dev` → 点终端里的文件路径确认右栏展开且终端仍在跑；拖宽手柄；`×` 收起；切「文件」子页确认 tab 组一致、再切回终端确认撤销栈丢失但内容在；切会话确认展开态按会话记忆；折叠左栏 / 缩窗口确认右栏宽度被重新钳制。
- **门禁**：`npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿；`cd src/renderer && npx vitest run` 全绿（含上述基线修复）。
