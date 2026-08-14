# 终端 / Trace 双 tab 与右侧 Workspace 占位设计

日期：2026-08-14
状态：已确认（通过 mockup 预览逐步敲定）

## 背景与目标

当前三段式布局：左会话列表 | 中（GlobalTabs + `.content`，会话视图为终端）| 右 TraceSidebar（220px 请求列表）。用户希望在中间终端上方新增一行"终端 / Trace"双 tab，把右侧 Trace 内容（请求列表 + 详情）挪到中间，右侧改为 Workspace 面板（暂占位）。目的：中间区域变宽，Trace 与终端在会话视图内平级切换，右侧预留 Workspace 扩展位。

目标：

- 会话视图内新增"终端 / Trace"双 tab，点击切换内容。
- Trace 内容从右侧移入中间，点请求后**就地分栏**展示详情（不再浮层遮挡终端）。
- 右侧移除 TraceSidebar，改为 Workspace 占位面板（220px、可折叠）。

## 现状（已核对代码）

- `HomeView.vue` 布局：`.layout` > `.left`(SessionList) + `.center`(`.center-top`[GlobalTabs + 折叠时展开按钮] + `.content`) + `<TraceSidebar>`。
- `.content` 的 session pane：`SessionTabContent`（内含 `XtermTerminal`）+ `TraceOverlay`（Teleport 到 `.center`，点请求后浮出详情）。
- `TraceSidebar.vue`：头部折叠按钮、`trace-toolbar`（请求计数/金额/刷新）、`thumb-list`（滚动分页、自动滚底）、loading/error/empty 状态。数据源 `trace` store。
- `TraceOverlay.vue`：遮罩 + 右侧面板，复用 `RequestDetailPane`（7 个 tab：概览/消息/工具/响应/系统/头部/流程）。
- HomeView 状态：`traceCollapsed`（TraceSidebar 折叠）、`showTraceOverlay`（详情浮层显隐）、`onTraceSelect`（toggle 浮层 + `trace.select`）。
- `trace` store：`load/loadMore/fetchNew`、`filteredRequests`、`selectedSeq`、`select`、`detail`、`diffResult`、`loading`、`loadError`、`hasMore`。

## 目标布局

```
.layout
├── .left                    # 会话列表（不变）
├── .center
│   ├── .center-top          # GlobalTabs；折叠时右侧显示展开 Workspace 按钮
│   └── .content
│       ├── welcome / settings / guide pane（不变）
│       └── session pane
│           ├── .sub-tabs    # ★新增：终端 | Trace 双 tab（34px，仅会话视图显示）
│           └── #terminal-pane / #trace-pane（按 tab 切换显示）
└── .workspace               # ★新增：右侧占位面板（220px，可折叠）
```

说明：双 tab 栏挂在 session pane 内顶部，**只**在会话视图显示；welcome/settings/guide 不出现。切换会话（GlobalTabs）时保持当前 sub-tab 选择（HomeView 单一 ref）。

## 设计细节

### 1. 双 tab 栏（sub-tabs）

- 新增小组件 `SubTabs`（或直接内联在 HomeView session pane）。高度 34px，底部 1px `--border`，背景 `--bg-panel`，样式对齐 GlobalTabs 的 `.tab`（激活态 `color-mix(accent 20%)` 底 + accent 文字 + 600 字重）。
- 两个按钮：`终端`、`Trace`。
  - 终端按钮带绿色状态点（`--status-success`，7px 圆点，常显），用户已确认保留。
  - 选中态：accent 浅蓝底 + accent 字。
- 状态：`activeSubTab: 'terminal' | 'trace'`，HomeView `ref`，默认 `'terminal'`。切换会话不重置。
- 点击切换内容：`v-show` 控制终端 pane 与 trace pane，避免销毁 xterm（保留终端缓冲与状态）。

### 2. 终端 pane

- 现有 `SessionTabContent`（XtermTerminal + 加载遮罩 + Buddy）原样作为终端 pane 内容。
- 切换回终端时容器由 `display:none` 恢复，`ResizeObserver` 会触发 `fitAddon.fit()`（现有逻辑），需在验收时确认 xterm 尺寸正确。

### 3. Trace pane（新组件 `TracePane.vue`）

- 替代 `TraceSidebar` 的内容承载，并新增详情分栏。
- 结构：
  - `trace-toolbar`（36px）：请求(`N`) / `$cost` / 刷新按钮（沿用 TraceSidebar 样式）。
  - 主体 `trace-split`（flex）：
    - 左列表：宽 46%（`max-width: 320px`），右侧 `--border` 分隔。复用 TraceSidebar 的 `thumb-row`（状态点、#seq、model、时间、↓↑tokens、工具数、延迟）与滚动分页、自动滚底逻辑。
    - 右详情：`flex:1`，复用 `RequestDetailPane`（含 7 tab、diff、loading 骨架、空态"选中左侧请求查看详情"）。
- 数据流：
  - 列表来自 `trace.filteredRequests`；`trace.load/loadMore/reload` 与滚动加载逻辑整体迁移自 TraceSidebar。
  - 点某行 → `trace.select(seq)` + 行高亮 `selected`；详情从 `<seq>.json` 按需加载（trace store 现有逻辑）。
  - **移除** `TraceOverlay` 浮层与 `showTraceOverlay` 逻辑；详情就地显示，不遮挡终端。
- 空态 / error / loading 沿用 TraceSidebar 现有呈现。

### 4. Workspace 占位面板（新组件 `WorkspacePanel.vue`）

- 挂在 `.layout` 右侧（替代 `<TraceSidebar>`），220px、`flex-shrink:0`、`--bg-panel`、左侧 `--border`。
- 头部（40px）：标题"Workspace"（12px/600）+ 折叠按钮（`panel-right-close` 图标，28px 方块）。
- 内容：灰色占位区（"Workspace 面板待实现"）。
- 折叠：
  - 状态 `workspaceCollapsed`（HomeView `ref`，替代原 `traceCollapsed`）。
  - 折叠：宽度 `0`、`border-left: none`（沿 TraceSidebar collapsed 样式）。
  - 展开按钮：`.center-top` 右侧出现 `panel-right-open` 按钮（复用原"展开 Trace"按钮位置）。
- 不实现任何实际功能（YAGNI），仅占位 + 折叠交互。

### 5. 组件增删

- 新增：`TracePane.vue`、`WorkspacePanel.vue`（sub-tabs 可内联或独立组件）。
- 删除：`TraceSidebar.vue`、`TraceOverlay.vue`（连同 HomeView 中引用与 `showTraceOverlay`/`onTraceSelect` 浮层逻辑、`TraceSidebar`/`TraceOverlay` import）。
- 保留：`RequestDetailPane`、`trace` store、`SessionTabContent` 原样复用。

## 错误处理

- TracePane 数据加载沿用 TraceSidebar：`loadError` 显示 + 重试按钮；空列表"暂无 API 请求"；loading 骨架屏。
- Workspace 无数据操作，无错误态。
- 终端 pane 切换不产生新错误路径。

## 测试

- `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 主进程无改动，`npm run test:main` 应保持通过（跑一遍确认）。
- 手动验收（全栈 `npm run dev`）：
  1. 会话视图顶部出现 终端|Trace 双 tab，默认终端。
  2. 点 Trace 显示分栏；点请求右侧详情就地更新；切换回终端缓冲保留。
  3. welcome/settings 视图无 sub-tabs。
  4. Workspace 折叠/展开正常，展开按钮出现在 center-top。
  5. 切换会话后 sub-tab 保持上次选择。

## 非目标（YAGNI）

- Workspace 不做任何功能，仅占位。
- 不重构 `trace` store、`RequestDetailPane`。
- 不持久化 sub-tab 状态（仅内存）。

## 风险与对策

- **xterm 切换尺寸**：`v-show` 隐藏后再显示，依赖 ResizeObserver 触发 fit。验收重点检查；若异常则切换时主动调用 fit。
- **列表状态保留**：Trace pane 用 `v-show` 保持列表滚动位置与选中，切换终端再回来不丢失。
- **sub-tab 作用域**：明确挂在 session pane 内，避免污染其他视图。
