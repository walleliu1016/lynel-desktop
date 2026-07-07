# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 全局约定

- 所有回复用简体中文（包括代码注释、commit message、PR 描述）。
- 每次 commit 前在仓库内设置 local git identity，不要依赖全局身份：
  ```bash
  git config user.name "<name>"
  git config user.email "<email>"
  ```
- 不要提交构建产物、诊断文件或运行时垃圾（如 `.claude/`、`build/bin/`、`*-err.log`、临时 `.cmd`、`.exe` 等）。

---

## 常用命令

```bash
# 主进程测试（commit 前必须全绿）
npm run test:main

# 前端类型检查
cd frontend && npx vue-tsc --noEmit

# 前端单独开发（Vite dev server，5173 端口）
cd frontend && npm run dev
# 这种模式下没有 Electron runtime，window.electronAPI 是 undefined，
# 只适合做纯 UI 调试。IPC 相关的代码要走 npm run dev。

# 全栈开发（推荐）
npm run dev

# 生产构建（产物在 dist/ 与 dist-electron/）
npm run build

# 打包当前平台安装包
npm run dist

# 指定平台打包
npm run dist:win
npm run dist:mac
npm run dist:linux
```

---

## 代码风格

### TypeScript / Node.js
- `src/main/` 是 Electron 主进程代码；`electron/` 是入口与窗口/托盘壳；`frontend/src/` 是 Vue 3 前端。
- `frontend/src/composables/useElectron.ts` 是唯一接触 `window.electronAPI` 的文件；其他文件必须 `import { X } from '../composables/useElectron'`。
- 禁止直接 `window.electronAPI.X(...)`。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`；路由用 hash mode。
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色。
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用；禁止在界面里用 emoji / Unicode 符号当图标。
- `Pinia ref<Record<K, V>>` 更新要用整体 spread：`state.value = { ...state.value, [id]: v }`。
- 错误返回 `error` / reject，不要抛未捕获异常；主进程未捕获异常会导致窗口白屏。

---

## 架构要点（需要读多文件才能理解）

### 1. Electron IPC
- `electron/main.ts` 创建 BrowserWindow、Tray、处理单例锁，并实例化 `src/main/app.ts` 的 `App` 类。
- `electron/preload.ts` 通过 `contextBridge` 暴露 `window.electronAPI`。
- `frontend/src/composables/useElectron.ts` 是类型化的 IPC 转发层。
- 所有主进程方法通过 `ipcMain.handle` / `ipcRenderer.invoke` 调用。

### 2. 主进程结构
- `src/main/app.ts`：组装 store、events、log、auth、jsonl、session、hookserver、channels、apiproxy，注册所有 IPC handler。
- `src/main/session.ts`：会话状态机与 orchestrator。
- `src/main/pty.ts`：基于 `node-pty` 启动交互式 Claude。
- `src/main/hookserver.ts`：Express HTTP server，接收 Claude hooks，端点 `/hook`、`/api/send`、`/api/sessions/{id}/calls`、`/api/sessions/{id}/calls/stream`、`/api/calls/{seq}`。
- `src/main/apiproxy.ts`：本地 HTTP→HTTPS 代理，拦截 Claude API 流量并 emit 阶段事件。
- `src/main/channels/`：Channel Dispatcher，将 apiproxy 阶段事件路由到 SSE / WeCom 等输出通道。

### 3. Session 生命周期与 PTY
- `SessionManager.create`：用 `PtyMode.Auto` 启动交互式 Claude（不带 session flag），阻塞等待 `SessionStart` hook 返回真实 UUID（15s 超时）。
- `SessionManager.adopt`：对 Lynel Desktop 启动前已存在的历史 session 做注册，不启动进程。
- `SessionManager.openTerminal`：点击已有 session 时启动或复用 PTY；未启动时必须用 `claude --resume <sid>`。
- `SessionManager.send`：向 PTY 写裸文本 prompt；写入前必须确保末尾有回车，`Session.send` 会自动补 `\r`。
- `WriteTerminalInput`：xterm.js 逐键输入直通 PTY，不自动补回车。
- xterm.js 是唯一终端入口。
- `PtyMode` 三种 mode：
  - `Auto`：Claude 自己生成 UUID（新建 session）。
  - `New`：`--session-id <sid>`，保留兼容性，正常新建不用它。
  - `Resume`：`--resume <sid>`，jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD。

### 4. PTY 输入与 xterm.js 渲染（关键）
- 向交互式 Claude PTY 发送用户消息必须是裸文本，并以回车结束；没有回车 Claude 不会执行。
- `session.send(prompt)` 会做最小规范化：如果 prompt 没有以 `\n`/`\r` 结尾，则自动补 `\r`；已有回车不会重复追加。
- `writeTerminalInput` 是终端逐键输入通道，必须保持原始字节语义，不要在这里自动追加回车。
- 主进程转发 PTY 原始 ANSI 字节；前端 `XtermTerminal.vue` 直接写入 xterm.js。
- `XtermTerminal.vue` 启动时显示 loading 菊花，直到 xterm buffer 中真正存在可见行时才隐藏；同时保留 10s 兜底隐藏。
- 终端尺寸随容器变化自动调整：`ResizeObserver` 触发后 150ms debounce，再调用 `fitAddon.fit()` 计算新 `cols/rows`；只有尺寸真的改变时才调用 `ResizeTerminal` 通知 PTY。

### 5. Hooks
- `src/main/hookserver.ts` 内置 HTTP server，监听 `127.0.0.1:<port>`。
- `SessionStart` **必须**用 command 脚本：`~/.lynel-desktop/session-start.sh`（macOS/Linux）或 `session-start.ps1`（Windows）。Claude 不支持 HTTP 类型的 `SessionStart` hook。
- 其余 12 类 hook 走 HTTP POST；`hookserver` 自动写 `~/.claude/settings.json`。
- command hook 的 JSON 字段是 `hook_event_name`，不是 HTTP hook 用的 `type`。
- 前端 `handleHookEvent` 收到 `SessionStart` 时，只有 `owner.value[sid] !== 'app'` 才标记为 `terminal`，避免覆盖 Lynel Desktop 自己新建的 session。

### 6. 窗口状态
- `frontend/src/composables/useWindowState.ts` 是唯一的窗口尺寸/最大化状态管理中心。
- 禁止在视图组件里直接调用 `BrowserWindow` 尺寸方法；统一通过 `useWindowState.applyLoginLayout()` / `applyHomeLayout()` / `applySettingsLayout()` 切换。
- 最大化状态通过 `window.resize` 事件同步，不再轮询。

### 7. API 网关代理（apiproxy）
- `src/main/apiproxy.ts` 按 session 启动独立 HTTP 代理，通过注入 `ANTHROPIC_BASE_URL` 拦截 Claude API 流量。
- 每个 session 一个 `APIProxy` 实例，共用同一个 `ProxyStore`；`ModeAuto` 新建 session 先用临时 token 启动代理，等 `SessionStart` 返回真实 UUID 后再迁移。
- 代理只解析**显示需要**的字段：`prompt`、tools 名称、`tool_result`、响应 `text` / `thinking` / `tool_use` / `usage` / `stop_reason`，不保留完整 messages 历史。
- 阶段数据落盘到 `~/.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl`，每行一个 JSON。
- 关键字段：
  - `seq`：全局自增，所有 session 共享；store 启动时从已有文件恢复最大值。
  - `turn`：用户可见交互轮次；纯文本 prompt 进入新 turn，tool_result-only 请求保持当前 turn。
  - `tool_use_id`：关联 `tool_use` 与 `tool_result`；store 维护 `pendingToolUse` 映射。
- `hookserver` 暴露 REST/SSE；前端消费地址为 `http://localhost:<hookPort>/api/sessions/{id}/calls?workDir=...`。
- 代理启动失败**不阻塞 PTY**：打日志后继续启动 Claude，只是无网关数据。

### 8. Channel Dispatcher
- `src/main/channels/channel.ts` 定义 `OutputChannel` 接口与 `ProxyStageEvent`。
- `src/main/channels/registry.ts` 的 `ChannelDispatcher` 注册多个 channel，逐个 dispatch 并隔离错误。
- `src/main/channels/sse-channel.ts`：向订阅了 session 的 Express Response 写 `text/event-stream`。
- `src/main/channels/wecom-channel.ts`：动态加载 `@wecom/wecom-openclaw-plugin`，将阶段数据发送到企业微信。

---

## 提交规范

- 一个 task 一个 commit，格式：`<type>: <subject>`。
  type：`feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `ci`。
- commit 前必须 `npm run test:main` 和 `cd frontend && npx vue-tsc --noEmit` 全绿。
- 改 `preload.ts` / `index.html` 的诊断代码时，在 commit message 里标 **临时**。

---

## 重要不变量（改之前必须确认）

- 绝不自己生成 session ID；Claude 通过 `SessionStart` hook 返回 UUID。
- jsonl 已存在的 sid 用 `--resume`；全新 sid 用 `--session-id`。
- 向 PTY 发送用户消息必须以回车结尾；`session.send` 会自动补，但 `writeTerminalInput` 不会。
- 启动 PTY 前必须先确保对应 session 的 `APIProxy` 已启动并把 `ANTHROPIC_BASE_URL` 注入 env；`ModeAuto` 用临时 token，等真实 UUID 后再迁移。
- `ProxyStore` 是全局单例，所有 proxy 共享；不要为同一个 session 创建多个 proxy。
- 网关数据是 PTY+xterm.js 的**补充**，不替代终端渲染；前端消费失败不能影响 Claude 正常运行。

---

## 相关文档

- `README.md` —— 项目总览、完整数据流、目录结构、已知问题。
- `docs/superpowers/specs/2026-07-06-electron-migration-design.md` —— Electron 迁移设计决策。
- `docs/superpowers/plans/2026-07-06-electron-migration-plan.md` —— Electron 迁移实施计划。
