# 首页重设计（Homepage Redesign）设计文档

日期：2026-08-11

## 背景

当前主页采用三段式布局（会话列表 | GlobalTabs+内容 | Trace），首页（`WelcomeTab.vue`）是一个简单的欢迎卡片：艺术字 + 「Open Folder…」 + 「Recent Sessions」。用户希望：

1. 会话列表上方增加「首页」入口按钮。
2. 把「打开 / 搜索」按钮整理到会话列表上方的工具条。
3. 顶部 tab 栏不再显示「首页」tab，首页成为隐藏的默认视图。
4. 重新设计首页内容：项目介绍 + 快速开会话框 + 历史会话。

## 需求确认（与用户逐项确认）

- **工作目录**：快速开会话框中目录可选，未选时使用默认目录（主进程兜底 `os.homedir()`）。
- **首页 tab**：去掉顶部 tab 栏的「首页」tab，首页只通过会话列表上方按钮进入。
- **历史会话**：约 10 条 + 搜索框 + 数量角标。
- **项目介绍**：一句话 slogan + 三个功能标签。
- **布局方案**：居中卡片式（`min(680px, 100%)`），自上而下：艺术字/介绍 → 快速开会话框 → 历史会话。

## 设计

### 1. 左侧栏工具条（会话列表上方）

`HomeView.vue` 的 `.left-top` 增加「首页」按钮，顺序：品牌字 + `[首页][打开][搜索][折叠]`。

- 首页按钮：`Icon name="house"`，点击 → `tabsStore.openWelcome()`。
- 打开按钮（`folder-open`）与搜索按钮（`search`）保持在工具条内，作为会话列表上方的快捷操作。
- 折叠态（`collapsed`）行为与现有按钮一致。

### 2. 顶部 tab 栏

`GlobalTabs.vue` 渲染时过滤 `type === 'welcome'` 的 tab，只显示 session/settings/guide。

- `tabs` store 逻辑保持不变：welcome 仍作为隐藏的首页状态。
- 关闭最后一个 tab 时 `openWelcome()` 兜底逻辑不变（此时无 tab 显示，内容区展示首页）。
- 首页激活时 GlobalTabs 无高亮 tab，属预期行为。

### 3. 首页内容（改造 `WelcomeTab.vue`）

居中卡片 `width: min(680px, 100%)`，三段结构：

**顶部（品牌区）**
- 艺术字 `Lynel Desktop`（复用现有 brand-lynel/brand-desktop 样式）。
- slogan：*集成 Claude / Codex / OpenCode 的多 Agent 桌面终端，请求与成本全程可视化，权限审批经企业微信与手机远程完成。*
- 三个功能标签（pill）：多 Agent 终端 · 请求可视化 · 远程审批。
- 右上角「使用指南」按钮（保留现有 `guide` 事件）。

**中部（快速开会话框，新建 `QuickLaunch.vue`）**

布局：
- 左上角：agent 下拉（复用 `AgentSelect`，`v-model` 为 `AgentKind`）。
- 主体：prompt 输入框（textarea，Enter 发送 / Shift+Enter 换行）。
- 左下角：目录选择（`folder` 图标 + 当前路径显示；点击弹 `PickDirectory`；未选显示"默认目录"）+ bot 下拉（复用 `useBotsStore().bots`，含「不绑定」选项，复用 `isBotAvailable` / `getBotBoundSessionName` 逻辑）。
- 右下角：发送按钮（`paper-plane`，prompt 为空时禁用；创建中显示 loading）。

Props / Emits：
- `props: { loading?: boolean }`
- `emits: create(workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind)`

内部状态：`workdir`、`prompt`、`agent`、`selectedBot`。

**下部（历史会话）**
- 标题 + 数量角标（复用现有 count 样式）。
- 搜索框（复用 `useRecentSessionSearch`）。
- `RecentSessionList`，`limit = 10`，`@select` 复用现有 `open-recent` 流程。

### 4. 数据流

快速框发送 → `HomeView.onCreate(workdir || '', prompt, [], botId, agent)` → `sessions.create` → `CreateSession`（IPC `app:createSession`）→ 主进程 `createSessionInternal` 启动代理 + PTY → 成功后在 `tabs` 打开对应 session tab。

**主进程小改动**：`app:createSession` handler（`app.ts:1517`）入口对空 `workDir` 兜底：`workDir = workDir || os.homedir()`。

### 5. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/renderer/src/views/HomeView.vue` | `.left-top` 加「首页」按钮；向 GlobalTabs 传过滤后的 tabs |
| `src/renderer/src/components/GlobalTabs.vue` | 过滤 `type === 'welcome'` 的 tab |
| `src/renderer/src/components/WelcomeTab.vue` | 重写为首页结构（品牌区 + 快速框 + 历史会话） |
| `src/renderer/src/components/QuickLaunch.vue` | 新建：快速开会话框 |
| `src/main/app.ts` | `app:createSession` 入口 workdir 兜底 `os.homedir()` |

复用：`AgentSelect`、`RecentSessionList`、`useRecentSessionSearch`、`useBotsStore`、`useRecentStore`、`PickDirectory`。

## 验证

- `npm run test:main`（主进程改动后必须全绿）。
- `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 手动验证：首页按钮切换、快速框创建会话（含未选目录走默认目录）、bot 绑定、历史会话打开。
