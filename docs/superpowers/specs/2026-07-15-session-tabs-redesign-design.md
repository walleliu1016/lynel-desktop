# 全局 Tab 系统设计

## 背景与问题

当前 `HomeView` 右侧终端区采用「独立 ToolBar + 细线 Tab 栏」两层结构：

1. **ToolBar 区域冗余**：显示当前 session 标题、项目、ID、状态，信息重复且占用常驻空间，视觉上显得「不完整」。
2. **Tab 栏不像标签页**：当前 Tab 只是一条细线加文字，用户难以识别这是可切换/关闭的标签页。
3. **设置页独立跳转**：点击设置后整页跳转到 `/settings`，离开当前工作区，不符合用户期望的「所有功能都用 Tab」的模型。

## 设计目标

- 将整个应用改造为**全局 Tab 系统**：session、设置、未来新功能都作为顶部 Tab 打开。
- 去掉 `HomeView` 内独立的 session ToolBar，减少重复信息。
- 让 Tab 栏看起来像真正的浏览器/编辑器标签页。
- 保留左侧会话列表作为「session 历史/新建入口」。
- 多 session 时通过 Tab 切换和关闭；关闭 session Tab 即结束 session。

## 方案选型

采用 **方案 A（真 Tab 栏）+ active tab 顶部 accent 色条**，并将 Tab 系统从 HomeView 内部提升到全局层级。

## 全局 Tab 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ TitleBar (Lynel Desktop / 全局状态 / 用户 / 设置 / 窗口控制)          │
├─────────────────────────────────────────────────────────────────────┤
│ [🏠] [📁 session A ×] [⚙ 设置 ×] [📊 未来功能 ×] [+]                 │  ← 全局 Tab 栏
├──────────┬──────────────────────────────────────────────────────────┤
│          │                                                          │
│  左侧边栏  │                    Tab 内容区域                          │
│ （根据当前  │                                                          │
│  Tab 类型   │                                                          │
│  动态变化） │                                                          │
│          │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

### Tab 类型

| Tab 类型 | 标识 | 左侧边栏 | 内容区域 |
|---------|------|---------|---------|
| `welcome` | 🏠 / 首页 | 欢迎页操作（打开目录、最近会话） | WelcomeView |
| `session` | terminal 图标 + 标题 | 会话列表 | 终端 + 可能的历史/工具面板 |
| `settings` | ⚙ | 设置分类导航（可后续扩展） | SettingsView |
| `future-*` | 功能图标 | 对应功能的导航/列表 | 对应功能页面 |

### 路由与 Tab 的关系

- Vue Router 保留，但主要作为**初始入口**和**URL 回退**。
- 应用启动后默认打开 `welcome` Tab。
- 用户交互（点击左侧列表、点击设置按钮、打开新功能）优先通过 Tab 系统完成，不再整页跳转。
- 当关闭最后一个 Tab 时，保留一个默认 `welcome` Tab，避免完全空白。

## 视觉规格

### Tab 栏

- 位于 TitleBar 正下方，贯穿整个窗口宽度。
- **Tab 形状**：顶部左右圆角（`border-radius: 8px 8px 0 0`），底部与内容区对齐。
- **Active Tab**：
  - 背景与内容区一致（`--bg-primary` 或对应内容区背景）。
  - 边框左右上三色（`--border-strong`），底部无边框，与内容区自然相连。
  - **顶部 2px accent 色条**（`--accent`）。
- **Inactive Tab**：
  - 背景透明或 `--bg-panel`。
  - hover 时背景变为 `--session-item-hover-bg`。
- **Tab 内容**：类型图标 + 标题 + 关闭按钮。
- **关闭按钮**：默认隐藏，hover tab 时显示；hover × 时变红。
- **+ 按钮 / 首页按钮**：Tab 栏最左侧或最右侧提供「首页」和「新建」入口。
- **Tab 过多**：水平滚动，不换行。

### 左侧边栏

- 根据当前激活 Tab 类型动态渲染：
  - `welcome` Tab：显示欢迎页所需的目录选择、最近会话等。
  - `session` Tab：显示会话列表（现有 `SessionList`）。
  - `settings` Tab：显示设置分类导航（若未来需要）。
- 当前先实现 `welcome` 和 `session` 两种边栏，其他类型留扩展接口。

### 详情展示

- Session Tab 上只显示标题和状态图标。
- hover 到 Session Tab 上时，弹出 Tooltip 展示完整信息：
  - 会话标题
  - 项目（project/workdir）
  - Session ID
  - 创建来源
  - 当前状态

## 交互行为

| 操作 | 行为 |
|------|------|
| 启动应用 | 默认打开 `welcome` Tab |
| 点击左侧会话列表中的 session | 若未打开则新建 `session` Tab 并激活；若已打开则切换至该 Tab |
| 点击设置按钮 | 若未打开则新建 `settings` Tab 并激活；若已打开则切换 |
| 点击 Tab | 切换当前激活 Tab，同时切换左侧边栏 |
| 点击 Tab 上的 × | 关闭该 Tab；session Tab 会调用 `CloseSession(id)` 结束 session |
| 鼠标中键点击 Tab | 同点击 × 关闭 |
| 点击 + / 首页按钮 | 打开 `welcome` Tab 或新建 session |
| 关闭运行中 session | 弹确认：「该会话仍在运行中，关闭将终止 Claude，是否继续？」 |
| 关闭最后一个 Tab | 自动保留 `welcome` Tab |

## 状态管理

新增全局 `tabs` store（`src/renderer/src/stores/tabs.ts`）：

```ts
interface Tab {
  id: string           // 全局唯一，如 'session-da07c089', 'settings', 'welcome'
  type: 'welcome' | 'session' | 'settings' | string
  title: string
  payload?: any        // session 存 sessionId/workdir，settings 可存分类等
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
}
```

提供方法：
- `openWelcome()`
- `openSession(sessionId, workdir)`
- `openSettings()`
- `closeTab(id)`
- `activateTab(id)`

Session 相关状态仍保留在 `sessions` store；`tabs` store 只负责 Tab 的打开/关闭/切换逻辑。

## 组件改动

1. **`src/renderer/src/stores/tabs.ts`** — 新增全局 Tab 状态管理。
2. **`src/renderer/src/components/GlobalTabs.vue`** — 新增全局 Tab 栏组件（替代原 `SessionTabs.vue` 的局部作用）。
3. **`src/renderer/src/components/SessionTabs.vue`** — 可复用为 `GlobalTabs` 内部的 session 渲染，或合并进 `GlobalTabs`。
4. **`src/renderer/src/views/HomeView.vue`** — 改造为全局 Tab 宿主：
   - 移除 `ToolBar`。
   - 顶部渲染 `GlobalTabs`。
   - 主体按当前 Tab 类型渲染不同内容。
   - 左侧边栏按当前 Tab 类型切换。
5. **`src/renderer/src/App.vue` / `src/renderer/src/router/index.ts`** — 调整初始路由，默认进入 `HomeView` 并打开 `welcome` Tab。
6. **`src/renderer/src/components/Icon.vue`** — 已新增图标，保持使用。
7. **`src/renderer/src/components/TitleBar.vue`** — 设置按钮改为 `openSettings()` 而不是 `router.push('/settings')`。

## 边界情况

- **无 Tab**：始终保留 `welcome` Tab，不会出现完全空白。
- **同名 session**：标题后加 `#id前4位` 区分。
- **session 自然结束**：保留 Tab（终端显示已退出），用户手动关闭。
- **运行中关闭 session**：必须二次确认。
- **设置 Tab 关闭**：直接关闭，无需确认。

## 验收标准

- [ ] 顶部全局 Tab 栏可见，包含 welcome、session、settings 等 Tab。
- [ ] Tab 看起来像真正的标签页（圆角、active 顶色条、与内容区相连）。
- [ ] 点击设置不再整页跳转，而是打开 settings Tab。
- [ ] Session Tab hover 显示详情 Tooltip。
- [ ] 点击/中键关闭 session Tab 可结束 session。
- [ ] 类型检查与主进程测试全绿。
