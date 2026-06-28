# CLAUDE.md

给 Claude / 协作者的 Ease UI 项目协作约定。补充 README 没覆盖的"动手操作"细节。

---

## 全局约定（继承自 ~/.claude/CLAUDE.md）

- **所有回复用简体中文** —— 包括代码注释、commit message、PR 描述。
- **Go 代理**：用 `GOPROXY=https://goproxy.cn,direct`（项目根 `.gitconfig` 或 `go env -w` 持久化）。
- **Git 身份**：每次 commit 前在仓库内执行：
  ```bash
  git config user.name "<name>"
  git config user.email "<email>"
  ```
  不要用全局身份，避免混到工作账号。

---

## 构建命令速查

```bash
# 后端测试（必须全绿再 commit）
go test ./...

# 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 前端 Vite dev server（无 Wails runtime，window.go 是 undefined）
cd frontend && npm run dev

# 全栈开发（推荐）—— Wails 同时拉 Vite + Go
wails dev

# 生产构建
wails build -clean -trimpath -ldflags "-X main.version=v$(date +%Y%m%d)"

# 仅 Go（跳过前端 build，用于快速验证 Go 端编译）
wails build -s

# 跨平台（必须在目标 OS 上）
wails build -platform darwin/universal
wails build -platform windows/amd64
wails build -platform linux/amd64
```

Go 工具链在 `~/go/bin`，PATH 经常没 export：
```bash
export PATH=$PATH:~/go/bin
```

---

## 代码风格

### Go 端

- 单一职责包：每个 `internal/<pkg>` 一个明确边界。`app` 是唯一对前端暴露的 Wails binding 层。
- **永远不要** 在 `internal/app` 之外的包直接 `import` 前端相关的；`app` 是 facade。
- 错误返回 `error` 而不是 panic；前端拿到 `error.message` 弹 toast。
- 并发原语：`sync.RWMutex` 保护 session map / settings，**不要**用 channel 做状态同步（channel 适合事件，不适合共享状态）。
- 测试用 `testify/assert` + `testify/require`，文件名 `<pkg>_test.go`。
- 公共 API 加 godoc；私有 helper 不强求。

### TypeScript 端

- **Typed surface**：`useWails.ts` 是唯一摸 `window.go` 的地方。其他文件 `import { X } from '../composables/useWails'`，**禁止** 直接 `window.go.app.App.X(...)`。
- Pinia store 用 setup style（`defineStore('name', () => { ... })`），不用 options style。
- 路由用 hash mode（`createWebHashHistory`），因为 Wails 是 `wails://` 自定义 scheme，server-side 路由不可用。
- Vue 组件用 `<script setup lang="ts">`，不用 Options API。
- 样式用 CSS 变量（`styles/theme.css`），不要硬编码颜色。
- scoped style：每个组件自己一套 class，不污染全局。

---

## 目录约定

```
ease-ui/
├── main.go              # 单例锁 → app.New → wails.Run
├── app.go               # Wails 配置 + OnStartup/OnShutdown + Bind
├── internal/app/        # 唯一 Wails binding 层，加方法就改这里 + app.go 的 Bind
├── internal/jsonl/      # 读 ~/.claude/projects/*.jsonl + WatchProjects() 自动刷新
├── internal/hookserver/ # 内置 HTTP server 收 Claude hooks + 配 ~/.claude/settings.json
├── internal/instance/   # ~/.ease-app/instance.json 会话状态持久化（30s 防抖写盘）
├── internal/single/     # flock (Unix) / LockFileEx (Windows) 单例锁
├── internal/terminal/   # 跨平台唤起系统终端（mac iTerm2/Terminal.app、win wt/cmd、linux gnome/konsole/xterm）
├── internal/<其他>/     # auth / process / protocol / session / settings / hooks / events / log
├── frontend/src/
│   ├── main.ts          # 启动入口，改这里小心 —— 早期 diag 脚本依赖执行顺序
│   ├── preload.ts       # 模块求值最早一行，**不要** import 任何东西（它要第一个 log）
│   ├── composables/     # useWails（IPC 转发）+ useEventStream（事件订阅，含 sessions:list:changed）
│   ├── stores/          # Pinia，每文件一个 store；sessions 里 formatContent 镜像 Go 端 ContentText()
│   ├── views/           # 路由组件
│   ├── components/      # 复用 UI
│   ├── styles/          # reset.css + theme.css（CSS 变量，dark-pro/light-pro 双主题）
│   └── wailsjs/         # 自动生成，**不要手改**
└── docs/superpowers/    # 设计文档 + 实施计划
```

---

## Wails 相关注意事项

### `//go:embed all:frontend/dist`

`app.go` 里有：
```go
//go:embed all:frontend/dist
var assets embed.FS
```

`all:` 前缀是必须的 —— 否则隐藏文件（`.DS_Store`、`.gitkeep`）会被排除，导致某些平台启动失败。**别去掉。**

### 修改 Go 端 binding 后

每次改 `internal/app/*.go` 加 / 删方法，必须重新跑 `wails generate` 或 `wails dev` / `wails build`，让 `frontend/wailsjs/go/app/App.js` 重新生成。**不要手改这个文件**（顶部注释写着 DO NOT EDIT）。

### 平台差异

| 平台 | WebView | 注意事项 |
|---|---|---|
| macOS | WKWebView | TCC 权限（见下） |
| Windows | WebView2 | Win11 自带，Win10 要装 runtime；高 DPI 缩放有 bug |
| Linux | WebKitGTK | 需要 `libwebkit2gtk-4.0-dev` + `libgtk-3-dev`；headless 环境跑不了 |

### 单例锁 + `wails dev` 的 trade-off

`internal/single` 在 main.go 启动时就抢 flock。**意味着 `wails dev` 的 hot-reload 会失败**：每次 rebuild 都要拉起新进程，新进程抢不到锁，dev server 报 `ease-ui 已在运行` 然后保留旧版。

**开发流程**：
1. 改完 Go 代码 → cmd+Q 退出当前 app → dev server 自动 rebuild + 重启
2. 不想打断 dev session：用 prod binary 测（`wails build && open build/bin/...`）

如果 hot-reload 体验差到影响效率，可以临时把 `app.go` 里的 `single.Acquire()` 注释掉（仅 dev）。**别提交这种临时改动。**

---

## macOS TCC 权限

TCC（Transparency, Consent, and Control）是 macOS 的权限系统。Wails app 启动时如果触发以下行为，会弹系统授权：

- **AppleScript / System Events**（`osascript` 调用）—— `tccutil reset AppleEvents`
- **辅助功能（Accessibility）** —— `tccutil reset Accessibility`
- **屏幕录制（ScreenCapture）** —— `tccutil reset ScreenCapture`
- **完全磁盘访问（Full Disk Access）** —— 系统设置里手动勾

**调试时常用重置：**
```bash
tccutil reset AppleEvents
tccutil reset Accessibility
# 然后删 ~/Library/Application Support/ease-ui 重跑
```

打开系统终端调 `claude -r <sid>` 时 Terminal / iTerm 也会被 TCC 拦一次，无功能影响但烦。

---

## 启动诊断脚本（preload.ts + index.html）

为了排查"黑屏 / 启动卡死"问题，v1 阶段在两处加了诊断日志。**生产 build 也保留** —— 现场排查用户机器时很有用。

### `frontend/index.html` 头部 inline 脚本

`<head>` 里有一段同步 IIFE，做四件事：

1. 创建一个紫色 `earlyDbg` div（top:0, z-index:99999）显示时间戳日志
2. 设 `window.__earlyLog(m)` 给后面模块用
3. 起一个 `setInterval`（HB 心跳，每 500ms 打一次）确认 JS event loop 还活着
4. 监听 `window.error` + `unhandledrejection` 自动写堆栈

**读屏**：紫色 div 出现 + HB#1 列出 `<script>` + 后续 HB#N 持续打 = HTML 解析正常。HB 停掉 = event loop 卡死。

### `frontend/src/preload.ts`

模块求值**最早一行**就 `__earlyLog('PRELOAD: ...')`。它必须是 main.ts 第一个 `import`，因为 ES module 的 import 会在所有顶层代码前执行。

### `frontend/src/main.ts`

`status()` 写到底部绿色 `dbg` div。配合 main.ts 顶部的 try-catch，能看到每一步走到哪：

| 日志 | 含义 |
|---|---|
| `main.ts loaded` | 模块求值完成 |
| `window.go=true ...` | Wails runtime 已注入 |
| `pinia installed` / `router installed` | Vue plugin 安装完成 |
| `auth.initPromise created, awaiting...` | 第一次 IPC round trip 发出 |
| `auth.initPromise resolved => true` | Go 端响应回来 |
| `mounting #app` / `mounted, initial route: ...` | Vue 挂载成功，初始路由 |

### 故障排查表

| 现象 | 卡点 |
|---|---|
| 紫 div 出现，HB 跑，但 preload log 缺失 | main.ts 模块求值没到 `import './preload'` —— 检查 Vite build 输出，循环依赖，或 hash 跟 embed FS 不一致 |
| 紫 div + preload + `main.ts loaded`，但之后无日志 | `createApp` 之前某 import 抛了 — 看 `window.error` 监听 |
| 出现 `router installed`，但 `auth.initPromise` 之后停 | XPC 响应没回来 —— TCC 没授权，或 `internal/app` 的 `IsInitialized` panic |
| 全部 log 走完但 `#app` 是空的 | `app.mount('#app')` 之后 router-view 没匹配上路由 —— 检查 `router.currentRoute.value.fullPath` |

清理诊断代码的时机：**所有"v1 用户能跑通"的场景都验证完**之后。诊断代码现在留着是有意为之。

---

## 提交规范

- 一个 task 一个 commit，commit message 用英文（或中文，看你自己），格式：
  ```
  <type>: <subject>
  
  <body - why, not what>
  ```
  type: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`。
- 任何 commit 前跑 `go test ./...` + `npx vue-tsc --noEmit`，全绿再 commit。
- 改 `internal/app/*.go` 加 binding → 同步 commit `frontend/wailsjs/go/app/App.js`（Wails 自动生成）。
- 改 `frontend/src/preload.ts` / `index.html` 的 diag 代码 → 在 commit message 写明 **临时**，避免别人误以为是有意保留。

---

## 已知坑（v1 未解决）

1. **生产 build 黑屏**：dev 模式 OK，prod 偶现 WebView 不渲染。workaround：`wails dev` 或加 `-devtools` 复现。
2. **首次唤起 Terminal / iTerm 弹 TCC** —— Terminal/iTerm TCC 授权。无功能影响，烦人。
3. **v1 不支持代理** —— CLI 子进程直连。
4. **v1 单 session 不并发** —— streaming 时 composer 锁住。
5. **wails dev hot-reload 受单例锁拖累** —— 见上面"单例锁 + wails dev 的 trade-off"小节。
6. **v1 历史 session 切换延迟** —— 用户切到一条 Ease UI 启动前已存在的 session，第一次发消息时走 `AdoptSession` 懒启进程 + 写 envelope，可感知的延迟比新建 session 长一点（~300ms）。

---

## v1 已修复的坑（变更前要查 git log / commit message）

- **stream-json 写入必须用 envelope**：`session.Session.Send` / `SwitchOwner` 都走 `envelopeUserMessage` 写 `{"type":"user","message":{"role":"user","content":prompt}}\n`。Claude CLI stream-json 模式只接受 envelope 格式，**裸文本会被解析器直接丢弃**——这是 v1 "Send 写完没反应" 的根因，commit `e097c64` 修了。
- **Session ID 由 Claude 生成**：`CreateSession` 用 `process.ModeAuto` 启进程（**不带** `--session-id` / `--resume`），阻塞等 SessionStart hook 返回真实 UUID（15s 超时）。Ease UI 不再 `newID()`——之前自己生成的 16-char hex 会被 Claude 拒绝 `Invalid session ID. Must be a valid UUID`。commit `dae650e` 改的。
- **SessionStart 走 command 脚本**：Claude 不支持 HTTP 类型的 SessionStart hook，必须用 `command` + 脚本（macOS/Linux 写 `~/.ease-app/session-start.sh`、Windows 写 `session-start.ps1`）。其他 12 类 hook（PreToolUse / PostToolUse / SessionEnd 等）走 HTTP POST。commit `06c1179` 改的。
- **HookEvent 字段名**：Claude command hook 的 JSON 字段是 `hook_event_name`（**不是** HTTP hook 用的 `type`）。`hookserver.HookEvent.HookEventName` 字段 + `EventType()` 方法兼容两种格式，commit `a260653` 改的。
- **SessionStart 误标记 Ease UI 自己的 session 为外部终端**：`handleHookEvent` 收到 SessionStart 时检查 `owner.value[sid] !== 'app'` 才标记为 terminal；Ease UI `CreateSession` 新建的 session 不会被外部 hook 覆盖 owner。commit `7859f32` 改的。
- **`--session-id` vs `--resume`**：jsonl 已存在的 sid 必须用 `--resume`（`ModeResume`）；只有全新 sid 才用 `--session-id`（`ModeNew`）。已 ended 的 jsonl 用 `--session-id` 会让 claude 立即 DEAD，导致历史 session 发送被静默吞掉。commit `948898d`（AdoptSession）落地。

详细见 `README.md` 调试技巧 + 已知问题。

---

## 协作者提醒

- **别在 main.go / app.go 加 panic** —— Wails 的 panic 会被 runtime 吞掉，前端只会看到黑屏。
- **别在 frontend 直接 `window.go.app.App.X(...)`** —— 走 `useWails` 才有类型检查。
- **别在 `internal/app` 之外的包 import Wails** —— 保持 binding 层单点。
- **改 binding 必须重新跑 Wails build** —— 否则 `wailsjs/go/app/App.js` 是旧的。
- **任何 `os/exec` 调用都要带 context** —— `cmd.Run()` 没法取消，`exec.CommandContext(ctx, ...)` 才行。
- **路径有两套**：`~/.ease-app/` 存 auth/settings/instance/logs（用 `os.UserHomeDir`）；`~/Library/Application Support/ease-ui/` 存单例锁（用 `os.UserConfigDir`，per-user 唯一性）。**别混**，前者随用户走，后者跟系统配置。
- **fsnotify watcher 启动失败不要 panic** —— `App.startWatcher()` 出错时静默 return，主流程照常；用户可能没 `~/.claude/projects` 目录。
- **Pinia ref<Record<K, V>> 的更新要用 spread 整体替换** —— `state.value = { ...state.value, [id]: v }`，不要 `state.value[id] = v`，否则 Vue 不会触发响应。
- **前端 `formatContent` 必须和 Go 端 `ContentBlock.ContentText()` 保持同步** —— 改一边要同时改另一边。两者功能等价，前端做展示格式化，Go 做 binding 字段（如果将来要加 `Text` 字段的话）。
- **Owner 切换（`SwitchOwner`）走 `session.SwitchLock()`，不抢 `Send/RespondPermission` 用的 `mu`** —— 避免切换时阻塞 prompt 写入；切换期间其他 Send 会被 short-block，500ms 内完成。
- **stream-json 写入必须用 envelope**：`Send` / `SwitchOwner` 都走 `envelopeUserMessage` 写 `{"type":"user","message":{"role":"user","content":prompt}}\n`。Claude CLI stream-json 模式只接受 envelope 格式，**裸文本会被解析器直接丢弃**。改 Send 路径要保持 envelope 不变（commit `e097c64` 修过一次）。
- **SessionStart hook 不能被外部 SessionStart 覆盖 Ease UI 的 owner**：前端 `handleHookEvent` 收到 `SessionStart` 时只标记 `owner=terminal`，前提是 `owner.value[sid] !== 'app'`。Ease UI `CreateSession` 新建的 session 由 Go 端走真实 UUID，`owner` 在 store 里默认是 `'app'`，hook 来了不会被覆盖成 terminal。如果改了 `handleHookEvent` 的 SessionStart 分支，必须保持这个保护，否则 Ease UI 自己创建的 session 会显示成「外部终端中」+ input 切换成 SwitchOwner 模式。

---

## 相关文档

- `README.md` —— 项目总体介绍 + 架构图 + 数据流 + 已知问题
- `docs/superpowers/specs/2026-06-27-ease-ui-design.md` —— 设计决策
- `docs/superpowers/plans/2026-06-27-ease-ui.md` —— 44 个 task 的实施历史
- 协作者入门先看 README → 然后跑 `wails dev` → 改 `frontend/src/views/HomeView.vue` 的 `displayName` 看到 UI 变化就算通了。
