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
npm run test:main          # 等同于 npm test

# 前端类型检查
cd src/renderer && npx vue-tsc --noEmit

# 前端单独开发（Vite dev server，5173 端口）
cd src/renderer && npm run dev
# 这种模式下没有 Electron runtime，window.electronAPI 是 undefined，
# 只适合做纯 UI 调试。IPC 相关的代码要走 npm run dev（全栈）。

# 全栈开发（推荐）
npm run dev

# 停止 dev 进程（清理残留）
npm run dev:stop

# 分步构建
npm run build:frontend     # vue-tsc + vite build
npm run build:electron     # tsc 编译主进程

# 生产构建（frontend + electron 一起）
npm run build

# 打包当前平台安装包
npm run dist

# 指定平台打包
npm run dist:win
npm run dist:mac
npm run dist:linux
```

注意：
- `npm run test:smoke` 引用的 `scripts/smoke-test.ts` 不存在，该命令无法执行。
- 仓库根目录同时存在 `package-lock.json` 和 `pnpm-lock.yaml`；`package.json` 中有 `pnpm.onlyBuiltDependencies` 配置。
- 根目录和 `src/renderer/` 是两个独立的 npm 项目，渲染进程有独立的 `package.json` 和 `vitest`/`@playwright/test` 依赖，但其 `test` 脚本目前是占位符（`echo "no tests yet" && exit 0`）。
- `tests/main/` 目录镜像 `src/main/` 结构，测试文件命名对应源文件。

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
- `src/main/app.ts`：组装 store、events、log、auth、jsonl、session、hookserver、channels、apiproxy、permission-broker、updater、attention、exit-detect、output-batcher，注册所有 IPC handler。Session 生命周期编排（`createSessionInternal`、`adoptSession`、`openSessionTerminal`）在此实现。
- `src/main/session.ts`：模块级 session 注册表（`Map<string, Session>`），提供 `newSession`/`register`/`lookup`/`remove`/`list`/`send`/`writeInput`/`resize`/`close`/`rebind`/`setProcess`/`setState`/`touch`/`appendBuffer`/`getBuffer` 等函数。**没有 `SessionManager` 类**。
- `src/main/pty.ts`：基于 `node-pty` 启动交互式 Claude，包含 `PtyMode` 枚举、darwin shell-env 解析/缓存、`probeBin` 预探测、`PtyExitInfo` 诊断等。
- `src/main/hookserver.ts`：Express HTTP server，接收 Claude hooks。端点：`/hook`（Claude hook POST）、`/api/send`（外部发送消息）、`/api/sessions/:id/calls/stream`（SSE 流）。**不再有 `/api/sessions/{id}/calls` 和 `/api/calls/{seq}` 端点**（trace 数据已改为 IPC 方式）。
- `src/main/apiproxy.ts`：本地 HTTP→HTTPS 代理，拦截 Claude API 流量并产出 `LynelEnvelope` 事件（不再是旧版 `ProxyStageEvent`）。
- `src/main/permission-broker.ts`：权限仲裁器单例，统一管理权限请求的 raise/resolve/cancel，预分配序号（`allocateSeq`），支持 `cancelBySessionTool` 联动关闭 UI。
- `src/main/channels/`：Channel Dispatcher，将 apiproxy 的 `LynelEnvelope` 和 hookserver 的 `HookEventLike` 路由到各输出通道。
- `src/main/updater/`：在线升级模块（检查、下载、退出安装）。
- `src/main/attention.ts`：窗口注意力中心（dock bounce、flashFrame、系统通知、tray 待审批菜单）。
- `src/main/exit-detect.ts`：PTY 输入流中检测 `/exit`/`/quit`/`/clear`/`/resume` 命令。
- `src/main/output-batcher.ts`：PTY 输出合帧器（~16ms 窗口），减少 IPC 洪峰。
- `src/main/trace/`：trace 数据 IPC 处理器（`ipc.ts`）和计时工具（`timing.ts`）。
- `src/main/adapter/`：Session 适配器、请求解析器、工具生命周期、Turn 状态机、用量附加器。
- `src/main/formats/`：多供应商格式适配（Anthropic、OpenAI、PI）。
- `src/main/cost/`：价格表和用量计算。
- `src/main/protocol/`：`LynelEnvelope` 协议定义（`envelope.ts`、`events.ts`、`usage.ts`）。
- `src/main/archive/`：归档写入（blobs、happy.jsonl、raw archive、用量摘要）。

### 3. Session 生命周期与 PTY
- **创建**：`App.createSessionInternal(workDir, prompt, extraArgs, autoTrust, botId?)` 是唯一入口。
  1. 用 `randomUUID()` 预生成 session ID。
  2. 启动 `APIProxy`（直接使用预生成的 UUID，不需要临时代理后迁移）。
  3. 创建临时 `--settings` 覆盖文件（注入 `ANTHROPIC_BASE_URL` + hooks + `bypassPermissions`），**不修改全局 `~/.claude/settings.json`**。
  4. `PtyMode.New` + `--session-id <id>` + `--settings <tmpFile>` 启动交互式 Claude。
  5. `session.newSession()` + `session.register()` 注册到模块级 Map。
  6. `wirePty()` 连接 PTY 数据流（经 `OutputBatcher` 合帧后推送渲染进程）。
- **采纳（adopt）**：`adoptSession` IPC 对 Lynel Desktop 启动前已存在的历史 session 做注册，不启动进程。
- **打开终端（openTerminal）**：点击已有 session 时启动或复用 PTY；未启动时必须用 `claude --resume <sid>`（jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD）。
- **发送消息**：`session.send(id, prompt)` 向 PTY 写裸文本，自动补 `\r`。
- **会话迁移（rebind）**：`session.rebind(oldId, newId, workDir)` 把 session 从旧 ID 迁移到新 ID（不 kill 进程，保留 process/buffer 引用）。用于 Claude `/clear` 后新 sessionId 接管当前 PTY，或 `/resume` 切换到历史会话的场景。
- **退出检测**：`exit-detect.ts` 的 `consumeInputForExitDetect()` 解析 PTY 输入流中的 ANSI 转义序列并识别 `/exit`/`/quit`（触发 session 结束）、`/clear`（触发 `rebind`）、`/resume`（触发 `rebind`）。
- **关闭**：`session.close(id, signal?)` kill 进程并标记 `done`；`session.remove(id)` 额外从 Map 删除并触发 `onRemove` 回调。
- `PtyMode` 三种 mode：
  - `New`：`--session-id <sid>`，新建 session 使用，传入预生成的 UUID。
  - `Resume`：`--resume <sid>`，jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD。
  - `Auto`：不带 flag，保留兼容性（一般不用）。
- PTY 启动前会做 darwin shell-env 解析（缓存到 `~/.lynel-desktop/darwin-env.json`），以及 `probeBin` 预探测（`claude --version`）。

### 4. PTY 输入与 xterm.js 渲染（关键）
- 向交互式 Claude PTY 发送用户消息必须是裸文本，并以回车结束；没有回车 Claude 不会执行。
- `session.send(prompt)` 会做最小规范化：如果 prompt 没有以 `\n`/`\r` 结尾，则自动补 `\r`；已有回车不会重复追加。
- `session.writeInput(id, data)` 是原始字节写入通道，不追加回车。用于发送控制字符（Ctrl+C 等）。
- 主进程转发 PTY 原始 ANSI 字节；前端 `XtermTerminal.vue` 直接写入 xterm.js。
- `XtermTerminal.vue` 启动时显示 loading 菊花，直到 xterm buffer 中真正存在可见行时才隐藏；同时保留 30s 和 5s 两级兜底隐藏。
- 终端尺寸随容器变化自动调整：`ResizeObserver` 触发后 150ms debounce，再调用 `fitAddon.fit()` 计算新 `cols/rows`；只有尺寸真的改变时才调用 `ResizeTerminal` 通知 PTY。
- PTY 输出经 `OutputBatcher`（16ms 合帧窗口）合并后再通过 IPC 推送给渲染进程，避免高频 chunk 导致 IPC 洪峰。`session.appendBuffer` 的本地缓冲仍逐 chunk 追加。发送 done / 错误提示等 out-of-band 消息前必须调用 `batcher.flush(id)` 保序。

### 5. Hooks
- **配置方式**：不再修改全局 `~/.claude/settings.json`。`app.ts` 的 `createSettingsOverrideFile()` 在 `os.tmpdir()/lynel-desktop/` 下创建临时 settings 文件，通过 `--settings <tmpFile>` 传递给 Claude。文件包含：
  - `env.ANTHROPIC_BASE_URL`：指向本地代理。
  - `hooks`：4 类 hook（`PermissionRequest` 7200s、`PreToolUse` 5s、`PostToolUse` 5s、`PostToolUseFailure` 5s）。
  - `permissions.defaultMode: "bypassPermissions"`：绕过 Claude 内置权限检查，统一走 Lynel 的 `PermissionBroker`。
- `hookserver.ts` 内置 HTTP server，监听 `127.0.0.1:<port>`，仅暴露 3 个端点：`/hook`、`/api/send`、`/api/sessions/:id/calls/stream`。
- `PermissionRequest` hook 被 hookserver 单独拦截，走审批专用通道（`desktop:hook:permission` 上行到云服务）。
- `PreToolUse`/`PostToolUse`/`PostToolUseFailure` 三类工具 hook 通过 `desktop:hook:batch` 批量上报云服务。
- `SessionStart` hook 保留用于 state-channel 会话状态显示，不进 batch。
- `mapHookToKind()` 将 Claude 标准 hook 名映射为 `HookEventLike.kind`（共 9 种 kind：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`Stop`、`PermissionRequest`、`PermissionResolved`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`）。
- 前端 `handleHookEvent` 收到 `SessionStart` 时，直接设置 `state` 为 `'idle'`（在 `stores/sessions.ts`）。不再有 `owner` 逻辑。

### 6. 窗口状态
- `src/renderer/src/composables/useWindowState.ts` 是唯一的窗口尺寸/最大化状态管理中心。
- 禁止在视图组件里直接调用 `BrowserWindow` 尺寸方法；统一通过 `useWindowState.applyLoginLayout()` / `applyHomeLayout()` / `applySettingsLayout()` 切换。
- 最大化状态通过 `window.resize` 事件同步，不再轮询。

### 7. API 网关代理（apiproxy）
- `src/main/apiproxy.ts` 按 session 启动独立 HTTP 代理，通过注入 `ANTHROPIC_BASE_URL` 拦截 Claude API 流量。
- 每个 session 一个 `APIProxy` 实例，共用同一个全局 `ProxyStore`；创建 session 时直接用预生成的 UUID 启动代理，不再需要临时代理后迁移。
- 代理解析阶段数据，产出 `LynelEnvelope` 事件（不再是旧版 `ProxyStageEvent`），经 `SessionAdapter`、`FormatAdapter`、`cost/priceTable.ts` 等处理。
- 数据落盘到 `~/.lynel-desktop/projects/<encoded-project>/<sid>/` 目录，包含：
  - `_summaries.jsonl`：摘要索引（每行 ~200 字节，供前端列表快速加载）。
  - `raw/<seq>.json`：完整请求-响应交换记录（按需加载详情）。
  - `happy.jsonl`：格式化归档。
- 关键字段：
  - `seq`：全局自增，所有 session 共享。
  - `turn`：用户可见交互轮次；纯文本 prompt 进入新 turn，tool_result-only 请求保持当前 turn。
  - `tool_use_id`：关联 `tool_use` 与 `tool_result`。
- 代理启动失败**不阻塞 PTY**：打日志后继续启动 Claude，只是无网关数据。
- 前端通过 IPC（`trace:listRequests`、`trace:request` 等）消费 trace 数据，不再通过 hookserver REST 端点。

### 8. Channel Dispatcher
- `src/main/channels/channel.ts` 定义两类通道接口：
  - `OutputChannel`：消费 `LynelEnvelope`（来自 apiproxy），方法 `send(event: LynelEnvelope)`。
  - `HookChannel`：消费 `HookEventLike`（来自 hookserver），方法 `sendHook(event: HookEventLike)`。
  - `HookEventLike.kind` 共 9 种：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`Stop`、`PermissionRequest`、`PermissionResolved`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`。
- `src/main/channels/registry.ts` 的 `ChannelDispatcher` 注册多个 channel，逐个 dispatch 并隔离错误；支持事件级分发。
- 现有通道：
  - `sse-channel.ts`：向订阅了 session 的 Express Response 写 `text/event-stream`。
  - `wecom-channel.ts`：动态加载 `@wecom/wecom-openclaw-plugin`，将阶段数据发送到企业微信；处理 PermissionRequest 模板卡片推送与 `#allow/#deny` 命令；支持控制指令（`/interrupt`、`/ctrl-c`、`/escape`、`/ctrl-d`、`/ctrl-z`、`/screenshot`）。
  - `localfile-channel.ts`：将阶段事件写入本地 JSONL/JSON 文件，过滤流式 text/thinking 碎片。
  - `state-channel.ts`：把 `LynelEnvelope` + `HookEventLike` 映射为 session 状态（idle/running/awaiting_permission/done）和活动（thinking/working/streaming/idle/awaiting_permission），通过回调驱动前端 UI 更新。替代了旧版灵动岛悬浮窗。
  - `desktop-socket.ts`：Socket.IO 云端上行通道，支持 `desktop:auth`、`desktop:session:sync`、`desktop:envelope:push`、`desktop:hook:batch`、`desktop:hook:permission`、`desktop:hook:abort` 事件。
  - `cloud-channel.ts`：HTTP 云端上行通道（POST `/api/envelope/push`、`/api/sessions/sync`、`/api/hook`），作为 Socket.IO 的 fallback。
  - `notify-error.ts`：外部错误通知辅助函数（`notifyExternal`、`errMessage`）。
- `wecom-channel.ts` 的 `CONTROL_COMMANDS` 映射支持通过企业微信发送控制指令到 PTY（见第 10 节）。
- WeCom 通道的 `setSessionTitleResolver` 接受回调，`app.ts` 注入 `readRecentSessions()` 查找逻辑：`userTitle > aiTitle > firstPrompt > project > sessionId[:8]`。

### 9. 权限仲裁器
- `PermissionBroker` 是主进程单例，管理所有待审批权限请求。
- `allocateSeq(id)` 在 dispatch 前预分配全局自增序号，确保企业微信消息中展示 `#1` 而非 UUID。
- `wait(request)` 返回 Promise，挂起等待决策；任一通道 resolve 后 Promise 解除。
- `resolve(id, decision, source)` 先到先生效（Map 保护），后续调用返回 false。
- `cancelBySessionTool(sessionId, toolName)` 在终端自行解决权限时清理所有 UI，返回被取消的 request id（`string | null`），供调用者发送 `desktop:hook:abort` 通知云服务。

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
| `/screenshot` | — | 截取当前终端画面（xterm.js canvas → PNG） |

- 实现：`wecom-channel.ts` → `CONTROL_COMMANDS` 映射 → `handleControlCommand()` → `session.writeInput()`（原始字节，不追加 `\r`）
- 会话路由逻辑与普通消息一致（引用路由 → bot 绑定 → 默认映射）

### 11. 三段式布局（Three-Panel Layout）

- 布局结构：左侧 SessionList（280px，可折叠为 44px） | 中间 GlobalTabs + .content（flex:1） | 右侧 TraceSidebar（200px）
- TraceSidebar：`src/renderer/src/components/trace/TraceSidebar.vue`，右侧固定 200px 面板
  - StatsBar：请求数、总费用、刷新按钮
  - 请求缩略列表（v2 分页 + 摘要索引）：
    - Row 1：状态点 · #seq · model · 时间
    - Row 2：↓输入tokens ↑输出tokens 🔧工具调用次数 ⏱延迟 $费用
  - 分页：初始加载 50 条，滚动到顶部触发 `loadMore()`
  - 状态覆盖：loading 骨架屏 / error 重试 / 空状态（"暂无 API 请求"）
- TraceOverlay：`src/renderer/src/components/trace/TraceOverlay.vue`
  - Teleport 到 `.center`，绝对定位覆盖层
  - `width: clamp(360px, 35%, 45%)` 随窗口自动缩放
  - 关闭方式：backdrop 点击 / Escape 键 / × 按钮
  - 复用 RequestDetailPane 展示单条请求详情（从完整 `<seq>.json` 按需加载）
- Trace store（Pinia）：`src/renderer/src/stores/trace.ts`（v2 分页）
  - 状态：workDir/sessionId/requests/detail/diffResult/loading/loadError/hasMore
  - 摘要索引：`_summaries.jsonl`（每行 ~200 字节，apiproxy 追加写入）
  - 数据来源：`_summaries.jsonl`（列表）+ `<seq>.json`（详情按需加载）
  - `load()` 首页 50 条，`loadMore()` 滚动分页，`fetchNew()` 增量加载（`sinceSeq`）
  - 图过滤（model/errorsOnly）变化时自动重新加载首页
  - HomeView 通过 `watch(activeSessionId)` 统一监听 session 切换并自动调用 `trace.load()`
  - 覆盖所有激活路径：SessionList 点击、GlobalTabs 切换、最近会话打开、新建会话
- 删除组件：`TraceTab.vue`、`TraceHeader.vue`、`RequestList.vue`（死代码）
- 关键不变量：摘要索引 `<sessionDir>/_summaries.jsonl` 与 raw exchange `<seq>.json` 同目录，前者轻量全量读取（5000 条仅 ~1MB），后者仅详情时按需读取

### 12. 在线升级（Updater）

- `src/main/updater/index.ts` 的 `initUpdater(getMainWindow)` 注册 4 个 IPC handler：
  - `app:checkUpdate`：检查更新（GitHub Releases 为主，云服务 HTTP 为 fallback）。
  - `app:downloadUpdate`：下载更新包。
  - `app:quitAndInstall`：退出并安装。
  - `app:getUpdateStatus`：获取当前更新状态和版本号。
- 首次启动 5 秒后自动检查；之后每 4 小时定时检查。
- 强制更新（`forceUpdate: true`）会主动推送通知。
- 更新状态（`UpdateState`）通过 `update:state` webContents 事件推送到渲染进程。
- 配置来源：electron-store 中的 `cloud_service_enabled` + `cloud_service_url`。

### 13. 窗口注意力（WindowAttention）

- `src/main/attention.ts` 的 `windowAttention` 单例管理权限待审批时的窗口注意力信号：
  - **Windows**：`BrowserWindow.flashFrame` 任务栏闪烁 + 系统通知。
  - **macOS**：`app.dock.bounce('informational')` + `app.setBadgeCount` + 系统通知。
  - **Linux**：`app.setBadgeCount` + 系统通知。
- 由 `PermissionBroker.onRaise` / `onResolve` / `onCancel` 驱动。
- 通知 30s debounce；通知点击后恢复窗口、前置、聚焦并切换到对应 session tab。
- 托盘菜单显示待审批列表，点击可聚焦最早一条或直接显示主窗口。

### 14. 云端上行通道（DesktopSocket / CloudChannel）

- `DesktopSocket`（`src/main/channels/desktop-socket.ts`）：
  - 基于 Socket.IO 的实时双向通道，同时实现 `OutputChannel` 和 `HookChannel`。
  - 认证流程：用户在登录页输入 `user_id` + `token` → `app:loginWithToken` → token 纯内存缓存 → Socket 连接 → `POST /api/auth/login` → cloud 校验通过 → `auth:success`。
  - 上行事件（均以 `desktop:` 前缀）：`desktop:auth`、`desktop:session:sync`、`desktop:envelope:push`（buffer + 定时 flush）、`desktop:hook:batch`（非审批 hook 批量上报）、`desktop:hook:permission`（单个 PermissionRequest，阻塞等待结果）、`desktop:hook:abort`（本地 race 胜出时通知 cloud 取消）。
  - 下行事件：`auth:success`、`auth:failed`、`desktop:hook:result`（PermissionRequest 决策结果）、`desktop:chat`（Mobile 转发的消息 → 路由到对应 session 的 PTY）。
  - `SyncSession.state` 字段为 `'open' | 'ended'`（不是 `status`）。
  - **安全注意**：TLS 证书校验被禁用（`rejectUnauthorized: false`），用于支持自签证书的云服务。
- `CloudChannel`（`src/main/channels/cloud-channel.ts`）：HTTP 上行通道，作为 Socket.IO 的 fallback。
- 会话同步支持 `mode: 'snapshot' | 'event'`，`event` 模式在 `SyncSession.event` 字段标注触发类型（`created`/`opened`/`closed`/`title_updated`）。

---

## 提交规范

- 一个 task 一个 commit，格式：`<type>: <subject>`。
  type：`feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `ci`。
- commit 前必须 `npm run test:main` 和 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 改 `preload.ts` / `index.html` 的诊断代码时，在 commit message 里标 **临时**。

---

## 发布流程

- 版本号：小版本 +1，如 `0.0.15` → `0.0.16`，只升 patch 位。
- 步骤：
  1. bump `package.json` 版本号，同步 `package-lock.json`；`vscode-extension/package.json` 保持同版本。
  2. 新增 `docs/changelog/<version>.md`，按「新功能 / 修复」分组记录本次改动，参考上一版本格式。
  3. commit 前确保 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
  4. 代码改动按 task 拆分 commit；版本 + changelog 单独一个 `chore: release v<version>` commit。
  5. 打 tag `v<version>` 并 push 代码与 tag，触发 GitHub Actions（`build.yml` 监听 `v*` tag）构建发布。
- CI（`build.yml`）构建 4 个平台包（win-x64、mac-x64、mac-arm64、linux）和 VS Code 扩展 VSIX。
- 不要提交构建产物（`.vsix`、`dist/`、`dist-electron/` 等）。

---

## 重要不变量（改之前必须确认）

- 新建 session 用 `randomUUID()` 预生成 UUID + `--session-id`；不再依赖 SessionStart hook 返回 session ID。
- jsonl 已存在的 sid 用 `--resume`；全新 sid 用 `--session-id`。
- 向 PTY 发送用户消息必须以回车结尾；`session.send()` 会自动补 `\r`，但 `session.writeInput()` 不会。
- `session.send()` 用于文本消息（自动补 `\r`）；发送控制字符必须用 `session.writeInput()`（原始字节）。
- 启动 PTY 前必须先确保对应 session 的 `APIProxy` 已启动并把 `ANTHROPIC_BASE_URL` 注入 env；代理直接使用预生成的 UUID，不需要迁移。
- `ProxyStore` 是全局单例，所有 proxy 共享；不要为同一个 session 创建多个 proxy。
- 网关数据是 PTY+xterm.js 的**补充**，不替代终端渲染；前端消费失败不能影响 Claude 正常运行。
- **不再修改全局 `~/.claude/settings.json`**；所有 Claude 配置通过临时 `--settings` 文件注入。
- `PermissionBroker` 的 `cancelBySessionTool` 返回被取消的 request id 时，调用者必须发送 `desktop:hook:abort` 通知云服务。
- `session.rebind()` 不 kill 进程，保留 process/buffer 引用；用于 `/clear` 和 `/resume` 场景。
- Trace 数据通过 IPC（`trace:*` handler）消费，不再通过 hookserver REST 端点。

---

## 相关文档

- `README.md` —— 项目总览、完整数据流、目录结构。
- `docs/usage.md` —— 使用指南（安装、配置、企业微信集成、截图等）。
- `docs/channel.md` —— 通道架构设计。
- `docs/hook.md` —— Hook 系统设计。
- `docs/envelope-format.md` —— LynelEnvelope 协议格式。
- `docs/desktop-interfaces.md` —— Desktop 接口定义。
- `docs/desktop-permission-request.md` —— 权限请求流程。
- `docs/cloud/` —— 云端同步相关文档（session sync、update 等）。
- `docs/superpowers/specs/2026-07-06-electron-migration-design.md` —— Electron 迁移设计决策。
- `docs/superpowers/plans/2026-07-06-electron-migration-plan.md` —— Electron 迁移实施计划。
- `docs/superpowers/specs/2026-07-21-lynel-desktop-three-panel-layout-design.md` —— 三段式布局设计文档。
- `docs/superpowers/plans/2026-07-21-three-panel-layout.md` —— 三段式布局实施计划。
- `docs/superpowers/specs/2026-08-09-multi-agent-support-design.md` —— 多 Agent 支持设计文档（omp/codex/opencode，参考 `~/project/ccglass`）。
- `docs/superpowers/specs/2026-08-09-multi-agent-ui-design.md` —— 多 Agent 前端 UI 设计文档（agent 选择、4 区域标识、ProviderTab 分组）。

---

## 备注

- `AGENTS.md` 已过时（版本号停留在 0.0.11，引用已删除的 `notch-window.ts`、错误的 hook 数量等），以本文件为准。
