# Lynel Desktop — 设计文档

**日期**: 2026-06-27
**作者**: Brainstorming session
**状态**: 待用户审阅

## 1. 概述

Lynel Desktop 是一个跨平台桌面 App（macOS / Linux / Windows），用于管理本地 Claude Code 会话。它是 Claude CLI 的 GUI 包装，提供：

- 集中查看所有 Claude 会话（左侧列表 + 右侧详情）
- 双向交互：在 App 内发送 prompt、流式接收响应
- 拦截并处理 `PermissionRequest`
- 一键 `claude -r <session-id>` 跳到系统终端继续
- 读取 + 编辑 Claude 的 `~/.claude/settings.json` 中的 Hook 配置
- 本地账户密码保护（账户 = 系统用户名，密码 = 用户设置）

## 2. 范围（v1）

### 2.1 在范围内

- **鉴权**：本地账户 + 密码（3 次错误锁定 5 分钟）
- **会话列表**：扫描 `~/.claude/projects/*/` 下的所有 `.jsonl`
- **会话内容**：解析 jsonl，按消息/工具调用/权限请求分类展示
- **双向交互**：为每个活跃 session 维护一个 `claude` 子进程
- **流式输出**：通过 `stream-json` 协议实时推送
- **PermissionRequest 拦截**：可在 App 内批准/拒绝
- **「自动允许命令执行」开关**：开启时 Bash 工具直接放行（App 内存决策，不动 Claude settings）
- **「打开终端」按钮**：调起系统终端执行 `claude -r <session-id>`
- **Hook 配置 Tab**：可编辑 `~/.claude/settings.json` 中的 hooks
- **设置页（3 tab）**：Hook 配置 / 通用 / 云服务（占位）
- **云服务 v1**：仅 UI 占位，配置写本地 `~/.lynel-desktop/config.json`，不连云端
- **三平台窗口控制**：完全自定义标题栏（min/max/close）

### 2.2 不在范围内（v1 不做）

- Claude 账户 OAuth 认证
- 多账户切换
- 会话跨设备同步 / 远程访问（云服务 v2）
- 自动更新
- 代码签名 / 公证
- AppImage / Flatpak 打包
- i18n（v1 仅简体中文）

## 3. 用户旅程

### 3.1 启动

1. 启动 App
2. 读取 `auth.json`：
   - 存在 → 解锁页（见 § 3.2）
   - 不存在 → **未初始化页**（见 § 3.1a）
3. 登录成功 → 跳主页

### 3.1a 未初始化（v1 不做首次设置 UI）

- `auth.json` 不存在时显示：**"Ease 未初始化"** + 提示 `运行 lynel-desktop init 设置账户密码` + 退出按钮
- 初始化走 CLI 命令 `lynel-desktop init`（在终端里执行）：
  - 提示输入密码 + 确认
  - bcrypt 存到 `~/.lynel-desktop/auth.json`，权限 0600
  - 同时写默认 `~/.lynel-desktop/config.json`
- 文档提供 `lynel-desktop init` 用法
- v1 **不**做"App 内引导设置密码"流程（避免与登录页 UI 重复）

**CLI init 的实现**：
- `lynel-desktop` 二进制启动时检查 `os.Args`：
  - `lynel-desktop init` → 走 init 流程（无 GUI，纯 stdin/stdout）
  - 无参数 → 走 Wails GUI 启动
- 同一二进制，模式分发；不需要单独的可执行文件
- 子命令路由放在 `main.go`（薄壳，调用 `internal/cli` 或 `internal/app.InitCLI()`）

### 3.2 解锁（已初始化）

1. 启动 App
2. 显示登录页（用户名预填系统用户名）
3. 用户输入密码 → 验证 → 跳主页

### 3.3 错误 3 次

1. 登录页提示"密码错误"
2. 3 次后锁定 5 分钟，倒计时显示在密码框下方
3. 锁定结束后可重试

### 3.4 主页操作

- **创建会话**：点击左侧 `+` → 弹窗（工作目录 + prompt）→ 后端启动 `claude` 子进程 → 左侧出现新会话
- **切换会话**：点击左侧项 → 右侧显示该会话历史
- **发送消息**：右侧底部输入框 → 发送到对应子进程
- **接收响应**：子进程 stdout 通过 `stream-json` 协议解析 → 事件总线 → 前端 reactive 更新
- **权限请求**：消息区出现权限面板 → 用户点 Allow / Deny → 转发到子进程
- **打开终端**：右上角 `›_ 打开终端` 按钮 → 系统终端执行 `claude -r <session-id>`
- **查看会话详情**：hover 左侧会话项 → 右侧弹出 tooltip（Session ID / 工作目录 / 时间 / 消息数 / 工具数 / 文件大小）
- **进入设置**：左下角 ⚙ → 设置页（3 tab）

## 4. UI 设计

### 4.1 主题

- **背景**: `#0A0A0A`（主）、`#121212`（面板）
- **强调色**: `#7C3AED`（蓝紫）、`#A78BFA`（浅紫文字）
- **文字**: `#E0E0E0`（主）、`#888`（次要）、`#666`（辅助）
- **状态色**: `#10B981`（成功/运行）、`#F59E0B`（警告/等待权限）、`#E11D48`（错误）
- **代码字体**: JetBrains Mono, 13px

### 4.2 窗口

- 所有平台：完全自定义标题栏
  - 左侧：Ease logo + 品牌名 + UI 标签
  - 右侧：min / max / close 三个按钮
- macOS：原生交通灯隐藏
- Windows / Linux：所有控制自绘
- 拖拽：CSS `-webkit-app-region: drag`

### 4.3 登录页

- 窗口尺寸：460px 宽
- 顶部居中：logo + "登录 Ease" 标题
- 表单：用户名输入框（预填系统用户名，可改）+ 密码输入框
- 错误提示：仅一行"密码错误" / "用户不存在"（不显示剩余次数）
- 锁定状态：输入框禁用 + 倒计时
- 右上角 ⚙ → 跳设置页（无需登录）

### 4.4 主页

```
┌─────────────────────────────────────────────────────────────┐
│ ⬢ Lynel Desktop                                  ─ ▢ ✕            │  ← 标题栏
├──────────┬──────────────────────────────────────────────────┤
│ 会话  +  │ ▶ lynel-desktop 设计  /Users/akke/project/lynel-desktop  ›_  │  ← 工具栏
│          ├──────────────────────────────────────────────────┤
│ ● 会话A  │                                                  │
│ ○ 会话B  │  [消息区：用户消息 / Claude 响应 / 工具调用块]   │
│          │                                                  │
│          ├──────────────────────────────────────────────────┤
│          │ [输入框]  [发送]                                  │
├──────────┤                                                  │
│ 👤 用户  │                                                  │
│ v0.1.0 ⚙ │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

- 左侧 280px，会话列表，hover 显示详情 tooltip
- 用户栏底部显示 `用户名 v0.1.0` + 设置按钮
- 右侧内容区顶部显示当前会话路径 + "打开终端"按钮
- 输入区有"发送"按钮（**不**放"打开终端"按钮，只在顶部工具栏）

### 4.5 设置页（3 tab）

#### Tab 1: Hook 配置

- 顶部显示 `~/.claude/settings.json` 路径 + 加载状态
- 按事件类型分组：PreToolUse / PermissionRequest / PostToolUse / Notification / Stop
- 每组显示已配置的 hook（command + matcher）
- 操作：添加（弹表单）/ 编辑 / 删除 / 保存（写回 settings.json + 备份 .bak）
- 表单字段：event 下拉、matcher（可选）、command 文本、type 单选（shell/python）

#### Tab 2: 通用

- 主题（下拉，v1 锁"深色专业"）
- 自动允许命令执行（开关 + 说明 callout：仅对 Bash 工具，askuserquestion 仍需用户确认）
- 日志开关（开关）
- Claude CLI 路径（输入框，留空用 PATH）
- 自动锁定超时（下拉：1/5/10/30/60 分钟 / 关闭）
- 启动时自启（开关）
- 启动时最小化（开关）
- 保存 / 取消 / 清除账户密码按钮

#### Tab 3: 云服务（v1 占位）

- 启用开关（开启可保存，但不实际连云）
- 服务地址（输入框，可填可保存）
- 鉴权 Token（密码输入框）
- 连接状态：永远显示"未连接（v1 暂未启用）"
- 保存 / 测试连接（点测试返回"v1 暂不支持"） / 取消

## 5. 架构

### 5.1 高层结构

Wails 桌面 App + Vue 3 前端 + Go 后端分层。

```
┌──────────────────────────────┐
│  Frontend (Vue 3 + Pinia)    │
│  Views / Components / Stores │
└──────────┬───────────────────┘
           │ Wails JSON-RPC bridge
           │ (Bindings) + EventsEmit
┌──────────▼───────────────────┐
│  internal/app (Wails Bindings)│  ← 唯一对外接口
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  Domain packages             │
│  session / process /         │
│  protocol / jsonl / hooks /  │
│  terminal / auth / settings  │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  Infrastructure              │
│  events bus / log / fsnotify │
└──────────────────────────────┘
           │
           │ os/exec
           ▼
       claude CLI 子进程
```

### 5.2 关键设计原则

- **单源真相 = jsonl 文件**。App 内存中只缓存视图，不复制状态。
- **App 绑定层（internal/app）是 Go 暴露给前端的唯一入口**。业务逻辑在内部包，不直接绑给前端。
- **事件流单向**：Claude CLI → protocol → events bus → app.EventsEmit → 前端 store。
- **session 是核心领域对象**，关联一个 process 实例和一个 jsonl 文件路径。

## 6. 数据流

### 6.1 启动流程

```
App 启动
  │
  ├─ auth.LoadConfig() → 读 ~/.lynel-desktop/auth.json
  │     ├─ 不存在 → 显示"未初始化"页（见 § 3.1a）
  │     └─ 存在 → 跳登录页
  │
  ├─ 解锁成功
  │
  ├─ settings.Load() → 读 ~/.lynel-desktop/config.json
  │
  ├─ jsonl.ScanAll() → 扫描 ~/.claude/projects/*/ 列出所有 .jsonl
  │     对每个 jsonl:
  │       ├─ fsnotify.Watch() 监听文件变化
  │       └─ 解析为 SessionMeta {id, workdir, mtime, msgCount, firstPrompt}
  │
  ├─ hooks.LoadSettings() → 读 ~/.claude/settings.json
  │     解析为 HookConfig {preToolUse, permissionRequest, postToolUse, ...}
  │
  └─ session.Register() → 内存建立 Session 视图对象
       状态全部初始为 Idle（不启动任何子进程）
```

### 6.2 消息发送

```
前端 app.SendMessage(sessionID, prompt)
  │
  ▼
session.Get(sessionID)
  │
  ├─ 状态 == Idle 且 process 未启动 → process.Start(workDir, sessionID, claudePath)
  │     │
  │     ├─ 查找 Claude CLI（settings.ClaudePath 或 PATH）
  │     ├─ exec.Command("claude", "--cwd", workDir, "--session-id", sessionID, "--output-format", "stream-json")
  │     ├─ 把 stdout line-buffered 接到 protocol.Parser goroutine
  │     └─ 把 stderr 接到 logger（如果 settings.LogEnabled）
  │
  ▼
session.SetState(Running)
  │
  ▼
process.WriteStdin(prompt + "\n")
  │
  ▼
返回（响应通过事件异步推回）
```

### 6.3 消息接收

```
claude 子进程 stdout
  │ (line-buffered JSON)
  ▼
protocol.Parser.Parse(line) → Event
  │
  ├─ type=message         → events.Broadcast(MessageEvent)
  ├─ type=tool_use        → events.Broadcast(ToolEvent)
  ├─ type=tool_result     → events.Broadcast(ToolResultEvent)
  ├─ type=permission_request
  │     └─→ hooks.Handle(req)         // 见 §6.4
  ├─ type=result          → session.SetState(Idle)
  └─ type=error           → events.Broadcast(ErrorEvent)
  │
  ▼
events bus (Go channel, 订阅模式)
  │
  ▼
app.EventsEmit("session:event", payload)
  │
  ▼
前端 Pinia store 自动 reactive 更新
```

### 6.4 PermissionRequest 拦截

```
protocol 解析出 type=permission_request
  │
  ▼
hooks.Handle(req) → 决策
  │
  ├─ 读 settings.AutoAllowBash() ← 来自 ~/.lynel-desktop/config.json
  │
  ├─ if AutoAllowBash && req.tool == "Bash":
  │     decision = "allow"
  │     log("auto-allowed bash command")
  │
  └─ else:
        ├─ events.Broadcast(PermissionRequestEvent{sessionID, requestID, tool, args})
        ├─ 挂起到 session.pending[requestID]
        └─ 等待 app.RespondPermission(sessionID, requestID, decision)
              │
              ├─ 用户点 Allow → decision = "allow"
              ├─ 用户点 Deny  → decision = "deny"
              └─ 转发 process.WriteStdin(decision response)
  │
  ▼
process 继续执行 / 中止
```

**关键约束**：App 自己拿决策，**不修改** `~/.claude/settings.json`（区别于配置式方案）。

### 6.5 Hook 配置编辑

```
用户在 Hook Tab:
  ├─ 「添加 hook」 → 弹表单 {event, matcher, command, type}
  ├─ 「编辑」 → 弹同一表单
  ├─ 「删除」 → 列表行 × 按钮
  └─ 「保存」 → 写回 ~/.claude/settings.json
        │
        ▼
      hooks.Editor.Save(cfg)
        │
        ├─ 读取现有 settings.json（保留未识别的字段）
        ├─ JSON marshall 修改后的 HookConfig
        ├─ 备份为 settings.json.bak（最多保留 5 个）
        ├─ atomic write (tmp + rename)
        └─ 通知 hooks 包 reload 内存缓存
```

## 7. 状态机

```
        Send(prompt)         permission req        response
   ┌──────────────┐       ┌──────────────┐     ┌──────────────┐
   │              ▼       │              ▼     │              ▼
Idle ──────→ Running ────→ AwaitingPermission ────→ Running ───→ Idle
   ▲         (Bash + auto)                              │
   │              │                                    │
   │              └────── 直接 allow，不进 Awaiting ───┘
   │
   └────────────────── result event ───────────────────────
```

- `AwaitingPermission` 期间收到新 prompt → **拒绝并提示「请先响应权限请求」**（不排队）。

## 8. 关键模块接口

```go
// session/session.go
type Session struct {
    ID      string
    Meta    SessionMeta
    WorkDir string
    State   State  // Idle | Running | AwaitingPermission
    process *process.Process
    pending map[string]PermissionRequest
    mu      sync.RWMutex
}

func (s *Session) Send(prompt string) error
func (s *Session) Close() error
func (s *Session) RespondPermission(reqID string, allow bool) error

// process/process.go
type Process struct {
    cmd    *exec.Cmd
    stdin  io.WriteCloser
    events chan protocol.Event
    done   chan struct{}
}

func Start(workDir, sessionID, claudePath string) (*Process, error)
func (p *Process) Write(s string) error
func (p *Process) Close() error

// protocol/parser.go
type Event struct {
    Type    string          // message | tool_use | tool_result | permission_request | result | error
    Session string
    Data    json.RawMessage
}

func Parse(line []byte) (Event, error)

// hooks/handler.go
type Handler struct {
    cfg *Config
}

func (h *Handler) Handle(req PermissionRequest) Decision
func (h *Handler) SetAutoAllowBash(bool)

// hooks/editor.go
type Editor struct{}

func (e *Editor) Load() (*Config, error)
func (e *Editor) Save(cfg *Config) error  // atomic + backup

// jsonl/scanner.go
func ScanAll() ([]SessionMeta, error)
func Watch(id string, onChange func()) error
func ParseFile(path string) ([]Message, error)

// auth/auth.go
func (a *Auth) Verify(password string) error
func (a *Auth) LockoutState() (attempts int, until time.Time)
func (a *Auth) SetPassword(newPassword string) error

// settings/settings.go
type Config struct {
    Theme             string
    ClaudePath        string
    AutoAllowBash     bool
    LogEnabled        bool
    AutoLockMinutes   int
    AutoStart         bool
    MinimizeOnStart   bool
    CloudServiceEnabled bool
    CloudServiceURL   string
    CloudServiceToken string
}

func Load() (*Config, error)
func Save(*Config) error
```

## 9. 错误处理

### 9.1 错误分类

| 类别 | 含义 | 处理方式 | UI 表现 |
|---|---|---|---|
| **致命** | App 无法继续运行 | 清理状态、退出 | 全屏错误页 + "退出" / "查看日志" |
| **可恢复** | 单次操作失败，可重试 | 重试 / 回滚 / 降级 | 顶部 toast + 操作行内提示 |
| **静默** | 后台问题，不影响主流程 | 自动重试 / 记录 | 仅写日志，不打扰用户 |

### 9.2 具体场景

**致命**：
- `~/.lynel-desktop/config.json` 损坏无法解析 → 备份重命名为 .bak
- Wails 运行时初始化失败 → 启动页显示错误堆栈
- 多端同时修改 settings.json 导致 lock 冲突 → 提示用户重启

**可恢复**：
- 启动 Claude 子进程失败（CLI 不在 PATH） → toast「请在设置中配置 Claude CLI 路径」
- 子进程异常退出（非 0 退出码）→ 状态置 Idle，消息区显示「连接中断」
- jsonl 解析某一行失败 → 跳过该行，日志记 warn
- 写入 settings.json 失败 → 弹窗「保存失败：[原因]」+ 「重试」+ 「取消」
- fsnotify 句柄耗尽 → 退化为轮询模式（30s 间隔）

**静默**：
- 单个 jsonl 文件不存在（被外部删除）→ 从列表移除
- 协议解析遇到未知 type 字段 → 跳过该行

### 9.3 错误传播

```
底层错误 (os/exec, fsnotify, json)
  │
  ▼
领域错误 (typed error, e.g. ErrClaudeNotFound)
  │
  ▼
app 层 (Wails binding) 包装成 user-friendly message
  │
  ├─ fatal   → app.EventsEmit("app:fatal", {...}) + os.Exit(1)
  ├─ recoverable → app.EventsEmit("app:toast", {level, message, action})
  └─ silent  → logger.Warn(...)
```

**关键原则**：
- 底层错误绝不直接 return 给前端
- 错误信息要"可行动"
- 每个错误有唯一 code（`E_CLAUDE_NOT_FOUND`），方便 i18n 和日志聚合

### 9.4 日志

| 级别 | 路径 | 内容 |
|---|---|---|
| Info  | `~/.lynel-desktop/logs/info.log` | 会话创建/关闭、设置变更 |
| Warn  | `~/.lynel-desktop/logs/warn.log` | jsonl 跳过行、协议未知字段 |
| Error | `~/.lynel-desktop/logs/error.log` | 子进程退出、文件 IO 失败 |
| 子进程 | `~/.lynel-desktop/logs/sessions/<sid>.log` | Claude CLI 原始输出（仅 LogEnabled） |

轮转：单文件 10MB，保留 3 个备份。

## 10. 项目结构

```
lynel-desktop/
├── README.md
├── go.mod
├── go.sum
├── wails.json
├── main.go
├── build/
│   └── appicon.png
│
├── internal/
│   ├── app/                # Wails 绑定层
│   ├── session/            # 会话领域
│   ├── process/            # Claude CLI 子进程
│   ├── protocol/           # stream-json 协议
│   ├── jsonl/              # jsonl 文件
│   ├── hooks/              # Hooks 处理 + 编辑
│   ├── terminal/           # 系统终端调用
│   ├── auth/               # 鉴权
│   ├── settings/           # Ease 自身配置
│   ├── events/             # 事件总线
│   └── log/                # 日志
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/
│   │   ├── stores/         # Pinia
│   │   ├── views/          # Login / Home / Settings
│   │   ├── components/     # TitleBar / SessionList / MessageBubble / ...
│   │   ├── composables/    # useWails / useEventStream / useWindow
│   │   ├── styles/         # theme.css / reset.css
│   │   └── types/
│   └── tests/
│
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-06-27-lynel-desktop-design.md   # 本文档
│
└── .github/
    └── workflows/
        └── ci.yml          # test + lint（无 release）
```

## 11. 技术栈

### 11.1 后端（Go）

- Go 1.22+
- Wails v2
- `github.com/fsnotify/fsnotify`
- `golang.org/x/crypto/bcrypt`
- `gopkg.in/natefinch/lumberjack.v2`（日志轮转）
- `github.com/stretchr/testify`（测试）

### 11.2 前端（Vue 3）

- Vue 3.4+ / TypeScript 5 / Vite 5
- Pinia 2
- Vue Router 4
- Vitest + Vue Test Utils（测试）
- Playwright（E2E）
- ESLint

### 11.3 故意不引入

- Tailwind（CSS 变量够用）
- Element Plus（设计定制度高，组件自己写）
- Lodash
- Axios（只用 Wails 绑定）

## 12. 配置文件位置

| 文件 | 路径 | 权限 | 内容 |
|---|---|---|---|
| Ease 配置 | `~/.lynel-desktop/config.json` | 0600 | 主题、CLI 路径、AutoAllowBash、LogEnabled、云服务占位 |
| 鉴权 | `~/.lynel-desktop/auth.json` | 0600 | bcrypt hash + salt + lockout 状态 |
| 日志 | `~/.lynel-desktop/logs/*.log` | 0644 | 滚动日志 |
| 子进程日志 | `~/.lynel-desktop/logs/sessions/<sid>.log` | 0644 | CLI 原始输出 |
| Hook 配置（**读写**） | `~/.claude/settings.json` | 跟 Claude 共享 | 由 hooks.Editor 写回 |
| 会话数据（**只读**） | `~/.claude/projects/*/<sid>.jsonl` | 跟 Claude 共享 | 事实源 |

**关键约束**：
- 写 `~/.claude/settings.json` 前备份为 `settings.json.bak`（最多保留 5 个）
- 不修改 `~/.claude/projects/` 下任何文件
- 所有 Ease 自身文件统一在 `~/.lynel-desktop/`，方便卸载清理

## 13. 打包与发布

### 13.1 本地打包（**不依赖 CI**）

```bash
# 日常开发
wails dev

# 打 release（每个平台在自己的机器上）
wails build -clean -trimpath \
  -ldflags "-X main.version=v0.1.0"
```

| 平台 | 产物 | 命令 |
|---|---|---|
| macOS | `.app` | `wails build -platform darwin/universal` |
| Windows | `.exe` | `wails build -platform windows/amd64` |
| Linux | 二进制 | `wails build -platform linux/amd64` |

### 13.2 跨平台说明

- **macOS 包** 必须在 Mac 上打（Cocoa/AppKit 链接 + Gatekeeper 限制）
- **Windows 包** 在 Windows 上直接打
- **Linux 包** 在 Linux 上 / Docker 上打（`tonistiigi/wails-build` 镜像）
- 跨平台不需要 GitHub Actions

### 13.3 窗口控制实现

- 所有平台：`runtime.WindowMinimise / ToggleMaximise / Quit`（Wails runtime）
- macOS：`OnStartup` 设置 `TitleBar.Hide()` + 自绘；最大化/还原手写 `EnterExitFullScreen` 调用
- Windows / Linux：完全自定义，所有控制自绘
- 拖拽：CSS `-webkit-app-region: drag` + Wails draggable region

### 13.4 版本号注入

- Makefile / 手工命令通过 `-ldflags "-X main.version=$(git describe)"` 注入到 `main.go`
- 登录页 / 设置页 / 关于页读取 `runtime.version`（编译时常量）

### 13.5 代码签名（v1 不做）

- macOS：developer ID + notarize 跳过
- Windows：EV 证书跳过
- Linux：只发布二进制 + .desktop

## 14. 测试策略

### 14.1 后端（Go）—— TDD，每个包先写测试

| 包 | 测试类型 | 关键场景 |
|---|---|---|
| `protocol` | 单元 | 各 Event 类型 Parse、错误行不 panic |
| `jsonl` | 单元 + 集成 | 标准格式解析、跳过坏行、大文件（>10MB）流式 |
| `process` | 单元（mock exec） + 集成（真 claude CLI） | 启动、stdin 写入、退出检测 |
| `session` | 单元（mock process） | 状态机转移、pending map、并发安全 |
| `hooks` | 单元 | AutoAllowBash 决策、editor 写回不破坏其他字段 |
| `auth` | 单元 | bcrypt 验证、锁定计数、并发安全 |
| `settings` | 单元 | 读写、并发、损坏恢复 |
| `events` | 单元 | 订阅/取消订阅、channel 满行为 |
| `terminal` | 单元 | 各平台命令构造（mock exec） |

### 14.2 前端（Vue 3）

- 组件测试（Vitest）：消息气泡、permission 面板、设置表单
- store 测试（Pinia）：session 列表、消息列表 reactive 更新
- E2E（手动 + Playwright 关键路径）：登录 → 主页 → 创建会话 → 发送消息

### 14.3 关键场景手测清单（v1 发布前必过）

1. 首次初始化：运行 `lynel-desktop init` → 设置密码 → 启动 App → 主页
2. 重启：关闭 App 再开 → 登录页 → 输入密码 → 主页
3. 扫描现有 jsonl：列表正确
4. 创建新会话：弹窗 → 输入 → 启动子进程 → 发送 → 收到响应
5. 权限请求：弹出 → 允许/拒绝 → 继续
6. 自动允许 Bash：开关切换后再发 Bash 不弹
7. 修改 Hook 配置：添加 → 保存 → 重启验证写入
8. 三平台窗口控制：min/max/close 正常
9. 错误 3 次 → 锁定 5 分钟

### 14.4 CI（可选）

- GitHub Actions `ci.yml`：`go test ./...` + `pnpm test` + `golangci-lint` + `eslint`
- **不**包含 release workflow（打包完全本地）

## 15. 关键设计权衡

| 选择 | 理由 |
|---|---|
| 完整 CLI 包装（vs 只读查看器） | 用户在 App 内可直接对话，体验闭环 |
| jsonl 单源真相 | 不会与 CLI 实例状态分裂；重启自动恢复 |
| Hook 可编辑（vs 只读） | App 内统一管理配置，但需小心备份/原子写 |
| 自动允许命令执行 = App 静默放行 | 不动 Claude settings，避免外部副作用 |
| 自定义标题栏三平台 | 用户明确要求；macOS 全屏行为需手写 |
| 不引入 Tailwind / UI 库 | 设计定制度高，组件自己写更可控 |
| 本地打包不依赖 CI | 用户明确要求；Mac 必须 Mac 打 |
| 云服务 v1 占位 | 保留 UI 入口，v2 接入 |
| 不做 i18n | v1 范围限定，结构留好 |

## 16. 后续（v2 候选）

- 云服务接入（会话同步、远程访问）
- Claude 账户 OAuth
- 多账户切换
- 会话标签 / 搜索 / 收藏
- i18n
- AppImage / Flatpak
- 自动更新
- 代码签名
