# 会话右栏文件工作区设计（文件折叠到右侧）

- 日期：2026-09-23
- 状态：已获批（草图逐轮确认）
- 可交互草图：`docs/superpowers/specs/2026-09-23-right-panel-mockup.html`（v7，最终形态）

## 1. 背景与目标

现状：会话内容区顶部有三个互斥子页（终端 / Trace / 文件），切「文件」整块替换中间内容；终端子页内另有 `EditorSplitPane` 右分屏（点终端路径弹出，仅纯编辑器）。

目标：

1. 「文件」不再是子页 tab，改为**会话右侧常驻折叠栏**，承载完整文件工作区（文件树 + 编辑器 + 底部 Git/终端面板）。
2. 对半切分**从标签行开始**：右栏顶部行与 终端/Trace 标签同行同高，分割线贯通整高。
3. 终端路径点击弹出的旧分屏与新右栏**统一为一个**（同开合、同现场）。

## 2. 需求决策（逐条确认过）

| 议题 | 决策 |
|---|---|
| 「文件」子页 tab | 移除，只留 终端 / Trace 两个子页 |
| 右栏内容 | 原「文件」子页整体搬入：文件树 + 编辑器 + 底部 Git/终端面板 |
| 展开宽度 | 默认容器 **50%**，可拖（320px ~ 容器−400px） |
| 旧终端分屏 `EditorSplitPane` | 删除，统一为右栏（点终端路径 → 展开右栏并打开该文件） |
| 与左子页关系 | **独立常驻**：切 Trace 右栏保持展开，状态按会话记忆 |
| 默认状态 | **默认收起**；展开态按会话记忆（沿用「有打开文件才恢复」守卫） |
| 展开入口 | 收起态：左标签行最右一个**面板图标按钮**（纯折叠/展开切换，无文字、无文件夹元素）；另有终端路径点击 |
| 右栏顶部行 | 最左「📁 文件」标识 tab（代表文件树/右栏身份）+ 打开的文件 tabs + 右端「全屏/还原」「收起」按钮 |
| 全屏 | 点「全屏」右栏铺满整宽、左半隐藏，按钮变「还原」，点击恢复全屏前宽度 |
| 文件树 | **固定在右栏左侧，不可拖宽** |
| 底部 Git/终端面板 | **默认折叠**（只露 tab 行），点 tab 或展开按钮打开 |

## 3. 布局结构

```
.session-content（横向 flex，贯通整高）
├── .left-half（flex:1, min-width:0，纵向）
│   ├── .sub-tabs（38px）：[终端][Trace] …… [面板图标按钮（仅收起态显示）]
│   ├── 终端 pane（v-show）
│   └── Trace pane（v-show）
├── .split-handle（仅展开态，贯通整高，可拖）
└── 右栏 RightWorkspacePane（宽度=记忆值，默认 50%，CSS 隐藏保持挂载）
    ├── 顶部行（38px，与 .sub-tabs 同行同高）
    │   [📁 文件 标识tab] [file tabs…] …… [⛶全屏/还原] [收起图标]
    ├── 主体（flex:1）
    │   ├── 文件树（固定 300px = 现有默认宽，保留「折叠树」按钮，删除拖拽 handle）
    │   └── 编辑器区（CodeEditor / CodeDiffView，无 tab 条）
    └── 底部面板（默认折叠 30px 一行；展开可拖高，拖高保留）
```

## 4. 组件与代码变更

### 4.1 新增 / 改造

- **右栏组件**（新，如 `components/code/RightWorkspacePane.vue`）：
  - 顶部行：文件标识 tab + `FileTabs` + 全屏/收起按钮。
  - 主体复用 `CodeView`（见下）。
  - 宽度：沿用 `useResizablePanel`，**新 storage key**（如 `lynel:right-panel-width`）；无存量值时首次展开取容器宽 50%；`dynamicMax = 容器宽 − 400`（左区最小宽）。
  - 收起用 CSS 隐藏（**不 v-if 卸载**）：底部项目终端 xterm / shell PTY 缓冲必须保持挂载。
  - 全屏态：组件内 `ref`，不持久化；切会话/收起时重置为普通展开态，展开宽度从 storage 恢复。
- **`FileTabs` 从 `FileEditorPanel` 提升**到右栏顶部行（跨文件树与编辑器上方，同草图）；`FileEditorPanel` 退化为纯编辑器容器（`CodeEditor | CodeDiffView` 互斥 v-show 逻辑不变）。
- **`CodeView`**：
  - 删除 `editorInSplit` prop 与 `<FileEditorPanel v-if="!editorInSplit" />` 条件——右栏成为唯一宿主，无条件渲染编辑器。
  - 文件树**去掉拖拽**：删除 `useResizablePanel('lynel:code-tree-width')` 与 `.resize-handle`，固定 300px（沿用现有 `defaultWidth`，保留树折叠/展开按钮与工具条）。
  - `visible` prop 改由 `splitOpen` 驱动（原 `activeSubTab === 'code'`），供 BottomPanel 决定终端启动时机。
- **`HomeView.vue`**：
  - `.session-content` 改为 §3 的左右结构；删除「文件」sub-tab 按钮。
  - `subTabBySession` / `activeSubTab` 类型收窄为 `'terminal' | 'trace'`（内存态，无需迁移）。
  - 删除 `hostInSplit`、`EditorSplitPane` 引用、`open-in-files` → `setSubTab('code')` 链路。
  - 左标签行最右新增面板图标展开按钮（仅收起态显示；`panel-right-open` 图标，新增前先查 `Icon.vue` 映射）。
  - `onTerminalOpenFile` → `files.openInSplit()`（已会置 `splitOpen=true`，目的地自然变为右栏）。
- **`BottomPanel`**：新增开合状态（默认折叠，只显示 tab 行），点 Git/终端 tab 自动展开；全局 localStorage（如 `lynel:bottom-panel-open`）；拖高行为保留。xterm 实例与 `v-show` 常驻约束不变。

### 4.2 删除

- `components/code/EditorSplitPane.vue` 及其测试（`HANDLE_WIDTH`/dynamicMax 相关期望随迁到右栏组件测试）。
- `stores/files.ts` 中语义不变但命名过时的字段可保留（`splitOpen` 名字不动，含义扩展为「右栏展开」）；`openInSplit` 行为不变。

### 4.3 状态与持久化

| 状态 | 范围 | 位置 |
|---|---|---|
| 右栏展开 `splitOpen` | 会话级（含「有打开文件才恢复」守卫） | `stores/files.ts` 既有 session state |
| 右栏宽度 | 全局 localStorage | 新 key `lynel:right-panel-width` |
| 全屏态 | 瞬态（组件内，切会话/收起重置） | 组件 ref |
| 底部面板开合 | 全局 localStorage | 新 key `lynel:bottom-panel-open` |
| 活跃子页 | 会话级 | `subTabBySession`（仅 terminal/trace） |
| 文件现场（tabs/草稿/激活文件） | 会话级 | `stores/files.ts` 既有逻辑，不变 |

## 5. 交互汇总

| 操作 | 行为 |
|---|---|
| 收起态点左标签行最右面板图标 | 展开右栏（首次 50%，之后记忆宽度） |
| 终端输出点 workdir 内文件路径 | 展开右栏（若未展开）+ 激活该文件（复用 `openInSplit`） |
| 右栏「收起」图标 | 收起右栏（CSS 隐藏，保持挂载） |
| 右栏「全屏」 | 右栏铺满、左半隐藏；按钮变「还原」，点击恢复全屏前宽度 |
| 切 终端 ↔ Trace | 右栏不动 |
| 点文件树文件 / 文件 tab | 激活文件（既有 `openFile`/`activateFile`，不变） |
| 点底部面板 Git/终端 tab | 面板若折叠则自动展开 |

## 6. 关键不变量（改前必读）

- **Monaco 单 model**：右栏成为唯一宿主后，全应用同时只能有一个 `FileEditorPanel` 实例由结构保证；**不得**再出现第二处 `FileEditorPanel` 挂载点。CLAUDE.md §11 中「两宿主 nextTick/dispose 时序」相关段落在实施后改写。
- **右栏收起不得 v-if 卸载**：BottomPanel 的 shell xterm 与 PTY 缓冲随挂载存活；隐藏只能用 CSS。
- **文件树不可拖**：仅 CodeView 树去拖拽；`GitPanel` 变更列表、`TasksPane` 的拖拽实现不受影响（`useResizablePanel` 本身保留）。
- 终端路径分流（`FileLinkProvider`）、草稿保存、diff 双 URI 规则、`code-workspace-theme` 挂载要求全部不变。

## 7. 测试与验收

- 渲染层：`cd src/renderer && npx vitest run` —— 迁移/删除 `EditorSplitPane` 相关测试；新增右栏宽度钳制（首展开 50%、min/max）、底部面板默认折叠、`subTabBySession` 类型收窄后的回归。
- 类型：`cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 主进程零改动：`npm run test:main` 回归全绿。
- 手测清单（对照草图 v7）：展开/收起/拖宽/全屏/还原；终端路径点击；切 Trace 右栏保持；收起再展开后 xterm 缓冲、Monaco 撤销栈之外的现场（文件 tabs、草稿）不丢；会话切换现场恢复守卫。

## 8. 不在本次范围

- 移动端 / 云端布局。
- 文件树虚拟滚动、多根工作区。
- GitPanel、TasksPane 拖拽实现的统一收编（已知技术债，另行处理）。
