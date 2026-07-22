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
cd src/renderer && npx vue-tsc --noEmit

# 前端单独开发（Vite dev server，5173 端口）
cd src/renderer && npm run dev
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
- `src/main/` 是 Electron 主进程全部代码（入口、preload、业务逻辑）；`src/renderer/` 是 Vue 3 前端。
- `src/renderer/src/composables/useElectron.ts` 是唯一接触 `window.electronAPI` 的文件；其他文件必须 `import { X } from '../composables/useElectron'`。
- 禁止直接 `window.electronAPI.X(...)`。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`；路由用 hash mode。
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色。
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用；禁止在界面里用 emoji / Unicode 符号当图标。
- `Pinia ref<Record<K, V>>` 更新要用整体 spread：`state.value = { ...state.value, [id]: v }`。
- 错误返回 `error` / reject，不要抛未捕获异常；主进程未捕获异常会导致窗口白屏。

---

## 架构要点（需要读多文件才能理解）

### 1. Electron IPC
- `src/main/index.ts` 创建 BrowserWindow、Tray、处理单例锁，并实例化 `src/main/app.ts` 的 `App` 类。
- `src/main/preload.ts` 通过 `contextBridge` 暴露 `window.electronAPI`。
- `src/renderer/src/composables/useElectron.ts` 是类型化的 IPC 转发层。
- 所有主进程方法通过 `ipcMain.handle` / `ipcRenderer.invoke` 调用。

### 2. 主进程结构
- `src/main/app.ts`：组装 store、events、log、auth、jsonl、session、hookserver、channels、apiproxy、permission-broker、notch-window，注册所有 IPC handler。
- `src/main/session.ts`：会话状态机与 orchestrator。
- `src/main/pty.ts`：基于 `node-pty` 启动交互式 Claude。
- `src/main/hookserver.ts`：Express HTTP server，接收 Claude hooks，端点 `/hook`、`/api/send`、`/api/sessions/{id}/calls`、`/api/sessions/{id}/calls/stream`、`/api/calls/{seq}`。
- `src/main/apiproxy.ts`：本地 HTTP→HTTPS 代理，拦截 Claude API 流量并 emit 阶段事件。
- `src/main/permission-broker.ts`：权限仲裁器单例，统一管理权限请求的 raise/resolve/cancel，预分配序号（`allocateSeq`），通过 EventBus 同步状态到灵动岛，支持 `cancelBySessionTool` 联动关闭 UI。
- `src/main/notch-window.ts`：灵动岛浮动 BrowserWindow（透明无边框、alwaysOnTop、skipTaskbar），闭口态 240×34 药丸，开口态动态尺寸最高 400×500，鼠标穿透切换。
- `src/main/channels/`：Channel Dispatcher，将 apiproxy 阶段事件路由到 SSE / WeCom 等输出通道。

### 3. Session 生命周期与 PTY
- `SessionManager.create`：用 `randomUUID()` 预生成 session ID，`PtyMode.New` + `--session-id <id>` 启动交互式 Claude，不再阻塞等待 SessionStart hook。
- `SessionManager.adopt`：对 Lynel Desktop 启动前已存在的历史 session 做注册，不启动进程。
- `SessionManager.openTerminal`：点击已有 session 时启动或复用 PTY；未启动时必须用 `claude --resume <sid>`。
- `SessionManager.send`：向 PTY 写裸文本 prompt；写入前必须确保末尾有回车，`Session.send` 会自动补 `\r`。
- `WriteTerminalInput`：xterm.js 逐键输入直通 PTY，不自动补回车。
- xterm.js 是唯一终端入口。
- `PtyMode` 三种 mode：
  - `New`：`--session-id <sid>`，新建 session 使用，传入预生成的 UUID。
  - `Resume`：`--resume <sid>`，jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD。
  - `Auto`：不带 flag，保留兼容性（一般不用）。

### 4. PTY 输入与 xterm.js 渲染（关键）
- 向交互式 Claude PTY 发送用户消息必须是裸文本，并以回车结束；没有回车 Claude 不会执行。
- `session.send(prompt)` 会做最小规范化：如果 prompt 没有以 `\n`/`\r` 结尾，则自动补 `\r`；已有回车不会重复追加。
- `writeTerminalInput` 是终端逐键输入通道，必须保持原始字节语义，不要在这里自动追加回车。
- 主进程转发 PTY 原始 ANSI 字节；前端 `XtermTerminal.vue` 直接写入 xterm.js。
- `XtermTerminal.vue` 启动时显示 loading 菊花，直到 xterm buffer 中真正存在可见行时才隐藏；同时保留 10s 兜底隐藏。
- 终端尺寸随容器变化自动调整：`ResizeObserver` 触发后 150ms debounce，再调用 `fitAddon.fit()` 计算新 `cols/rows`；只有尺寸真的改变时才调用 `ResizeTerminal` 通知 PTY。

### 5. Hooks
- `src/main/hookserver.ts` 内置 HTTP server，监听 `127.0.0.1:<port>`。
- `SessionStart` hook 已移除（改用预生成 UUID + `--session-id`，不再需要 hook 返回 session ID）。
- 其余 12 类 hook 走 HTTP POST；`hookserver` 自动写 `~/.claude/settings.json`。
- 前端 `handleHookEvent` 收到 `SessionStart` 时，只有 `owner.value[sid] !== 'app'` 才标记为 `terminal`，避免覆盖 Lynel Desktop 自己新建的 session。

### 6. 窗口状态
- `src/renderer/src/composables/useWindowState.ts` 是唯一的窗口尺寸/最大化状态管理中心。
- 禁止在视图组件里直接调用 `BrowserWindow` 尺寸方法；统一通过 `useWindowState.applyLoginLayout()` / `applyHomeLayout()` / `applySettingsLayout()` 切换。
- 最大化状态通过 `window.resize` 事件同步，不再轮询。

### 7. API 网关代理（apiproxy）
- `src/main/apiproxy.ts` 按 session 启动独立 HTTP 代理，通过注入 `ANTHROPIC_BASE_URL` 拦截 Claude API 流量。
- 每个 session 一个 `APIProxy` 实例，共用同一个 `ProxyStore`；创建 session 时直接用预生成的 UUID 启动代理，不再需要临时代理后迁移。
- 代理解析**显示需要**的字段：`prompt`、`tool_use`（含完整 `input`，通过累积 `input_json_delta`）、`tool_result`（从请求体提取，携带 `tool_use_id`）、响应 `text` / `response_complete`。
- 流式 SSE 数据增量解析；过滤系统注入 prompt 和跨请求重复 prompt。
- 阶段数据落盘到 `~/.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl`，每行一个 JSON。
- 关键字段：
  - `seq`：全局自增，所有 session 共享。
  - `turn`：用户可见交互轮次；纯文本 prompt 进入新 turn，tool_result-only 请求保持当前 turn。
  - `tool_use_id`：关联 `tool_use` 与 `tool_result`。
- `hookserver` 暴露 REST/SSE；前端消费地址为 `http://localhost:<hookPort>/api/sessions/{id}/calls?workDir=...`。
- 代理启动失败**不阻塞 PTY**：打日志后继续启动 Claude，只是无网关数据。

### 8. Channel Dispatcher
- `src/main/channels/channel.ts` 定义 `OutputChannel` 接口与 `ProxyStageEvent`（含 `PermissionRequest`、`PermissionResolved` 事件类型）。
- `src/main/channels/registry.ts` 的 `ChannelDispatcher` 注册多个 channel，逐个 dispatch 并隔离错误；支持事件级分发。
- `src/main/channels/sse-channel.ts`：向订阅了 session 的 Express Response 写 `text/event-stream`。
- `src/main/channels/wecom-channel.ts`：动态加载 `@wecom/wecom-openclaw-plugin`，将阶段数据发送到企业微信；`tool_use` 消息展示命令/file_path 详情；处理 PermissionRequest 模板卡片推送与 `#allow/#deny` 命令。
- `src/main/channels/wecom-cards/card-builder.ts`：构造 WeCom `button_interaction` / `vote_interaction` 模板卡片；多问题场景每问题独立卡片，`task_id` 带 `-{qIdx}` 后缀确保唯一。
- `src/main/channels/wecom-cards/card-store.ts`：卡片状态存储（`pending`/`resolved`/`cancelled`），支持多卡片 `questionMsgids` 与部分答案累积 `questionAnswers`。
- `src/main/channels/wecom-cards/event-handler.ts`：解析 `template_card_event` 回调，驱动权限仲裁器完成审批或问答提交；多问题场景通过 `onQuestionProgress`/`onAllQuestionsDone` 回调实现逐题发送。
- `src/main/channels/localfile-channel.ts`：将阶段事件写入本地 JSONL/JSON 文件，过滤流式 text/thinking 碎片。

### 9. 权限仲裁器与灵动岛
- `PermissionBroker` 是主进程单例，管理所有待审批权限请求。
- `allocateSeq(id)` 在 dispatch 前预分配全局自增序号，确保企业微信消息中展示 `#1` 而非 UUID。
- `wait(request)` 返回 Promise，挂起等待决策；任一通道 resolve 后 Promise 解除。
- `resolve(id, decision, source)` 先到先生效（Map 保护），后续调用返回 false。
- `cancelBySessionTool(sessionId, toolName)` 在终端自行解决权限时清理所有 UI。
- `onResolve` 通过 EventBus (`getBus().emit('permission:cancelled', ...)`) 通知灵动岛渲染进程关闭权限 UI。
- `NotchView.vue` 是独立入口页面（Vite 多入口构建），通过 `window.electronAPI` 与主进程通信。
- 灵动岛窗口初始为鼠标穿透模式（`setIgnoreMouseEvents(true, {forward: true})`），hover 时关闭穿透展开面板，leave 后恢复穿透。
- resize 后需强制重算鼠标命中区域：`setIgnoreMouseEvents(true, {forward: true})` → `setIgnoreMouseEvents(false)`。
- 灵动岛通过 `SetNotchSize(w, h)` IPC 动态调整窗口尺寸，AskUserQuestion 场景下根据内容高度自适应。

### 10. 企业微信模板卡片交互

**卡片类型对应关系：**

| 权限/提问类型 | WeCom 卡片类型 | 说明 |
|---|---|---|
| 普通权限请求 (Bash/Write/Read) | `button_interaction` | 允许/拒绝两个按钮，`event_key` 为 `wecom:allow:<id>` / `wecom:deny:<id>` |
| AskUserQuestion 单选 | `vote_interaction` mode=0 | radio 单选，submit 提交 |
| AskUserQuestion 多选 | `vote_interaction` mode=1 | checkbox 多选，submit 提交 |
| 卡片更新 (已处理/已选择) | `text_notice` | 通过 `wsClient.updateTemplateCard` 更新原卡片 |

**event_key 解析规则：**

- 格式：`wecom:<action>:<requestId>`，`action` 为 `allow`/`deny`/`submit`/`answer`
- `submit_button.key` 始终为 `wecom:submit:<requestId>`，问题索引从 `selected_items.question_key` 提取
- `question_key` 格式：`wecom:answer:<requestId>:<qIdx>`
- `option_id` 格式：`wecom:opt:<requestId>:<qIdx>:<optIdx>`

**多问题逐题发送流程：**

1. `sendAskQuestionCard` 检测 `questions.length > 1`：
   - 先发 Markdown 文本预告（含所有问题与选项）
   - 调用 `buildAskQuestionCard` 生成 N 张 `vote_interaction` 卡片（每张 `task_id` 带 `-{qIdx}` 后缀确保唯一）
   - 将 N 张卡片存入 `pendingQuestionCards` Map
   - 发送第一张 (qIdx=0)
2. 用户提交第 i 张卡片 → `template_card_event` → `WeComCardEventHandler.handle()`
3. `buildAnswers` 解析 `selected_items` 提取答案，`extractQuestionIndex` 提取 `qIdx`
4. `cardStore.recordAnswer(requestId, qIdx, total, answer)` 累积部分答案
5. 未收齐 → `onQuestionProgress(requestId, qIdx+1, chatId)` → `WeComChannel` 发送下一张卡片
6. 全部收齐 → `onAllQuestionsDone(requestId, chatId)` → `permissionBroker.resolve` 累积答案 → 通知"已收集全部回答，已回复 Claude"

**卡片降级策略：**

- `sendTemplateCard` 失败 → 回退为 Markdown 文本发送
- 单问题 `questions.length === 0` → 直接降级为 Markdown
- `wsClient` 未连接或 `chatId` 缺失 → 返回 false，触发降级

**重复点击防护：**

- `WeComCardStore` 记录 requestId → status（`pending`/`resolved`/`cancelled`）
- `handle()` 入口检查 `state.status !== 'pending'` → 回复"该请求已被处理"
- `permissionBroker.resolve` Map 保护，重复 resolve 返回 false

**会话标题注入：**

- `WeComChannel.setSessionTitleResolver` 接受回调
- `app.ts` 注入 `readRecentSessions()` 查找逻辑：`userTitle > aiTitle > firstPrompt > project > sessionId[:8]`
- `card-builder` 的 `source.desc` 使用会话标题替代固定 "Lynel"

**关键约束：**

- `task_id` 全局唯一，多卡片必须追加 `-{qIdx}` 后缀（否则企业微信返回 42014）
- `submit_button.key` 可跨卡片相同（仅用作 event_key 回调值）
- `vote_interaction` 的 `question_key` / `option_id` 必须与 `submit_button.key` 共享同一 `EVENT_KEY_PREFIX`

**企业微信控制指令：**

支持在企业微信中发送以下命令来操作 PTY 进程（非文本消息，不会被转发给 Claude）：

| 命令 | 控制字符 | 效果 |
|------|---------|------|
| `/interrupt` `/ctrl-c` `/ctrl+c` | `\x03` | Ctrl+C，中断 Claude 当前生成 |
| `/escape` `/esc` | `\x1b` | Esc |
| `/ctrl-d` | `\x04` | Ctrl+D / EOF |
| `/ctrl-z` | `\x1a` | Ctrl+Z / SIGTSTP |

- 实现：`wecom-channel.ts` → `CONTROL_COMMANDS` 映射 → `handleControlCommand()` → `session.writeInput()`（原始字节，不追加 `\r`）
- 会话路由逻辑与普通消息一致（引用路由 → bot 绑定 → 默认映射）

---

## 提交规范

- 一个 task 一个 commit，格式：`<type>: <subject>`。
  type：`feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `ci`。
- commit 前必须 `npm run test:main` 和 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 改 `preload.ts` / `index.html` 的诊断代码时，在 commit message 里标 **临时**。

---

## 重要不变量（改之前必须确认）

- 新建 session 用 `randomUUID()` 预生成 UUID + `--session-id`；不再依赖 SessionStart hook。
- jsonl 已存在的 sid 用 `--resume`；全新 sid 用 `--session-id`。
- 向 PTY 发送用户消息必须以回车结尾；`session.send` 会自动补，但 `writeTerminalInput` 不会。
- `session.send()` 用于文本消息（自动补 `\r`）；发送控制字符必须用 `session.writeInput()`（原始字节）。
- 启动 PTY 前必须先确保对应 session 的 `APIProxy` 已启动并把 `ANTHROPIC_BASE_URL` 注入 env；代理直接使用预生成的 UUID，不需要迁移。
- `ProxyStore` 是全局单例，所有 proxy 共享；不要为同一个 session 创建多个 proxy。
- 网关数据是 PTY+xterm.js 的**补充**，不替代终端渲染；前端消费失败不能影响 Claude 正常运行。

---

### 11. 三段式布局（Three-Panel Layout）

- 布局结构：左侧 SessionList（280px，可折叠为 44px） | 中间 GlobalTabs + .content（flex:1） | 右侧 TraceSidebar（200px）
- TraceSidebar：`src/renderer/src/components/trace/TraceSidebar.vue`，右侧固定 200px 面板
  - StatsBar：请求数、总费用、刷新按钮
  - 请求缩略列表：状态点 · #seq · model / 延迟 · 费用
  - 状态覆盖：loading 骨架屏 / error 重试 / 空状态（"暂无 API 请求"）
- TraceOverlay：`src/renderer/src/components/trace/TraceOverlay.vue`
  - Teleport 到 `.center`，绝对定位覆盖层
  - `width: clamp(360px, 35%, 45%)` 随窗口自动缩放
  - 关闭方式：backdrop 点击 / Escape 键 / × 按钮
  - 复用 RequestDetailPane 展示单条请求详情
- Trace store（Pinia）：`src/renderer/src/stores/trace.ts`
  - 状态：workDir/sessionId/requests/stats/detail/diffResult/loading/loadError
  - 数据来自 `~/.lynel-desktop/projects/<encoded-project>/<sid>/raw/<seq>.json`
  - `trace.listRawExchanges` 扫描 raw 目录获取请求列表
  - HomeView 通过 `watch(activeSessionId)` 统一监听 session 切换并自动调用 `trace.load()`
  - 覆盖所有激活路径：SessionList 点击、GlobalTabs 切换、最近会话打开、新建会话
- 删除组件：`TraceTab.vue`（原独立 Trace 标签页）、`TabType['trace']`、`tabsStore.openTrace()`

## 相关文档

- `README.md` —— 项目总览、完整数据流、目录结构、已知问题。
- `docs/superpowers/specs/2026-07-06-electron-migration-design.md` —— Electron 迁移设计决策。
- `docs/superpowers/plans/2026-07-06-electron-migration-plan.md` —— Electron 迁移实施计划。
- `docs/superpowers/specs/2026-07-21-lynel-desktop-three-panel-layout-design.md` —— 三段式布局设计文档。
- `docs/superpowers/plans/2026-07-21-three-panel-layout.md` —— 三段式布局实施计划。
