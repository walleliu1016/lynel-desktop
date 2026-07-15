# VS Code 风格主页与会话列表改造设计

## 概述

将会话列表页面从"扫描所有 projects 目录显示全部会话"改为 VS Code 风格：用户打开过的项目才显示，支持历史选择和打开新目录，主页改为欢迎页 + 工作区双模式。

## 动机

- 当前扫描 `~/.lynel-desktop/projects` 目录显示所有项目所有会话，信息过载
- 用户实际只关心自己正在使用的项目
- 缺少"最近使用"概念，每次都要在一堆会话中翻找
- 三个状态 Tab（所有/运行中/结束）在会话数量增长后失去实用价值

## 页面结构

### 欢迎页（WelcomeView）— 新增

无项目打开时显示，路由 `/welcome`。

```
┌──────────────────────────────────────────┐
│              Lynel Desktop               │
│                 Start                    │
│                                          │
│  Start                                   │
│  ┌────────────────────────────────────┐  │
│  │ 📂 Open Folder...                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Recent Sessions                         │
│  ┌────────────────────────────────────┐  │
│  │ 🟢 修复登录样式问题                 │  │
│  │    ~/projects/my-app  a1b2 · 23m  │  │
│  ├────────────────────────────────────┤  │
│  │ ⚪ 重构 API 路由                    │  │
│  │    ~/projects/my-app  e5f6 · 2d   │  │
│  ├────────────────────────────────────┤  │
│  │ 🟠 部署配置排查                     │  │
│  │    ~/work/backend  i9j0 · 1h      │  │
│  ├────────────────────────────────────┤  │
│  │ ... (最多 5 条默认显示)            │  │
│  ├────────────────────────────────────┤  │
│  │        Show 8 more sessions...     │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**最近会话列表规则：**
- 数据来源：用户打开过的会话记录（`recent-sessions.json`），非扫描 projects 目录
- 排序：按最后打开时间倒序
- 默认显示 5 条，超过时显示 "Show N more sessions..." 按钮，点击展开全部并切换为 "Show less"
- 每条信息：状态圆点 + AI 标题（主行）/ 目录 + SessionID 前8位 + 运行时长（副行）
- 点击某条 → 路由到 `/home?project=<workdir>` 并恢复该会话

### 工作区（HomeView）— 改造

项目打开后显示，路由 `/home?project=<encoded-workdir>`。

```
┌──────────────┬───────────────────────────┐
│ 📁 my-app + ↕│  ToolBar                  │
│ [筛选...    ]│                           │
│──────────────│                           │
│ 🟢 修复登录  │     XtermTerminal         │
│   23m · 23   │                           │
│ 🟠 部署生产  │                           │
│   2h · 8     │                           │
│ ⚪ 代码审查  │                           │
│   1d · 45    │                           │
│              │                           │
│──────────────│                           │
│ 关闭自动移除 │                           │
└──────────────┴───────────────────────────┘
```

**侧边栏会话列表规则：**
- 去掉"所有/运行中/结束"三个 Tab
- 仅显示当前项目下已打开（opened）的会话
- 会话关闭后自动从列表移除
- 支持搜索筛选（在当前打开会话中筛选）
- 项目标题栏：项目名 + 新建按钮（+）+ 切换按钮（↕）

**会话条目（SessionItem）信息：**
- 行内显示：状态圆点 + AI 标题 + 状态文字标签 + 运行时长 + 消息数
- 状态圆点颜色：绿色（running）、橙色（awaiting_permission）、灰色（idle/done/ended）
- 运行时长格式：`23m` / `2h 10m` / `1d 3h` / `5d`；已结束的会话显示总运行时长
- 无 AI 标题时回退到 `first_prompt`

**Hover 详情卡片：**
- 完整 AI 标题
- 工作目录完整路径
- Session ID（完整 UUID，等宽字体）
- 开始时间（完整日期时间）
- 当前状态
- 消息数

### 项目切换下拉（ProjectSwitcher）— 新增

点击侧边栏项目名旁的 ↕ 图标弹出。

```
┌─────────────────────────────┐
│ 打开新的                     │
│ 📂 选择目录打开...           │
│─────────────────────────────│
│ 最近会话                     │
│ 🟢 修复登录样式              │
│    ~/projects/my-app  a1b2  │
│ ⚪ 重构 API 路由              │
│    ~/projects/my-app  e5f6  │
│ 🟠 部署配置排查              │
│    ~/work/backend    i9j0  │
│ ... (最多 5 条 + more)      │
└─────────────────────────────┘
```

- 与欢迎页使用相同的最近会话列表组件
- 选择"打开目录"→ 系统目录选择器 → 新建项目上下文
- 选择最近会话 → 切换项目上下文并恢复该会话

## 路由设计

| 路由 | 组件 | 说明 |
|------|------|------|
| `/login` | LoginView | 不变 |
| `/welcome` | WelcomeView（新增） | 无项目打开时的默认页 |
| `/home?project=<enc>` | HomeView（改造） | 打开项目后的工作区 |
| `/settings` | SettingsView | 不变 |
| `/notch` | NotchView | 不变 |

**路由守卫：**
- 登录成功后始终跳转 `/welcome`
- 未登录 → `/login`
- `/home` 必须带 `project` 参数，直接访问无参数时重定向到 `/welcome`

## 组件变更汇总

| 组件 | 变更类型 | 说明 |
|------|----------|------|
| `WelcomeView.vue` | **新增** | 欢迎页，Open Folder + Recent Sessions |
| `HomeView.vue` | 改造 | 接收 project 参数，按项目过滤会话 |
| `SessionList.vue` | 重写 | 去掉 Tab，仅显示打开中的会话 + 搜索 |
| `SessionItem.vue` | 重写 | 新增运行时长、Hover 详情卡片 |
| `ProjectSwitcher.vue` | **新增** | 项目切换下拉菜单 |
| `RecentSessionList.vue` | **新增** | 最近会话列表（欢迎页和切换下拉共用） |
| `stores/recent.ts` | **新增** | 最近会话状态管理 |
| `stores/sessions.ts` | 改造 | 增加 projectId 过滤、移除全局列表 |
| `router/index.ts` | 改造 | 新增 `/welcome`，改造 `/home` |

## 数据流

### 最近会话记录（recent-sessions.json）

存储位置：`~/.lynel-desktop/recent-sessions.json`

```json
[
  {
    "sessionId": "a1b2c3d4-...",
    "workdir": "/home/user/projects/my-app",
    "project": "my-app",
    "aiTitle": "修复登录页面样式问题",
    "firstPrompt": "帮我看下登录页的样式...",
    "lastOpenedAt": 1750000000,
    "state": "running"
  }
]
```

**维护规则：**
- 用户打开/创建会话时写入或更新记录
- 按 `lastOpenedAt` 倒序排列
- 同一 sessionId 去重（更新 `lastOpenedAt`）
- 会话结束后不删除记录，仅更新 `state`
- 主进程负责读写，通过 IPC 暴露给前端

### 打开项目流程

```
用户点击 "Open Folder"
  → 前端调用 PickDirectory() IPC
  → 系统目录选择器
  → 得到 workdir
  → 记录到 recent-sessions（project 级别，无 sessionId）
  → 路由到 /home?project=<enc>
  → 前端调用 ListSessions(workdir) 获取该项目下的会话
  → 显示打开中的会话列表
```

### 打开最近会话流程

```
用户点击某条最近会话
  → 得到 workdir + sessionId
  → 更新 recent-sessions 中该记录的 lastOpenedAt
  → 路由到 /home?project=<enc>
  → 前端调用 AdoptSession(sessionId, workdir)
  → 如果 PTY 未运行，调用 OpenSessionTerminal
  → 会话出现在侧边栏打开中列表
```

## 向后兼容

- 已有的 `ListSessions()` IPC 保留，增加可选 `workdir` 过滤参数
- 旧的 sessions store 中非当前项目的会话数据不清理（保留在内存中，切换回来时可用）
- `recent-sessions.json` 首次启动时从现有 `projects` 目录下的 JSONL 文件反向生成

## 不变量

- 向 PTY 发送用户消息必须以回车结尾（现有不变量不变）
- xterm.js 是唯一终端入口（不变）
- `useElectron.ts` 是唯一接触 `window.electronAPI` 的文件（不变）
- 图标统一用 `@lucide/vue`，禁止 emoji/Unicode 当图标（UI 中的 📁📂🕐💬 为 mockup 示意，实际用 Icon 组件）
