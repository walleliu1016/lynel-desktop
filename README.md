# Lynel Desktop

跨平台 Claude 会话管理桌面 App —— 把 Claude CLI 包成一个能登录、能拦截权限、能编辑 hooks 的本地 GUI。

Electron 43 (Node.js) + Vue 3 (TypeScript) + Pinia + vue-router。目标平台 macOS / Linux / Windows。v1 完全本地运行，不依赖任何云服务或 CI。

---

## 为什么做这个

Claude CLI 本身很强大，但日常使用有三个痛点：

1. **多会话管理困难** —— 没法一眼看到所有历史会话、当前状态、未读权限请求。
2. **权限弹窗打断流程** —— CLI 的 `PermissionRequest` 弹在终端里，需要切回去点 yes/no。
3. **Hooks 配置改起来很烦** —— `~/.claude/settings.json` 是 JSON，每次改都要打开编辑器、备份、查 schema。

Lynel Desktop 把这三件事变成一个 native 窗口里的 tab 体验，同时保留 `claude -r <sid>` 在系统终端里继续用的能力。

---

## 功能（v1）

- **本地账户密码登录** — bcrypt 哈希，5 次失败锁定 5 分钟
- **扫描并展示所有 Claude 会话** — 直接读 `~/.claude/projects/*/<sid>.jsonl`，无需起后端服务
- **会话列表自动刷新** — `fsnotify` 监听 `~/.claude/projects`，新 session / 关闭 / 改 jsonl 即时推送 `sessions:list:changed` 给前端
- **会话列表搜索** — SessionList 顶栏搜索框按项目名 / AI 标题 / session ID 过滤（大小写不敏感），`Esc` 清空
- **xterm.js 原生终端渲染** — 中间区域嵌入 xterm.js，主进程用 PTY 运行交互式 `claude`，原始 ANSI 字节直接渲染；启动时显示 loading 菊花，直到 xterm buffer 真正渲染出可见内容；终端尺寸随窗口缩放自动 debounce 调整
- **预生成 UUID 创建会话** — `CreateSession` 用 `randomUUID()` 预生成 session ID，直接传 `--session-id` 启动 Claude，不再依赖 SessionStart hook 返回 UUID
- **ToolTimeline 保留** — 不再实时解析 stream-json；ToolTimeline 由 hooks / jsonl 历史驱动
- **灵动岛悬浮窗** — iOS 风格常驻桌面顶部药丸，hover 展开显示会话状态/权限审批/AskUserQuestion 问答，5 色状态指示，动态高度适配
- **权限仲裁器** — 主进程单例 `PermissionBroker`，统一管理权限请求的 raise/resolve/cancel，支持灵动岛/企业微信/主窗口多通道协同审批，终端自行解决权限时联动关闭所有 UI
- **企业微信模板卡片交互** — PermissionRequest / AskUserQuestion 推送到企业微信为 `button_interaction` / `vote_interaction` 模板卡片，用户点击允许/拒绝/提交即可审批；多问题自动逐题发送并累积答案；`/allow` `/deny` `/answer` 命令兼容降级
- **权限提醒** — PermissionRequest 改为轻量 Toast 提醒，点击跳转到对应会话
- **Hook server** — 内置 HTTP server 接收 Claude hooks。`SessionStart` 已移除（改用预生成 UUID + `--session-id`），其余 12 类（`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SessionEnd` / `Notification` / `PreCompact` / `PostCompact` / `Stop` / `SubagentStart` / `SubagentStop` / `PostToolUseFailure` / `PermissionRequest`）用 HTTP POST，自动写 `~/.claude/settings.json`；闲置 5 分钟推 `idle_timeout`
- **HTTP API 写入 session** — `POST /api/send` 接收 `{"session_id":"...","prompt":"..."}`，未打开的已有 session 会自动 `claude --resume <sid>` 后写入 PTY。prompt 必须以回车触发执行；主进程会为缺少回车的 prompt 自动补 `\r`
- **本地 API 网关代理（ccglass 式）** — 每个 session 启动独立 `internal/apiproxy` HTTP 代理，注入 `ANTHROPIC_BASE_URL` 拦截 Claude 与 Anthropic API 的请求/响应，提取 `prompt` / `text` / `thinking` / `tool_use` / `tool_result` 阶段，落盘到 `~/.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl`（全局自增 `seq` + 每 session `turn`）；提供 REST (`/api/sessions/{id}/calls`、`/api/calls/{seq}`) 与 SSE (`/api/sessions/{id}/calls/stream`) 给前端消费
- **会话状态持久化** — 写到 `~/.lynel-desktop/instance.json`（30s 防抖），重启恢复 running / idle / done
- **编辑 Hooks 配置** — 表单化 `~/.claude/settings.json` 的 hooks 段（13 类全覆盖）；支持 Form / JSON 双视图切换；自动备份 `*.lynel-desktop.bak`
- **AdoptSession / OpenSessionTerminal / OpenSessionTerminalSized** — 历史 session 先注册到 App；点击打开时按需 `claude --resume <sid>` 进入交互式 PTY，已打开的 session 切回时复用 xterm 页面；`OpenSessionTerminalSized` 会把 PTY 初始尺寸设成当前 xterm 容器大小，避免首屏按窄宽度渲染
- **主题切换** — `dark-pro`（紫色强调） / `light-pro`（默认，红蓝主题），CSS 变量驱动，localStorage 持久化
- **五 tab 设置页** — General（基础设置） / Hooks（Form/JSON 双视图编辑器） / Cloud（占位） / Provider（模型供应商） / Channel（多通道：企业微信 / 飞书 / 本地文件，侧边栏 + 详情面板布局，互斥开关）
- **企业微信通道（双向）** — 通过 `@wecom/wecom-openclaw-plugin` 连接企业微信 Bot；Claude 的 prompt / AI 回复 / 工具 / 错误等事件自动推送到企业微信，工具调用显示命令详情；企业微信收到的文字/图文混排消息转发到当前活动会话
- **本地文件通道** — 将阶段事件写入 `~/.lynel-desktop/output/<project>/<sessionId>.jsonl`（支持 JSONL / JSON），过滤流式碎片只保留完整事件
- **飞书通道** — 占位支持，后续实现
- **字体层级** — 14px base + 标题 / 标签 / 提示 / 路径 / 代码各自不同字号，对比明显不堆砌
- **统一图标体系** — 全站使用 `@lucide/vue` SVG 图标，替换 emoji / Unicode 符号
- **共享基础组件** — `Icon.vue`、`Switch.vue`、`SettingsTabs.vue` 统一设置页/弹窗的 tab 与开关，减少重复实现
- **窗口状态管理** — `useWindowState` 集中管理最大化/最小化/尺寸；`app.go` 启动时 `StartHidden: true`，等前端布局完成后再 `WindowShow()`，避免登录/主页尺寸闪烁

---

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | Electron 43 | 需要集成 Node.js 生态的 `wecom-openclaw-plugin`；Electron 与 Node 模块无 ABI 鸿沟 |
| 前端 | Vue 3 + TypeScript + Pinia | 复用已有组件与状态管理；Composition API 与 IPC 层配合清晰 |
| 路由 | vue-router (hash mode) | Electron 本地文件协议下，hash mode 避免 server-side routing 问题 |
| 主进程 | Node.js 20+ + TypeScript 5.3+ | 直接复用 npm 生态；`node-pty` 驱动交互式 Claude；Express 接收 hooks |
| IPC | `contextBridge` + `ipcMain`/`ipcRenderer` | 安全隔离前端与主进程；`useElectron.ts` 做类型化转发 |
| 持久化 | `electron-store` + 本地 JSON + bcrypt | v1 不上 DB；配置/状态存在 Electron 默认用户数据目录 |
| 日志 | `electron-log` | 主进程与渲染进程统一日志，支持文件落盘 |
| 打包 | `electron-builder` 26.15+ | 一键输出 Windows `.exe` / macOS `.dmg` / Linux `.AppImage` |

### 为什么选 Electron

- 需要直接加载 Node.js 编写的 `@wecom/wecom-openclaw-plugin`，避免 Go ↔ Node.js 的胶水代码。
- 团队前端基于 Vue 3 已成熟，迁移成本主要是替换 IPC 层。

---

## 架构

```
┌──────────────────── Electron BrowserWindow (Chromium) ─────────────────────────────────────┐
│  Vue 3 App                                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                                            │
│  │  LoginView │  │  HomeView  │  │SettingsView│  ...                                       │
│  └─────┬──────┘  └──────┬─────┘  └──────┬─────┘                                            │
│        │                │               │                                                   │
│        └────────────────┴───────────────┴────────────┐                                      │
│                              │                       │                                      │
│                        Pinia stores            vue-router                                 │
│                              │                       │                                      │
│                              ▼                       │                                      │
│                    useElectron (typed IPC layer)     │                                      │
│                              │                       │                                      │
│         ┌────────────────────┴───────────────────────┘                                      │
│         │  window.electronAPI.<Method>(...)  →  ipcRenderer.invoke                           │
└─────────┼────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼  contextBridge exposes safe API surface
┌──────────────────── Electron Main Process (Node.js + TypeScript) ──────────────────────────┐
│  electron/main.ts      ←── BrowserWindow / Tray / single-instance lock                     │
│  electron/preload.ts   ←── contextBridge exposes main API to frontend                      │
│                                                                                             │
│  src/main/app.ts       ←── 主 App 类，ipcMain handler 注册中心                              │
│      │                                                                                       │
│      ├── auth           bcrypt verify + lockout counter                                     │
│      ├── session        state machine (idle → starting → running → awaiting_permission → done)│
│      ├── pty            node-pty 包装，运行交互式 `claude`                                  │
│      ├── jsonl          读 ~/.claude/projects/*/<sid>.jsonl + chokidar watch（自动刷新）      │
│      ├── hookserver     Express HTTP server 接收 Claude hooks，自动写 ~/.claude/settings.json │
│      ├── permission-broker  权限仲裁器：raise/resolve/cancel，跨通道协同                      │
│      ├── notch-window   灵动岛浮动窗口：透明置顶、hover 展开、动态尺寸                        │
│      ├── apiproxy       本地 API 网关代理：拦截 Claude API 流量，落盘阶段数据               │
│      ├── channels/      Channel Dispatcher：SSE / WeCom / LocalFile / 可扩展                │
│      │   ├── sse-channel.ts  ←── 实时阶段事件 SSE 输出                                     │
│      │   ├── wecom-channel.ts  ←── 企业微信双向通道：动态加载插件、WS 接收、转发到 PTY     │
│      │   └── localfile-channel.ts  ←── 本地文件输出：JSONL / JSON 格式落盘                 │
│      ├── store          electron-store 持久化 settings / instance                           │
│      ├── events         EventEmitter 进程内总线                                             │
│      └── log            electron-log 日志                                                   │
│                                                                                              │
│  hookserver  ← 127.0.0.1:<port>/hook (SessionStart 等 12 类) + /api/send (外部写入)         │
│              + /api/sessions/{id}/calls + /api/sessions/{id}/calls/stream + /api/calls/{seq} │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
            Electron userData/                      ~/.claude/
            ├── auth.json     (write)        ├── settings.json           (write, hooks editor)
            ├── settings.json (write)        └── projects/*/<sid>.jsonl  (read + watch)
            ├── instance.json (write, 30s)
            ├── projects/*/<sid>-calls.jsonl  (write, API 网关阶段数据)
            ├── session-start.sh / .ps1     (write, SessionStart 脚本)
            └── logs/*.log    (write)
```

### 数据流：发送一条消息

1. 用户在 `XtermTerminal.vue` 内输入；xterm.js 的 `onData` 通过 `WriteTerminalInput` 逐键写入 PTY。
2. 外部代码或 store 调 `SendMessage(sid, prompt)` 时，主进程调用 `session.Session.Send(prompt)` 写入交互式 Claude PTY。
3. `session.Send` 只发送裸文本，不再包装 stream-json envelope；如果 prompt 没有以 `\n` / `\r` 结尾，会自动补 `\r`，因为交互式 Claude 需要回车才执行。
4. Claude CLI 在 PTY 中输出 ANSI 字节，主进程 `pumpPtyEvents` 通过 `EventsEmit(ctx, "session:<id>", data)` 转发给前端。
5. `XtermTerminal.vue` 订阅 `session:<id>`，把原始输出写入 xterm.js。
6. ToolTimeline 不依赖 PTY stdout 解析，继续由 hooks / jsonl 历史驱动。

### 数据流：新建 session（预生成 UUID）

1. 前端 `useSessionsStore.create(workdir, prompt)` → `App.CreateSession(workdir, prompt)`
2. 主进程用 `randomUUID()` 预生成 session ID
3. 为该 session 启动 `APIProxy`（绑定 `127.0.0.1:0`），将 `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxyPort>` 注入 PTY 环境变量
4. 主进程用 `pty.ModeNew` + `--session-id <realId>` 启动交互式 `claude`
5. 创建 `session.Session` 实例，注册到 `session.register()`，`pumpPtyEvents` 绑定 PTY 输出
6. 如有初始 prompt，通过 `session.send(realId, prompt)` 写入 PTY（自动补回车）
7. 代理启动失败不阻塞 PTY，只打日志

**关键不变量**：

- 使用 `randomUUID()` 预生成 UUID，不再依赖 SessionStart hook
- jsonl 已存在的 sid 用 `--resume`；全新 sid 用 `--session-id`

### 数据流：外部脚本通过 HTTP API 写入 session

```bash
curl -X POST http://127.0.0.1:37373/api/send \
  -H "Content-Type: application/json" \
  -d '{"session_id":"0c8ef658-a32c-4e4e-8631-e29f70605855","prompt":"4+5 等于多少？"}'
```

1. hookserver `/api/send` 收到 POST → 调 `App.SendMessageFromHTTP(req)`（注册在 `hookSrv.OnSend`）
2. 如果 session 尚未在 App 内注册，主进程从 jsonl session 列表查找 workdir，并用 `claude --resume <sid>` 启动 PTY
3. `session.Send(prompt)` 写入裸文本 prompt；缺少结尾回车时自动补 `\r`，已有回车不重复追加
4. 失败返回 `{"ok":false,"error":"..."}`，成功返回 `{"ok":true}`
5. 用途：CI / 集成测试 / 自定义脚本往 Lynel Desktop 控制的 session 灌入 prompt

### 数据流：API 网关代理（ccglass 式）

1. `CreateSession` 启动 PTY 前，先为该 session 启动一个绑定到 `127.0.0.1:0` 的 `APIProxy`，直接用预生成的 UUID（不再需要临时代理后迁移）。
2. 把 `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxyPort>` 注入 PTY 环境变量；Claude CLI 的所有 Anthropic API 请求都会打到这个本地代理。
3. 代理把请求原样转发到上游 `https://api.anthropic.com`（或对应 provider），同时解析请求体提取当前 `prompt`、`tool_use` 名称、以及 `tool_result`（携带 `tool_use_id` 关联）。
4. 响应流边转发边捕获：SSE 事件增量解析，`input_json_delta` 累积拼接，在 `content_block_stop` 或 `stop_reason: 'tool_use'` 时发射完整的 `tool_use` 事件。
5. 每个可见阶段作为一行 JSON 写入 `~/.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl`：
   - `prompt`：用户当前输入（过滤系统注入 prompt 和跨请求重复 prompt）
   - `tool_use`：模型调用工具，记录完整 `id` / `name` / `input`
   - `tool_result`：后续请求带回的工具结果，通过 `tool_use_id` 关联
   - `response_complete`：模型最终文本回复（流式 text 碎片在代理层累积，完整后才 emit）
   - 每行含全局自增 `seq` 与当前轮次 `turn`
6. `hookserver` 暴露：
   - `GET /api/sessions/{id}/calls?workDir=...`：查询历史阶段数组
   - `GET /api/sessions/{id}/calls/stream?workDir=...`：SSE 实时推送新阶段（含历史）
   - `GET /api/calls/{seq}`：按全局 seq 查单条阶段
7. 代理启动失败时不阻塞 PTY，只打日志并继续运行，保证终端可用。

### 数据流：企业微信通道（双向）

####  outbound：Claude → 企业微信

1. `ChannelDispatcher` 把 `apiproxy` 发出的阶段事件同时路由给 `WeComChannel`。
2. `wecom-channel.ts` 过滤出 `prompt` / `response_complete` / `tool_use` / `tool_result` / `PermissionRequest` / `SessionEnd` / `error` 事件。
3. **普通事件**格式化为企业微信 Markdown 后调用 `@wecom/wecom-openclaw-plugin` 的 `outbound.sendText`（优先 `sendMarkdown`）。
4. **权限请求事件**构造 WeCom 模板卡片：
   - 普通权限 (`Bash/Write/Read`) → `button_interaction`（允许/拒绝按钮）
   - 单问题 `AskUserQuestion` → 单张 `vote_interaction`（radio/checkbox + 提交按钮）
   - 多问题 `AskUserQuestion` → 先发 Markdown 文本预告（含所有问题与选项），再逐张发送 `vote_interaction` 卡片（每张 `task_id` 带 `-{qIdx}` 后缀确保唯一）
5. 用户在企业微信点击卡片按钮 → `template_card_event` 事件 → `event-handler.ts` 解析 `event_key` 与 `selected_items` → 驱动 `permissionBroker.resolve` 完成审批/问答。
6. 多问题场景通过 `onQuestionProgress`/`onAllQuestionsDone` 回调链：提交当前卡片 → 累积答案 → 发送下一张 → 全部收齐后 resolve 并通知"已收集全部回答，已回复 Claude"。
7. 卡片发送失败自动降级为 Markdown 文本；Bot WebSocket 不可用时回退到 Agent HTTP API。

#### inbound：企业微信 → Claude

1. `WeComChannel.connect()` 创建企业微信 `WSClient` 并监听 `message` 事件。
2. 收到文字或图文混排消息后提取文本内容。
3. 按 `chatId → sessionId` 映射转发：若消息来自已出站过的 chat，则路由到对应 session；否则回退到最近活跃的 session。
4. 主进程调用 `session.send(sid, text)` 把文本写入该 session 的 PTY，自动补回车触发 Claude 执行。
5. AI 回复再经 `apiproxy` → `WeComChannel` 推回企业微信，形成闭环。

### 数据流：PermissionRequest 拦截

1. Claude CLI 通过 hookserver 发出 `PermissionRequest` hook（含 `tool_name`、`tool_input`、`session_id`）。
2. `hookserver` 调用 `permissionBroker.allocateSeq(id)` 预分配序号，构造 `PermissionRequest` 事件，通过 `ChannelDispatcher` 广播到各输出通道。
3. `permissionBroker.wait(request)` 挂起等待决策（返回 Promise）。
4. 各通道展示审批 UI：
   - **灵动岛**：展开面板显示权限卡片，允许/拒绝按钮，AskUserQuestion 问答交互
   - **企业微信**：推送 Markdown 卡片，用户回复 `#allow <seq>` / `#deny <seq>`
   - **主窗口**：`PermissionToast.vue` 浮动 toast，可直接 approve/deny
5. 用户做出决策后，任一通道调用 `permissionBroker.resolve(id, decision, source)`：
   - broker 解除 Promise 等待，hookserver 向 CLI 返回 `{behavior: 'allow'/'deny'}`
   - `onResolve` 通过 EventBus 通知灵动岛关闭权限 UI，通过 ChannelDispatcher 广播 `PermissionResolved` 同步到其他通道
6. 如果用户在终端自行解决权限（敲 y/n），hookserver 监听到 `req.on('close')` 后调用 `cancelBySessionTool` 清理所有审批 UI。
7. Map 保护：先到先生效，后续 resolve 调用返回 false。

### 数据流：jsonl 文件变化自动刷新

1. `jsonl.watchProjects()` 启动时递归监听 `~/.claude/projects/`
2. 任何 `*.jsonl` CREATE / WRITE / REMOVE / RENAME → 触发 `App.scheduleSessionsEmit`
3. App 端 500ms 去抖（reset 同一个 `time.Timer`，不是并行 AfterFunc）后 `EventsEmit("sessions:list:changed")`
4. 前端 `useEventStream` 订阅该事件 → `sessions.refresh()` 重新拉列表
5. 切到该 session 时通过 `GetSessionMessages` 按 offset/limit 分页加载（默认最后 100 条）

### 数据流：外部终端（已移除）

v1 不再提供「切到系统终端 / 切回 App」的切换 UI。所有交互统一走 `XtermTerminal.vue` 内的 xterm.js。

---

## 目录结构

```
lynel-desktop/
├── package.json                 # 根 package：Electron 脚本/依赖
├── package-lock.json            # npm 锁文件
├── electron-builder.yml         # 三平台打包配置
├── tsconfig.electron.json       # 主进程 TypeScript 配置
├── tsconfig.json                # 主进程引用配置
├── vite.config.ts               # 根 Vite 配置（主进程构建）
│
├── electron/                    # Electron 壳入口
│   ├── main.ts                  # BrowserWindow / Tray / 单例锁 / App 实例化
│   └── preload.ts               # contextBridge：安全暴露主进程 API
│
├── src/main/                    # Electron 主进程业务逻辑（替代原 Go internal/）
│   ├── app.ts                   # 主 App 类：组装模块、注册 ipcMain handler
│   ├── auth.ts                  # bcrypt 密码验证 + 锁定计数
│   ├── store.ts                 # electron-store 封装
│   ├── events.ts                # EventEmitter 进程内总线
│   ├── log.ts                   # electron-log 日志
│   ├── jsonl.ts                 # 扫描/监听 ~/.claude/projects
│   ├── session.ts               # 会话状态机 + SessionManager
│   ├── pty.ts                   # node-pty 封装
│   ├── process.ts               # 子进程工具
│   ├── hookserver.ts            # Express HTTP server：/hook /api/send /api/sessions/...
│   ├── permission-broker.ts     # 权限仲裁器：raise/resolve/cancel，跨通道协同
│   ├── notch-window.ts          # 灵动岛浮动窗口：透明置顶、hover 展开、动态尺寸
│   ├── apiproxy.ts              # Claude API 代理 + 阶段事件解析
│   └── channels/                # Channel Dispatcher：阶段数据多通道输出
│       ├── channel.ts           # OutputChannel 接口 + ProxyStageEvent
│       ├── registry.ts          # ChannelDispatcher
│       ├── sse-channel.ts       # SSE 输出
│       ├── wecom-channel.ts     # 企业微信输出（双向通道 + 模板卡片交互）
│       ├── wecom-cards/         # 企业微信模板卡片子模块
│       │   ├── card-builder.ts  #   button/vote_interaction 卡片构造
│       │   ├── card-store.ts    #   卡片状态存储 + 多题答案累积
│       │   └── event-handler.ts #   template_card_event 事件处理器
│       └── localfile-channel.ts # 本地文件输出（JSONL / JSON）
│
├── frontend/                    # Vue 3 + TypeScript 前端
│   ├── index.html               # 入口 HTML
│   ├── package.json             # 前端依赖
│   ├── package-lock.json
│   ├── vite.config.ts           # 前端 Vite 配置
│   └── src/
│       ├── main.ts              # Vue 启动 + router + pinia
│       ├── App.vue              # 仅 <router-view />
│       ├── router/              # hash 路由 + 鉴权守卫
│       ├── stores/              # Pinia：auth / sessions / settings / hooks
│       ├── views/               # LoginView / HomeView / SettingsView / NotchView
│       ├── components/          # TitleBar / SessionList / XtermTerminal /
│       │                        #   ToolTimeline / PermissionToast / Icon / Switch /
│       │                        #   settings/{General,Hooks,Cloud,Provider,Channel}Tab /
│       │                        #   {WeCom,Feishu,LocalFile}Config
│       ├── composables/         # useElectron（typed IPC）/ useEventStream / useWindowState
│       ├── styles/              # reset.css + theme.css（CSS 变量 + 配色）
│       └── types/               # 共享 TypeScript 类型
│
├── tests/                       # 主进程测试
│   ├── main/                    # vitest 单元测试
│   └── send-msg.sh              # 本地调试：向指定 session 发消息
│
├── docs/                         # 文档
│   ├── changelog/                # 版本 changelog（CI release 自动读取）
│   ├── superpowers/            # 设计文档 + 实施计划
│   ├── specs/2026-06-27-lynel-desktop-design.md   # 旧 Wails 设计（历史）
│   ├── plans/2026-06-27-lynel-desktop.md          # 旧 Wails 实施（历史）
│   ├── specs/2026-07-06-electron-migration-design.md
│   └── plans/2026-07-06-electron-migration-plan.md
│
└── build/                       # 图标与打包资源
    ├── appicon.png
    ├── windows/
    │   ├── icon.ico
    │   └── trayicon.ico
    └── ...
```

---

## 下载与安装

### macOS

由于应用未进行 Apple 代码签名，首次安装后 macOS 可能会提示「无法打开『Lynel Desktop』，因为无法验证开发者」或「文件已损坏」。这是预期行为，并非安装包损坏。

解决方法：

```bash
# 移除 App 的隔离属性
xattr -cr /Applications/Lynel\ Desktop.app
```

或者通过图形界面：

1. 将 `Lynel Desktop.app` 拖入「应用程序」文件夹。
2. 首次打开时若被拦截，进入「系统设置 → 隐私与安全性」。
3. 在「安全性」下找到「已阻止使用『Lynel Desktop』」，点击「仍要打开」。

之后即可正常启动，无需重复执行。

### Windows / Linux

- Windows：运行 `.exe` 安装程序，按向导完成安装。
- Linux：下载 `.AppImage`，赋予可执行权限后双击运行：

```bash
chmod +x lynel-desktop-<version>-x64.AppImage
./lynel-desktop-<version>-x64.AppImage
```

---

## 开发

### 前置依赖

- Node 20+（`engines` 要求 `>=20.0.0`）
- npm（根目录与 `frontend/` 各自独立安装）
- Windows：`node-pty` 需要 Visual Studio Build Tools（C++ 桌面开发工作负载）才能为 Electron 重建原生模块
- macOS：Xcode Command Line Tools（`xcode-select --install`）
- Linux：`build-essential` + Python（用于 `node-pty` 编译）

### 目录与安装

```bash
# 1) 安装根目录依赖（Electron 主进程 + electron-builder）
npm install

# 2) 安装前端依赖
cd frontend && npm install
```

### 日常命令

```bash
# 1) 主进程单元测试
npm run test:main

# 2) 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 3) 前端单独开发（Vite dev server，5173 端口）
cd frontend && npm run dev
# 这种模式下没有 Electron runtime，window.electronAPI 是 undefined，
# 只适合做纯 UI 调试。IPC 相关的代码要走 npm run dev。

# 4) 全栈开发（推荐）—— 同时起 Vite frontend + Electron 主进程
npm run dev

# 5) 生产构建（产物在 dist/ 与 dist-electron/）
npm run build

# 6) 打包当前平台安装包
npm run dist

# 7) 指定平台打包（GitHub Actions 用对应 runner 执行）
npm run dist:win    # Windows → dist/lynel-desktop-<version>-x64.exe
npm run dist:mac    # macOS   → dist/lynel-desktop-<version>-x64.dmg
npm run dist:linux  # Linux   → dist/lynel-desktop-<version>-x64.AppImage
```

**GitHub Actions** —— `.github/workflows/build.yml` 会在 push 到 `electron`/`main` 或打 `v*` 标签时自动三平台构建，并将产物上传到 Release。

### 首次使用

```bash
# 1) 启动 GUI
npm run dist        # 或本地开发：npm run dev

# 2) 首次登录：用户名 + 密码（bcrypt hash 存到 Electron userData）

# 3) 重置密码：删除 auth store，下次启动重新引导
#    Windows: 删 %APPDATA%\Lynel Desktop\auth.json
#    macOS:   删 ~/Library/Application Support/Lynel Desktop/auth.json
#    Linux:   删 ~/.config/Lynel Desktop/auth.json
```

### 配置文件位置

Electron 默认用户数据目录随 `productName: Lynel Desktop` 自动决定：

| 文件 | 路径 | 权限 |
|---|---|---|
| 应用配置 | `%APPDATA%\Lynel Desktop\config.json` / `~/Library/Application Support/Lynel Desktop/config.json` / `~/.config/Lynel Desktop/config.json` | 读写 |
| 鉴权（bcrypt hash） | 同上目录 `auth.json` | 读写 |
| 会话状态（持久化） | 同上目录 `instance.json` | 读写（30s 防抖） |
| 本地文件通道输出 | 用户主目录 `.lynel-desktop/output/<project>/<sid>.jsonl` | 写入（追加） |
| API 网关阶段数据 | 用户主目录 `.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl` | 写入（追加） |
| Claude Hooks（可写） | `~/.claude/settings.json` | 读写（编辑前自动 `.lynel-desktop.bak`） |
| Claude 会话（只读 + watch） | `~/.claude/projects/*/<sid>.jsonl` | 读 + chokidar |
| 日志（electron-log 滚动） | `~/.lynel-desktop/logs/*.log` | 读写 |
| Claude Hooks（可写） | `~/.claude/settings.json` | 读写（编辑前自动 `.lynel-desktop.bak`） |
| Claude 会话（只读 + watch） | `~/.claude/projects/*/<sid>.jsonl` | 读 + fsnotify |

---

## 调试技巧

### 黑屏 / 启动卡死排查

`index.html` 头部有一段早期 diag inline 脚本 + `preload.ts` 的 top-of-file 日志，会在屏幕上写出时间戳事件。生产 build 也保留着（便于现场排查用户机器）。

**当 app 启动后只看到黑屏 / 一个紫色 div 没有后续日志时，按这张表对：**

| 看到什么 | 卡在哪里 |
|---|---|
| 紫色 div 出现，HB#1 列出 `<script src=...>` 但 HB#2 不再 log | 浏览器在 fetch `/assets/index.<hash>.js` 时被阻塞（asset server 问题，或 dist hash 跟 embed FS 不一致） |
| HB 持续跑，但 preload 那一行没出现 | main.ts 模块求值还没跑到 `import './preload'`，通常是 Vite build 把别的 import 排在前面，或循环依赖 |
| preload 出现但 main.ts 的 `main.ts loaded` 没出现 | module 内部 import 链（vue / pinia / router / app.vue）某个抛了 — 配合 `window.addEventListener('error')` 看堆栈 |
| 出现 `pinia installed` 但 `router installed` 之后没下文 | 路由 import 链（views 或 stores/auth）的 setup 阶段同步抛错 |
| 出现 `auth.initPromise created, awaiting...` 后停 | `IsInitialized()` 的 XPC 响应没回来 —— macOS TCC 没授权 `lynel-desktop` 访问 "System Events" / "Accessibility" |

**macOS TCC 重置命令**（授权卡住时）：

```bash
tccutil reset AppleEvents
tccutil reset Accessibility
tccutil reset ScreenCapture
# 然后删 ~/Library/Application Support/lynel-desktop 重新跑
```

### 单例锁

`单例锁机制` 用 `app.requestSingleInstanceLock()` 实现。**二次启动会激活已有实例并自动退出**。

### 看主进程日志

`electron-log` 默认将日志写到：
- Windows：`%USERPROFILE%\AppData\Roaming\Lynel Desktop\logs\{main,renderer}.log`
- macOS：`~/Library/Logs/Lynel Desktop/{main,renderer}.log`
- Linux：`~/.config/Lynel Desktop/logs/{main,renderer}.log`

### DevTools

```bash
# 开发模式默认打开 DevTools
npm run dev

# 生产构建后也可通过菜单或快捷键打开 DevTools
npm run dist
```

DevTools Console 里 `window.electronAPI` 列出所有暴露给前端的 IPC 方法。

### 已知问题

- ✅ **窗口尺寸闪烁 / 自动最大化** —— 已修复：`electron/main.ts` 启动 `show: false` + `useWindowState` 集中管理尺寸/最大化状态，登录成功后切主页再显示窗口。
- ✅ **启动 loading 过早消失后空白** —— 已修复：改为监听 `term.onRender` 并扫描 buffer 真实可见内容，避免原始 ANSI 输出导致 spinner 提前隐藏。
- 🐛 **生产 build 偶现白屏** —— dev 模式 OK，prod build 启动后 Chromium 偶现不渲染 UI。原因仍在排查。workaround：开发用 `npm run dev`，生产包可通过菜单打开 DevTools 复现。
- ⚠️ **v1 不支持外部 HTTP/SOCKS 代理** —— CLI 子进程仍直连 Anthropic；本地 API 网关代理只用于捕获结构化数据，不替代外部代理。
- ⚠️ **v1 不做会话并发** —— 一个 session 在 streaming 时不能再发消息，UI 锁住输入。

---

## Roadmap

### v1.1（bug fix 优先）

- 生产 build 偶现黑屏根因排查
- 修复 Windows 上 WebView2 高 DPI 缩放
- 优化历史 session 首次发消息延迟（`AdoptSession` 走预热）

### v1.2（云占位落地）

- Cloud tab 接入 —— 多设备同步会话列表 / 配置
- 用户系统（email + OAuth）

### v2（重大功能）

- 实时协作（光标 / presence）
- 自定义 plugin 协议（让 Claude 能调 Ease 暴露的工具）
- 移动端远程控制 iOS / Android 客户端

### 不做（YAGNI）

- ❌ 多账号切换 —— v1 一个本地账户
- ❌ Token 计费面板 —— CLI 自己 log，解析日志即可
- ❌ 国际化 —— v1 中文优先，i18n 留 v2 一起做

---

## 致谢

- [Electron](https://www.electronjs.org) — Node.js + Web 的桌面桥接
- [Claude CLI](https://docs.claude.com/en/docs/claude-code) — 协议定义的事实标准
- [Vue 3](https://vuejs.org) — Composition API 与 TypeScript 配合清晰
- [node-pty](https://github.com/microsoft/node-pty) — 跨平台 PTY 支持

## License

MIT
