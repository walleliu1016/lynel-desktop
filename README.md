# Ease UI

跨平台 Claude 会话管理桌面 App —— 把 Claude CLI 包成一个能登录、能拦截权限、能编辑 hooks 的本地 GUI。

Wails v2 (Go) + Vue 3 (TypeScript) + Pinia + vue-router。目标平台 macOS / Linux / Windows。v1 完全本地运行，不依赖任何云服务或 CI。

---

## 为什么做这个

Claude CLI 本身很强大，但日常使用有三个痛点：

1. **多会话管理困难** —— 没法一眼看到所有历史会话、当前状态、未读权限请求。
2. **权限弹窗打断流程** —— CLI 的 `PermissionRequest` 弹在终端里，需要切回去点 yes/no。
3. **Hooks 配置改起来很烦** —— `~/.claude/settings.json` 是 JSON，每次改都要打开编辑器、备份、查 schema。

Ease UI 把这三件事变成一个 native 窗口里的 tab 体验，同时保留 `claude -r <sid>` 在系统终端里继续用的能力。

---

## 功能（v1）

- **本地账户密码登录** — bcrypt 哈希，5 次失败锁定 5 分钟
- **扫描并展示所有 Claude 会话** — 直接读 `~/.claude/projects/*/<sid>.jsonl`，无需起后端服务
- **会话列表自动刷新** — `fsnotify` 监听 `~/.claude/projects`，新 session / 关闭 / 改 jsonl 即时推送 `sessions:list:changed` 给前端
- **会话列表搜索** — SessionList 顶栏搜索框按项目名 / AI 标题 / session ID 过滤（大小写不敏感），`Esc` 清空
- **xterm.js 原生终端渲染** — 中间区域嵌入 xterm.js，Go 端用 PTY 运行交互式 `claude`，原始 ANSI 字节直接渲染；启动时显示 loading 菊花，直到终端有可见内容
- **Session ID 由 Claude 生成** — Ease UI 不自己 newID。`CreateSession` 用 `pty.ModeAuto` 启动 Claude + 阻塞等 SessionStart hook 返回 Claude 生成的真实 UUID（15s 超时），UI 期间显示加载动画
- **ToolTimeline 保留** — 不再实时解析 stream-json；ToolTimeline 由 hooks / jsonl 历史驱动
- **权限提醒** — PermissionRequest 改为轻量 Toast 提醒，点击跳转到对应会话
- **Hook server** — 内置 HTTP server 接收 Claude hooks。`SessionStart` 用 command 脚本（Claude 不支持 HTTP 类型的 SessionStart hook），其余 12 类（`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SessionEnd` / `Notification` / `PreCompact` / `PostCompact` / `Stop` / `SubagentStart` / `SubagentStop` / `PostToolUseFailure` / `PermissionRequest`）用 HTTP POST，自动写 `~/.claude/settings.json`；闲置 5 分钟推 `idle_timeout`
- **HTTP API 写入 session** — `POST /api/send` 接收 `{"session_id":"...","prompt":"..."}`，未打开的已有 session 会自动 `claude --resume <sid>` 后写入 PTY。prompt 必须以回车触发执行；Go 端会为缺少回车的 prompt 自动补 `\r`
- **会话状态持久化** — 写到 `~/.ease-app/instance.json`（30s 防抖），重启恢复 running / idle / done
- **编辑 Hooks 配置** — 表单化 `~/.claude/settings.json` 的 hooks 段（13 类全覆盖）；支持 Form / JSON 双视图切换；自动备份 `*.ease-ui.bak`
- **AdoptSession / OpenSessionTerminal / OpenSessionTerminalSized** — 历史 session 先注册到 App；点击打开时按需 `claude --resume <sid>` 进入交互式 PTY，已打开的 session 切回时复用 xterm 页面；`OpenSessionTerminalSized` 会把 PTY 初始尺寸设成当前 xterm 容器大小，避免首屏按窄宽度渲染
- **主题切换** — dark-pro / light-pro 双主题，localStorage 持久化
- **三 tab 设置页** — General（基础设置） / Hooks（Form/JSON 双视图编辑器） / Cloud（v1 占位，v2 接入）
- **字体层级** — 14px base + 标题 / 标签 / 提示 / 路径 / 代码各自不同字号，对比明显不堆砌

---

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | Wails v2.12.0 | 比 Electron 小一个数量级；Go 写后端不用胶水语言；WebView 用系统原生（macOS WebKit / Windows WebView2） |
| 前端 | Vue 3 + TypeScript + Pinia | 团队熟悉；Composition API 跟 Go 的 functional style 合拍 |
| 路由 | vue-router (hash mode) | Wails 走 `wails://` 自定义 scheme，用 hash mode 避免 server-side routing |
| 后端 | Go 1.26+ | 强类型；并发原语跟 IPC 桥接天然契合；`embed.FS` 打包前端零依赖 |
| IPC | Wails JSON-RPC | 自动生成 `wailsjs/go/app/App.js`；前端不直接碰 `window.go.*` |
| 持久化 | 本地 JSON + bcrypt | v1 不上 DB；`~/.ease-app/` 五个文件搞定 |
| 日志 | lumberjack | 按天滚动，10MB 切割 |

### 为什么选 Wails 而不是 Tauri / Electron

- **Tauri**：v1 时代 macOS 上 WebView 性能不可靠（已经修，但 v2 我们决定不再冒险）。另外 Wails 在 Go 这边是 first-class，Tauri 偏 Rust。
- **Electron**：打包后 100MB+，启动 2-3 秒。我们的目标是冷启动 < 1s，包体 < 30MB。
- **Wails v2**：包体 8-15MB，冷启动 < 500ms，macOS WebKit 渲染跟 Safari 一致。

代价：Wails 的生态比 Tauri 小，遇到坑得自己看 `internal/frontend/desktop/darwin/*.m` 源码。

---

## 架构

```
┌──────────────────── Native Window (WKWebView / WebView2 / WebKitGTK) ─────────────────────┐
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
│                    useWails (typed IPC layer)        │                                      │
│                              │                       │                                      │
│         ┌────────────────────┴───────────────────────┘                                      │
│         │  window.go.app.App.<Method>(...)  →  JSON-RPC over XPC/WebView2 bridge           │
└─────────┼────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼  Wails runtime injects via asset server
┌──────────────────── Go Backend (single binary) ────────────────────────────────────────────┐
│  internal/app         ←── Wails Bind() entry, the ONLY package exposed to frontend          │
│      │                                                                                       │
│      ├── auth          bcrypt verify + lockout counter                                        │
│      ├── session       state machine (idle → starting → running → awaiting_permission → done)│
│      ├── process       os/exec wrapper around `claude` CLI                                   │
│      ├── protocol      stream-json line splitter + event types                               │
│      ├── jsonl         read ~/.claude/projects/*/<sid>.jsonl + fsnotify watch (auto-refresh)  │
│      ├── hooks         PermissionRequest handler + settings.json editor (with backup)        │
│      ├── hookserver    内置 HTTP server 接收 Claude hooks，自动配 ~/.claude/settings.json     │
│      ├── terminal      open external terminal w/ `claude -r <sid>`（mac/win/linux 探测）      │
│      ├── settings      ~/.ease-app/settings.json                                             │
│      ├── instance      ~/.ease-app/instance.json：会话状态持久化（30s 防抖）                  │
│      ├── events        process-local pub/sub bus                                             │
│      ├── single        flock (Unix) / LockFileEx (Windows) 单例锁                            │
│      └── log           lumberjack rotating logger                                            │
│                                                                                               │
│  embed.FS ← all:frontend/dist                                                                 │
│  hookserver  ← 127.0.0.1:<port>/hook (SessionStart 等 12 类) + /api/send (外部写入)         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
            ~/.ease-app/                      ~/.claude/
            ├── auth.json     (write)        ├── settings.json           (write, hooks editor)
            ├── settings.json (write)        └── projects/*/<sid>.jsonl  (read + watch)
            ├── instance.json (write, 30s)
            ├── session-start.sh / .ps1     (write, SessionStart 脚本)
            ├── singleton.lock (flock)
            └── logs/*.log    (write)
```

### 数据流：发送一条消息

1. 用户在 `XtermTerminal.vue` 内输入；xterm.js 的 `onData` 通过 `WriteTerminalInput` 逐键写入 PTY。
2. 外部代码或 store 调 `SendMessage(sid, prompt)` 时，Go 端调用 `session.Session.Send(prompt)` 写入交互式 Claude PTY。
3. `session.Send` 只发送裸文本，不再包装 stream-json envelope；如果 prompt 没有以 `\n` / `\r` 结尾，会自动补 `\r`，因为交互式 Claude 需要回车才执行。
4. Claude CLI 在 PTY 中输出 ANSI 字节，Go 端 `pumpPtyEvents` 通过 `EventsEmit(ctx, "session:<id>", data)` 转发给前端。
5. `XtermTerminal.vue` 订阅 `session:<id>`，把原始输出写入 xterm.js。
6. ToolTimeline 不依赖 PTY stdout 解析，继续由 hooks / jsonl 历史驱动。

### 数据流：新建 session（Claude 生成 UUID）

1. 前端 `useSessionsStore.create(workdir, prompt)` → `App.CreateSession(workdir, prompt)`
2. Go 端用 `pty.ModeAuto` 启动交互式 `claude`（**不带** `--session-id` / `--resume` flag —— Claude 自己生成）
3. Go 端 `registerPending(ch)` 注册一个 channel 等待 SessionStart hook
4. Claude CLI 启动后调用 SessionStart hook（`~/.ease-app/session-start.sh` Unix / `session-start.ps1` Windows），脚本 curl POST 到本地 `http://127.0.0.1:<port>/hook`
5. hookserver 解析 `hook_event_name=SessionStart` 事件 → 调 `deliverSessionID(realID)` → 把真实 UUID 推进 channel
6. Go 端 `CreateSession` 收到 UUID → 用真实 ID 建 `session.Session` + 注册到 `a.sessions` + `pumpPtyEvents` + 写首条 prompt（自动补回车）
7. 15s 内没收到 hook → `CreateSession` 返回 `session start timeout (15s)` 错误
8. 前端根据真实 ID 插入占位 session（jsonl 还没写）→ 等 `sessions:list:changed` 推送后 jsonl 出现再刷新

**关键不变量**：

- Ease UI **绝不**自己生成 session ID（之前用 `newID()` 生成的 16-char hex 会被 Claude 拒绝：`Invalid session ID. Must be a valid UUID`）
- SessionStart 专用 command 脚本 —— Claude 不支持 HTTP 类型的 SessionStart hook
- Claude command hook 的 JSON 字段是 `hook_event_name`，**不是** HTTP hook 用的 `type`（之前解析 `evt.Type` 拿到空串，导致所有 hook 静默丢弃）

### 数据流：外部脚本通过 HTTP API 写入 session

```bash
curl -X POST http://127.0.0.1:37373/api/send \
  -H "Content-Type: application/json" \
  -d '{"session_id":"0c8ef658-a32c-4e4e-8631-e29f70605855","prompt":"4+5 等于多少？"}'
```

1. hookserver `/api/send` 收到 POST → 调 `App.SendMessageFromHTTP(req)`（注册在 `hookSrv.OnSend`）
2. 如果 session 尚未在 App 内注册，Go 端从 jsonl session 列表查找 workdir，并用 `claude --resume <sid>` 启动 PTY
3. `session.Send(prompt)` 写入裸文本 prompt；缺少结尾回车时自动补 `\r`，已有回车不重复追加
4. 失败返回 `{"ok":false,"error":"..."}`，成功返回 `{"ok":true}`
5. 用途：CI / 集成测试 / 自定义脚本往 Ease UI 控制的 session 灌入 prompt

### 数据流：PermissionRequest 拦截

1. CLI 发出 `{"type":"control_request","request":{"subtype":"can_use_tool",...}}`
2. `protocol.Parser` 识别为 PermissionRequest，转发给 `hooks.Handler.Handle(req)`
3. 如果 `autoAllowBash` 且 `req.Tool == "Bash"` → 直接 `Allow: true, Auto: true`
4. 否则 emit `session:permission` 事件给前端
5. 前端 `PermissionPanel.vue` 显示，绑 `@respond="respondPermission"`
6. 用户点击 → `useWails.RespondPermission(sid, reqId, allow)` 回到 Go
7. Go 端把决策通过 `process.Stdin` 写回 CLI（格式是 CLI 定义的 control_response）

### 数据流：jsonl 文件变化自动刷新

1. `internal/jsonl.WatchProjects()` 启动时递归监听 `~/.claude/projects/`
2. 任何 `*.jsonl` CREATE / WRITE / REMOVE / RENAME → 触发 `App.scheduleSessionsEmit`
3. App 端 500ms 去抖（reset 同一个 `time.Timer`，不是并行 AfterFunc）后 `EventsEmit("sessions:list:changed")`
4. 前端 `useEventStream` 订阅该事件 → `sessions.refresh()` 重新拉列表
5. 切到该 session 时通过 `GetSessionMessages` 按 offset/limit 分页加载（默认最后 100 条）

### 数据流：Owner 切换（外部终端 → App 控制）

1. 前端 `Composer` 处于 terminal 模式时，用户点「切回并发送」（或点「切回 App 控制」不发送）
2. `HomeView` 调 `useWails.SwitchOwner(sid, 'app', prompt)` → `App.SwitchOwner`
3. `App.SwitchOwner` 在 `session.SwitchLock()` 持锁下走 `switchToApp`：先按 `ExtPIDFile` 拿 pid 调 `killByPIDFile`（SIGTERM 失败兜底 SIGKILL），pidfile 失效则 `pkillByPattern("claude.*-r.*"+sid)` 兜底
4. `time.Sleep(switchSettleDelay)` 等 hook server 收到 `SessionEnd` 事件
5. `s.Close()` 旧 stream-json 进程引用 → `process.Start` 启新 stream-json 进程 → `pumpEvents` 重订阅事件
6. prompt 非空 → `proc.Write(envelopeUserMessage(prompt))` 写 stream-json envelope（`{"type":"user","message":{"role":"user","content":prompt}}`）
7. session 状态：`Owner=App`、`Mode=Stream`；前端 `handleHookEvent` 后续 PreToolUse 等事件不会再覆盖 owner
8. `App.OpenInTerminal` 走相反方向：先 `s.Close()` stream-json 进程，再 `terminal.Launcher.Launch` 拼 `osascript`（macOS）/ `gnome-terminal` 等（Linux）/ `cmd /c start wt`（Windows）+ `claude -r <sid>`，回填 `Owner=Terminal`、`Mode=Resume`、pidfile 路径

---

## 目录结构

```
ease-ui/
├── main.go                      # 入口：单例锁 → app.New → wails.Run
├── app.go                       # Wails Run 配置：标题、尺寸、AssetServer、OnStartup/OnShutdown、Bind
│
├── internal/                    # 所有后端代码（不导出）
│   ├── app/                     # Wails bindings — 唯一对前端暴露的层
│   ├── session/                 # 会话状态机 + 内存 session 表（Owner/Mode 状态 + SwitchLock）
│   ├── process/                 # os/exec 包装：stdin pipe + stdout/stderr line splitter（ModeAuto/ModeNew/ModeResume）
│   ├── protocol/                # stream-json 消息类型 + 行解析器
│   ├── jsonl/                   # 读 ~/.claude/projects/*/<sid>.jsonl + fsnotify watch
│   ├── hooks/                   # PermissionRequest 决策 + settings.json 编辑器（带 .bak）
│   ├── hookserver/              # 内置 HTTP server 收 Claude hooks + 配 ~/.claude/settings.json
│   │                             #   端点: /hook (POST, 12 类 hook) + /api/send (外部脚本写入)
│   ├── terminal/                # 跨平台打开系统终端 + 拼 claude -r 命令（注入 pidfile 供切回用）
│   ├── auth/                    # bcrypt + lockout（5 次错 → 锁 5 分钟）
│   ├── settings/                # ~/.ease-app/settings.json 读写
│   ├── instance/                # ~/.ease-app/instance.json 持久化（30s 防抖写盘）
│   ├── single/                  # flock (Unix) / LockFileEx (Windows) 单例锁
│   ├── events/                  # 进程内 pub/sub（session 状态机用）
│   └── log/                     # lumberjack 轮转日志
│
├── frontend/                    # Vue 3 + TypeScript
│   ├── index.html               # 含 Wails runtime + 早期 diag div（开发期排查用）
│   ├── src/
│   │   ├── main.ts              # Vue 启动 + router + pinia 安装 + auth.initPromise 预热
│   │   ├── preload.ts           # 模块求值最早一行：往 diag div 写标记，定位启动卡点
│   │   ├── App.vue              # 仅 <router-view />
│   │   ├── router/              # hash 路由 + beforeEach 鉴权守卫
│   │   ├── stores/              # Pinia：auth / sessions / settings / hooks
│   │   ├── views/               # LoginView / HomeView / SettingsView
│   │   ├── components/          # TitleBar / SessionList / MessageBubble / ToolUseBlock /
│   │   │                        #   Composer / ToolBar / UserBar / PermissionPanel /
│   │   │                        #   NewSessionDialog / SessionItem / SessionTooltip /
│   │   │                        #   settings/{General,Hooks,Cloud}Tab
│   │   ├── composables/         # useWails（typed IPC 转发）/ useEventStream（事件订阅）
│   │   ├── styles/              # reset.css + theme.css（CSS 变量 + 配色，dark-pro/light-pro）
│   │   ├── wailsjs/             # Wails 自动生成（go/app/App.js + models.ts），不要手改
│   │   └── types/               # 共享 TypeScript 类型
│   └── vite.config.ts           # 仅 @vitejs/plugin-vue
│
├── docs/superpowers/            # 设计文档 + 实施计划（任务拆分历史）
│   ├── specs/2026-06-27-ease-ui-design.md
│   └── plans/2026-06-27-ease-ui.md
│
└── build/                       # `wails build` 产物（不提交 .app/.exe，但 build/ 目录要留）
    ├── bin/                     # 平台二进制
    ├── darwin/                  # Info.plist + icon
    └── windows/ linux/          # 同上，其他平台
```

---

## 开发

### 前置依赖

- Go 1.26+
- Node 18+（建议 pnpm，没装也能用 npm / yarn）
- Wails CLI v2.12+：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- macOS：Xcode Command Line Tools（`xcode-select --install`）
- Windows：WebView2 Runtime（Win11 自带，Win10 需手动装）
- Linux：`libwebkit2gtk-4.0-dev` + `libgtk-3-dev`

### 日常命令

```bash
# 1) 后端单元测试
go test ./...

# 2) 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 3) 前端单独开发（Vite dev server，5173 端口）
cd frontend && npm run dev
# 这种模式下没有 Wails runtime，window.go 是 undefined，
# 只适合做纯 UI 调试。IPC 相关的代码要走 wails dev。

# 4) 全栈开发（推荐）—— Wails 起 Vite + Go，自动注入 runtime
wails dev

# 5) 生产构建（产物在 build/bin/<AppName>.<ext>）
wails build -clean -trimpath -ldflags "-X main.version=v$(date +%Y%m%d)"

# 6) 仅 Go 后端快速验证
# Go 1.26.3 + Wails v2.12.0 在当前环境生成 bindings 会失败，推荐用 --skipbindings
wails build -s --skipbindings

# 7) 跨平台打包（每平台必须在对应 OS 上跑）
wails build -platform darwin/universal     # macOS
wails build -platform windows/amd64        # Windows / mingw-w64
wails build -platform linux/amd64          # Linux / Docker
```

**没有 GitHub Actions release workflow** —— 每个平台手工打包，v1 阶段不引入 CI 复杂度。

### 首次使用

```bash
# 1) 启动 GUI
open ./build/bin/ease-ui.app
# 或直接：./build/bin/ease-ui.app/Contents/MacOS/ease-ui

# 2) 首次登录：用户名 + 密码（bcrypt hash 写到 ~/.ease-app/auth.json）

# 3) 重置密码：删 auth.json，下次启动会重新引导
rm ~/.ease-app/auth.json
```

### 配置文件位置

| 文件 | 路径 | 权限 |
|---|---|---|
| Ease 配置 | `~/.ease-app/settings.json` | 读写 |
| 鉴权（bcrypt hash） | `~/.ease-app/auth.json` | 读写 |
| 会话状态（持久化） | `~/.ease-app/instance.json` | 读写（30s 防抖） |
| SessionStart hook 脚本 | `~/.ease-app/session-start.sh`（macOS/Linux）<br>`~/.ease-app/session-start.ps1`（Windows） | 写入（755 / 644） |
| 单例锁 | `~/Library/Application Support/ease-ui/singleton.lock`（macOS）<br>`$XDG_RUNTIME_DIR/ease-ui/singleton.lock` 或 `~/.config/ease-ui/singleton.lock`（Linux）<br>`%AppData%\ease-ui\singleton.lock`（Windows） | 内核自动管理 |
| 日志（lumberjack 滚动） | `~/.ease-app/logs/*.log` | 读写 |
| Claude Hooks（可写） | `~/.claude/settings.json` | 读写（编辑前自动 `.ease-ui.bak`） |
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
| 出现 `auth.initPromise created, awaiting...` 后停 | `IsInitialized()` 的 XPC 响应没回来 —— macOS TCC 没授权 `ease-ui` 访问 "System Events" / "Accessibility" |

**macOS TCC 重置命令**（授权卡住时）：

```bash
tccutil reset AppleEvents
tccutil reset Accessibility
tccutil reset ScreenCapture
# 然后删 ~/Library/Application Support/ease-ui 重新跑
```

### 单例锁

`internal/single` 用 flock（Unix）/ LockFileEx（Windows）独占锁。**二次启动会立即报错退出**，不是等 Wails 起来后才报。**已知 trade-off**：`wails dev` hot-reload 也会触发新的 build 进程，因此 dev 模式下热更新需要先 cmd+Q 退出当前实例，开发体验稍差。workaround：用 prod build 测 runtime 变化，或停 dev server 重启。

### 看 Go 端日志

Wails 在 macOS 上把 `wailsruntime.LogInfo` 写到 `~/Library/Logs/<bundle-id>/`，可以用 `Console.app` 或 `log stream --predicate 'subsystem == "com.wails.ease-ui"'` 看。

### IPC 抓包

```bash
# 启动时注入 Wails devtools
wails dev
# 或在生产 build 加 -devtools
wails build -devtools
```

DevTools 里 `window.go` 是 `Proxy`，能列出所有绑定方法。`window.runtime.EventsOn(...)` 可以手动订阅事件。

### 已知问题（v1 未解决）

- 🐛 **生产 build 黑屏**：dev 模式 OK，prod build 启动后 WebView 偶现不渲染 UI。原因排查中（见 `docs/superpowers/plans/2026-06-27-ease-ui.md` Task 44 后续）。workaround：用 `wails dev` 开发，或在 prod 加 `-devtools` flag 复现。
- 🐛 **首次启动 Terminal / iTerm 唤起会弹 TCC** —— 用户没在系统偏好授权。无功能影响，烦人。
- ⚠️ **v1 不支持代理** —— CLI 子进程直连 Anthropic，走不了 HTTP/SOCKS 代理。
- ⚠️ **v1 不做会话并发** —— 一个 session 在 streaming 时不能再发消息，UI 锁住 composer。
- ⚠️ **wails dev hot-reload 受单例锁拖累** —— 见上面"单例锁"小节。

---

## Roadmap

### v1.1（bug fix 优先）

- 解决生产 build 黑屏
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

- [Wails](https://wails.io) — Go + Web 的最佳桥接
- [Claude CLI](https://docs.claude.com/en/docs/claude-code) — 协议定义的事实标准
- [Vue 3](https://vuejs.org) — Composition API 跟 Go functional style 高度契合
- superpowers:subagent-driven-development — 44 个 task 全部按 TDD 走完，commit 历史清晰

## License

MIT
