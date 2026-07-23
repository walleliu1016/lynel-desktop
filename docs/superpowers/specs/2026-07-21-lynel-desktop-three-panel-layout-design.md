# Lynel Desktop 三段式布局设计

## 背景

当前布局为两栏：左侧会话列表 + 右侧 Tab（终端 / Trace / 设置等），Trace 通过右键菜单 → "打开 Trace" 以独立标签页打开。需要改为三段式，将 Trace 整合到会话体验中，每个 Session 自带 Trace 面板。

## 目标

1. 移除 Trace 独立标签页模式
2. 左中右三栏布局：会话列表 | 终端 | Trace 侧栏
3. 右侧 Trace 缩略图常驻，点击展开完整详情覆盖层（overlay）
4. 覆盖层从右滑出，覆盖终端约 35%-45%，Escape / 点击外部关闭
5. 重启后 Trace 数据从磁盘自动恢复

## 布局结构

```
HomeView.vue
├── TitleBar                    ← 现有，不变
└── .layout (display: flex)
    ├── SessionList            ← 左栏 280px，可收起 44px（现有）
    ├── .center (flex: 1)      ← 新容器
    │   ├── GlobalTabs         ← 现有，移除 trace 类型
    │   └── .content (flex: 1, position: relative)
    │       ├── SessionTabContent
    │       │   └── XtermTerminal + PermissionToast
    │       └── TraceOverlay   ← 新组件，absolute 定位覆盖
    │           ├── 标题栏（#seq + 模型 + close ×）
    │           └── RequestDetailPane（复用现有全部 tab）
    └── TraceSidebar            ← 新组件，固定 ~200px
        ├── StatsBar（请求数 · 总花费 · reload）
        ├── TraceThumbnailList
        │   └── × N: 状态点 · #seq · 模型缩写 / 耗时 · 花费
        └── EmptyState / ErrorState / LoadingSkeleton
```

## 组件职责

### TraceSidebar（新）
- 文件：`src/renderer/src/components/trace/TraceSidebar.vue`
- 展示当前 session 的 API 请求缩略图列表
- 缩略图行：双行紧凑设计
  - 行1：`[状态点]  #seq  模型缩写`
  - 行2：`耗时 · 花费`
  - 状态点：绿(2xx)、黄(4xx)、红(5xx)、灰(pending/transport error)
- 顶部 StatsBar：请求总数、总花费、reload 按钮
- 点击行 → 打开 TraceOverlay + 调用 `trace.select(seq)`
- 再次点击同一行 → toggle 关闭
- 选中高亮：`background` + `border-left: 2px solid var(--accent)`
- 空状态显示 "暂无 API 请求"
- 加载状态：骨架屏动画（3 行）
- 错误状态：红色提示条 "加载失败，点击重试"
- 固定宽度 200px，`flex-shrink: 0`

### TraceOverlay（新）
- 文件：`src/renderer/src/components/trace/TraceOverlay.vue`
- 整体容器 `position: absolute; inset: 0`，含两个层：
  - **遮罩层**：覆盖整个 .content 区域，`rgba(0,0,0,0.25)` 半透明，`z-index: 1`，点击遮罩关闭 overlay
  - **面板层**：右侧滑入，`position: absolute; top:0; right:0; bottom:0; z-index: 2`
- 面板宽度：`clamp(360px, 35%, 45%)` — 基于父容器百分比，自动随窗口缩放
- 动画：
  - 面板 `transform: translateX(100%) → translateX(0)` + opacity，200ms ease
  - 遮罩 `opacity: 0 → 1`，150ms ease
- 关闭方式：
  - 点击遮罩层（面板外部区域）
  - Escape 键
  - 面板内的 × 关闭按钮
- 面板内部结构：
  - 顶部固定标题栏：`#3 · claude-sonnet-4-20250514 [×]`
  - 内容区域 `flex: 1; overflow-y: auto`，复用 `RequestDetailPane`（含 Overview / Messages / Tools / Response / System / Headers / Flow 所有 tab）
- 切换 session → 自动关闭覆盖层

### HomeView.vue 修改
- 移除 `@open-trace` 事件及相关处理
- 移除 `content-pane` 中 `type === 'trace'` 的渲染分支
- 移除 `traceTabs` 相关 computed
- 布局改为三栏：`.left` + `.center` + `.right`
- `.center` 新容器：`flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden`
- 无活跃 session 时右侧栏隐藏，布局回退两栏

### SessionItem.vue 修改
- 移除右键菜单中的 "打开 Trace" 选项

### tabsStore 修改
- 移除 `openTrace` 方法
- 移除 `generateTabId` 中的 `trace` 分支
- `TabType` 移除 `'trace'` 类型

### GlobalTabs.vue 修改
- 移除 trace 类型的 tab icon 处理（不需要了）

## 数据流

### 选中 session
```
SessionList.onSelect(sID)
  → tabsStore.openSession(sID, workdir)   // 激活终端 tab
  → TraceSidebar 挂载
    → trace.setSession(workdir, sID)
    → trace.load()                         // 从 jsonl 读取数据
    → sidebar 展示 filteredRequests
    → 覆盖层关闭
```

### 点击缩略图
```
TraceSidebar.onClick(seq)
  → toggleOverlay(seq)
    → if 已选中同 seq 且 overlay 打开 → 关闭
    → else → showOverlay = true + trace.select(seq)
      → RequestDetailPane 展示详情
```

### 重启后
```
应用启动 → SessionList 加载元数据
  → 用户选中 session
    → trace.setSession + trace.load()
    → 从 .jsonl 重新读取所有 API 请求
    → sidebar 完整展示
    → overlay 状态不恢复（从缩略图重新浏览）
```

## 边界状态

| 场景 | 行为 |
|------|------|
| 无活跃 session | 右侧栏隐藏，两栏布局 |
| Session 无 API 调用 | sidebar 显示 "暂无 API 请求" |
| 加载中 | 骨架屏 |
| 加载失败 | 红色提示条 + reload 按钮 |
| 覆盖层打开时切 session | 自动关闭覆盖层 |
| 覆盖层关闭后重开 | 保留上次选中高亮（切换 session 才清） |
| 窗口缩放 | 覆盖层宽度 `clamp()` 自动适应 |
| 右侧栏溢出 | 缩略图列表 `overflow-y: auto` |
| 数据为空 | 不影响终端渲染（Trace 是补充数据） |

## 不变约束

- API 网关数据仍写入 `~/.lynel-desktop/projects/<project>/<sid>-calls.jsonl`
- trace store 的 `load/select/export` 等逻辑不变
- 网关数据失败不阻塞终端运行
- 所有主进程 IPC 不修改
- 样式遵循现有 CSS 变量体系（`var(--accent)`、`var(--text-*)` 等）
- 图标统一用 `@lucide/vue` 通过 `Icon.vue` 引用

## 实施顺序

1. **新增 TraceSidebar.vue** — 缩略图列表、StatsBar、loading/empty/error 状态
2. **新增 TraceOverlay.vue** — 覆盖层容器、动画、关闭逻辑，复用 RequestDetailPane
3. **修改 HomeView.vue** — 三栏布局、引入新组件、移除旧 Trace tab 逻辑
4. **清理** — SessionItem（移除右键 Trace）、tabsStore（移除 openTrace）、GlobalTabs（移除 trace type）
5. **验证** — 选中 session → 缩略图展示 → 点击打开覆盖层 → 缩放窗口 → 切换 session → 重启
