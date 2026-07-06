# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 全局约定

- 所有回复用简体中文（包括代码注释、commit message、PR 描述）。
- Go 代理：`GOPROXY=https://goproxy.cn,direct`。
- 每次 commit 前在仓库内设置 local git identity，不要依赖全局身份：
  ```bash
  git config user.name "<name>"
  git config user.email "<email>"
  ```
- 不要提交构建产物、诊断文件或运行时垃圾（如 `.claude/`、`build/bin/`、`*-err.log`、临时 `.cmd`、`.exe` 等）。

---

## 常用命令

```bash
# 后端测试（commit 前必须全绿）
go test ./...
go test ./internal/terminal -run TestNewExecCmd_StartUsesRawCmdLine -v

# 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 前端 Vite dev server（无 Wails runtime，window.go 是 undefined）
cd frontend && npm run dev

# 全栈开发（推荐）
wails dev

# 生产构建
wails build -clean -trimpath -ldflags "-X main.version=v$(date +%Y%m%d)"

# 仅 Go 后端快速验证
# Go 1.26.3 + Wails v2.12.0 在当前环境生成 bindings 会失败，推荐加 --skipbindings
wails build -s --skipbindings

# 跨平台打包（必须在目标 OS 上执行）
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

### Go
- 单一职责包：每个 `internal/<pkg>` 有明确边界；`internal/app` 是唯一对前端暴露的 Wails binding 层。
- 永远不要在 `internal/app` 之外的包直接 import 前端或 Wails runtime。
- 错误返回 `error`，不要 panic；Wails 的 panic 会被 runtime 吞掉，前端只会看到黑屏。
- 共享状态用 `sync.RWMutex`，不要用 channel 做状态同步。
- 测试用 `testify/assert` + `testify/require`，文件名 `<pkg>_test.go`。

### TypeScript
- `useWails.ts` 是唯一接触 `window.go` 的文件；其他文件必须 `import { X } from '../composables/useWails'`。
- 禁止直接 `window.go.app.App.X(...)`。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`；路由用 hash mode。
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色。
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用；禁止在界面里用 emoji / Unicode 符号当图标。
- `Pinia ref<Record<K, V>>` 更新要用整体 spread：`state.value = { ...state.value, [id]: v }`。

---

## 架构要点（需要读多文件才能理解）

### 1. Wails binding 与 IPC
- `app.go` 配置 Wails、注册 `OnStartup/OnShutdown`、并通过 `Bind` 暴露 `internal/app` 的方法。
- 前端 `frontend/src/composables/useWails.ts` 是类型化的 IPC 转发层。
- 修改 `internal/app/*.go` 增加或删除 binding 方法后，必须跑 `wails generate` 或 `wails dev/build`，让 `frontend/wailsjs/go/app/App.js` 重新生成。**不要手改这个文件**。

### 2. Session 生命周期与 PTY
- `internal/app/session.go` 是核心 orchestrator：
  - `CreateSession`：用 `pty.ModeAuto` 启动交互式 Claude（不带 session flag），阻塞等待 `SessionStart` hook 返回真实 UUID（15s 超时）。
  - `AdoptSession`：对 Ease UI 启动前已存在的历史 session 做注册，不启动进程。
  - `OpenSessionTerminal`：点击已有 session 时启动或复用 PTY；未启动时必须用 `claude --resume <sid>`。
  - `OpenSessionTerminalSized(sessionID, workDir, cols, rows)`：启动 PTY 前先把终端尺寸设成前端 xterm 当前尺寸，避免 Claude 首屏按默认窄宽度渲染。
  - `SendMessage`：向 PTY 写裸文本 prompt；写入前必须确保末尾有回车，`session.Send` 会自动补 `\r`。
  - `WriteTerminalInput`：xterm.js 逐键输入直通 PTY，不自动补回车。
- xterm.js 是唯一终端入口；不要恢复 `SwitchOwner` / `OpenInTerminal` / 外部终端切换 UI。
- `pty.Start` 三种 mode：
  - `ModeAuto`：Claude 自己生成 UUID（新建 session）。
  - `ModeNew`：`--session-id <sid>`，保留兼容性，正常新建不用它。
  - `ModeResume`：`--resume <sid>`，jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD。

### 3. PTY 输入与 xterm.js 渲染（关键）
- 当前 xterm.js 方案不再使用 `claude -p --input-format stream-json --output-format stream-json`。
- 向交互式 Claude PTY 发送用户消息必须是裸文本，并以回车结束；没有回车 Claude 不会执行。
- `session.Send(prompt)` 会做最小规范化：如果 `prompt` 没有以 `\n`/`\r` 结尾，则自动补 `\r`；已有回车不会重复追加。
- `WriteTerminalInput` 是终端逐键输入通道，必须保持原始字节语义，不要在这里自动追加回车。
- Go 端 `pumpPtyEvents` 转发 PTY 原始 ANSI 字节；前端 `XtermTerminal.vue` 直接写入 xterm.js。
- `XtermTerminal.vue` 启动时显示 loading 菊花，直到 `term.onRender` 触发且 xterm buffer 中真正存在可见行时才隐藏；同时保留 10s 兜底隐藏，避免进程卡死时 spinner 永远不消失。
- 终端尺寸随容器变化自动调整：`ResizeObserver` 触发后 150ms debounce，再调用 `fitAddon.fit()` 计算新 `cols/rows`；只有尺寸真的改变时才调用 `ResizeTerminal` 通知 PTY。

### 4. Hooks
- `internal/hookserver` 内置 HTTP server，监听 `127.0.0.1:<port>`，端点 `/hook`、`/api/send`、`/api/sessions/{id}/calls`、`/api/sessions/{id}/calls/stream`、`/api/calls/{seq}`。
- `SessionStart` **必须**用 command 脚本：`~/.ease-app/session-start.sh`（macOS/Linux）或 `session-start.ps1`（Windows）。Claude 不支持 HTTP 类型的 `SessionStart` hook。
- 其余 12 类 hook 走 HTTP POST；`hookserver` 自动写 `~/.claude/settings.json`。
- command hook 的 JSON 字段是 `hook_event_name`，不是 HTTP hook 用的 `type`。
- 前端 `handleHookEvent` 收到 `SessionStart` 时，只有 `owner.value[sid] !== 'app'` 才标记为 `terminal`，避免覆盖 Ease UI 自己新建的 session。

### 5. 外部终端
- `internal/terminal` 负责跨平台打开系统终端并运行 `claude -r <sid>`。
- **Windows**：优先 `wt`，否则 `cmd /c start`。由于 Go 1.26 + Wails 的 `exec.Command` 引号转义会被 `cmd` 误读，Windows 实现绕过标准转义：
  - 用 `syscall.SysProcAttr.CmdLine` 直接传递原生命令行。
  - 用 `COMSPEC` 环境变量定位 `cmd.exe`，避免 Wails 进程 PATH 找不到 cmd。
- **macOS**：`osascript` 调 Terminal.app / iTerm2，注入 `echo $$ > pidfile && exec claude ...`。
- **Linux**：依次尝试 `gnome-terminal`、`konsole`、`xterm`，同样注入 pidfile。
- 切回 App 时 macOS/Linux 读 pidfile kill，Windows 用 `taskkill` 按命令行匹配兜底。

### 6. 单例锁
- `internal/single` 在 `main.go` 启动时抢独占锁。
- `wails dev` 的 hot-reload 会触发新进程，因抢不到锁而失败；开发时需要先退出当前实例。
- 可临时注释 `app.go` 里的 `single.Acquire()` 改善 dev 体验，但**不要提交**。

### 7. 启动诊断
- `frontend/index.html` 内联 diag 脚本 + `frontend/src/preload.ts` + `frontend/src/main.ts` 保留启动日志，生产 build 也保留，用于现场排查。
- 黑屏时按日志定位：
  - HB 心跳停掉 = JS event loop 卡死。
  - `auth.initPromise` 之后无响应 = XPC/TCC 权限问题（macOS）。

### 8. 窗口状态
- `frontend/src/composables/useWindowState.ts` 是唯一的窗口尺寸/最大化状态管理中心。
- `app.go` 配置 `StartHidden: true`，窗口初始不可见；登录成功后由前端调用 `WindowShow()`，避免登录页/主页尺寸闪烁。
- 禁止在视图组件里直接调用 `WindowSetSize` / `WindowMaximise`；统一通过 `useWindowState.applyLoginLayout()` / `applyHomeLayout()` / `applySettingsLayout()` 切换。
- 最大化状态通过 `window.resize` 事件同步，不再轮询。

### 9. API 网关代理（apiproxy）
- `internal/apiproxy` 按 session 启动独立 HTTP 代理，通过注入 `ANTHROPIC_BASE_URL` 拦截 Claude API 流量。
- 每个 session 一个 `apiproxy.Proxy`，共用同一个 `apiproxy.Store`；`ModeAuto` 新建 session 先用临时 token 启动代理，等 `SessionStart` 返回真实 UUID 后再调用 `Proxy.SetSessionID` 迁移。
- 代理只解析**显示需要**的字段：`prompt`、tools 名称、`tool_result`、响应 `text` / `thinking` / `tool_use` / `usage` / `stop_reason`，不保留完整 messages 历史。
- 阶段数据落盘到 `~/.ease-app/projects/<encoded-project>/<sid>-calls.jsonl`，每行一个 JSON，字段见 `internal/apiproxy/types.go`。
- 关键字段：
  - `seq`：全局自增，所有 session 共享；store 启动时从已有文件恢复最大值。
  - `turn`：用户可见交互轮次；纯文本 prompt 进入新 turn，tool_result-only 请求保持当前 turn。
  - `tool_use_id`：关联 `tool_use` 与 `tool_result`；store 维护 `pendingToolUse` 映射。
- `hookserver` 通过 `SetStore` 拿到 store 后暴露 REST/SSE；前端消费地址为 `http://localhost:<hookPort>/api/sessions/{id}/calls?workDir=...`。
- 代理启动失败**不阻塞 PTY**：打日志后继续启动 Claude，只是无网关数据。

---

## 提交规范

- 一个 task 一个 commit，格式：`<type>: <subject>`。
  type：`feat` / `fix` / `refactor` / `test` / `docs` / `chore`。
- commit 前必须 `go test ./...` 和 `npx vue-tsc --noEmit` 全绿。
- 改 binding 后同步 commit 自动生成的 `frontend/wailsjs/go/app/App.js`。
- 改 `preload.ts` / `index.html` 的诊断代码时，在 commit message 里标 **临时**。

---

## 重要不变量（改之前必须确认）

- 绝不自己生成 session ID；Claude 通过 `SessionStart` hook 返回 UUID。
- jsonl 已存在的 sid 用 `--resume`；全新 sid 用 `--session-id`。
- 前端 `formatContent` 必须与 Go 端 `ContentBlock.ContentText()` 保持同步。
- 所有 `os/exec` 调用尽量带 context：`exec.CommandContext(ctx, ...)`。
- `//go:embed all:frontend/dist` 的 `all:` 前缀不能去掉，否则隐藏文件缺失会导致某些平台启动失败。
- 启动 PTY 前必须先确保对应 session 的 `apiproxy.Proxy` 已启动并把 `ANTHROPIC_BASE_URL` 注入 env；`ModeAuto` 用临时 token，等真实 UUID 后再 `SetSessionID`。
- `apiproxy.Store` 是全局单例，所有 proxy 共享；不要为同一个 session 创建多个 proxy（用 `ensureAPIProxy`）。
- 网关数据是 PTY+xterm.js 的**补充**，不替代终端渲染；前端消费失败不能影响 Claude 正常运行。

---

## 相关文档

- `README.md` —— 项目总览、完整数据流、目录结构、已知问题。
- `docs/superpowers/specs/2026-06-27-ease-ui-design.md` —— 设计决策。
- `docs/superpowers/plans/2026-06-27-ease-ui.md` —— 44 个 task 实施历史。
