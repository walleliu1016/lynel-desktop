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

# 前端单独开发（Vite dev server，5180 端口）
cd src/renderer && npm run dev
# 这种模式下没有 Electron runtime，window.electronAPI 是 undefined，
# 只适合做纯 UI 调试。IPC 相关的代码要走 npm run dev（全栈）。

# 全栈开发（推荐，vite 端口 5180，避免与其他本地项目 5173 冲突）
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
- 根目录和 `src/renderer/` 是两个独立的 npm 项目，渲染进程有独立的 `package.json` 和 `vitest`/`@playwright/test` 依赖。渲染层测试用 `cd src/renderer && npx vitest run`（jsdom + `@vue/test-utils`，`src/renderer/vitest.config.ts`）—— 注意 `npm run test:main` **只跑** `tests/main`，不含渲染层。
- 渲染层测试（`cd src/renderer && npx vitest run`）与主进程测试（`npm run test:main`）是两套，改渲染层时两个都要跑；`npx vue-tsc --noEmit` 也在 `src/renderer` 下执行。
- `tests/main/` 目录镜像 `src/main/` 结构，测试文件命名对应源文件。

---

## 代码风格

### TypeScript / Node.js
- `src/main/` 是 Electron 主进程全部代码（入口、preload、业务逻辑）；`src/renderer/` 是 Vue 3 前端。
- `src/renderer/src/composables/useElectron.ts` 是唯一接触 `window.electronAPI` 的文件；其他文件必须 `import { X } from '../composables/useElectron'`。
- 禁止直接 `window.electronAPI.X(...)`。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`；路由用 hash mode。
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色。
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用；禁止在界面里用 emoji / Unicode 符号当图标。**新增图标前必须先查 `Icon.vue` 里的 `icons` 映射确认该键已注册**，未注册要按现有风格补上（import 一行 + 映射一行）。
- 渲染进程的纯函数工具放 `src/renderer/src/utils/`（如 `time.ts` 的 `formatRelTime`）；跨组件复用的逻辑不要各写一份。
- **例外（文件树语言图标）**：文件树按扩展名显示彩色语言 logo，用 vscode-icons 提取的本地 SVG 资产（`src/renderer/src/assets/file-icons/`），在 `FileTree.vue` 通过 `EXT_ICON` 映射 + `import.meta.glob` 按需引用；UI 其余部分仍统一 lucide。
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
- `src/main/jsonl.ts`：扫描 `~/.claude/projects/` 的会话 jsonl（产出 `SessionMeta`），chokidar 监听项目列表变化；`setExcludedProjects` 支持排除目录（任务工作目录必须排除，见第 17 节）。
- `src/main/session-meta.ts`：`RecentSessionRecord` 定义 + `mergeRecentAgentField` 纯函数（recents 的 agent 字段合并进 jsonl meta）；`terminated` 标志记录用户在终端里主动 `/exit`，openTerminal 据此改走 PtyMode.New 而非 `--resume`（见第 3 节）。
- `src/main/favorites.ts`：收藏夹持久化（`~/.lynel-desktop/favorite-sessions.json`），文件缺失/损坏一律空数组不阻塞启动；渲染层对应 `stores/favorites.ts` + `FavoriteStar.vue`，收藏项支持以该目录新开会话。
- `src/main/auth-persistence.ts`：登录态加密持久化（`safeStorage` 加密 JWT 存 electron-store）+ 启动分流 `decideRestore`（云关+有用户名→首页 / 云开+有 JWT→自动登录 / 否则表单）。
- `src/main/providers-apply.ts`：供应商激活写入的纯函数集合（按 agentKind 生成 claude settings env / codex config 覆盖 / opencode·omp env），不依赖 App 实例。
- `src/main/dsh-cookie.ts`：用 dsh 启动 token 换 cookie，以 `SameSite=None` 写入 Electron session，让 harness iframe 能通过 dsh web 鉴权（跨站上下文存不下 `SameSite=Strict` cookie）。
- `src/main/wecom-scan.ts`：企业微信扫码添加 bot（生成二维码 + 轮询结果，`scanGen` 代际计数隔离并发轮询）；渲染层对应 `QrScanDialog.vue`。
- `src/main/terminal-screenshot.ts`：终端缓冲渲染 PNG（`@napi-rs/canvas` 懒加载，原生绑定缺失时降级报错），供 WeCom `/screenshot` 指令使用。
- `src/main/workdir.ts`：`normalizeWorkdir` —— 空白工作目录回退用户主目录。
- `src/main/session.ts`：模块级 session 注册表（`Map<string, Session>`），提供 `newSession`/`register`/`lookup`/`remove`/`list`/`send`/`writeInput`/`resize`/`close`/`rebind`/`setProcess`/`setState`/`touch`/`appendBuffer`/`getBuffer` 等函数。**没有 `SessionManager` 类**。
- `src/main/pty.ts`：基于 `node-pty` 启动交互式 Claude，包含 `PtyMode` 枚举、darwin shell-env 解析/缓存、`probeBin` 预探测、`PtyExitInfo` 诊断等。
- `src/main/hookserver.ts`：Express HTTP server，接收 Claude hooks。端点：`/hook`（Claude hook POST）、`/api/send`（外部发送消息）、`/api/sessions/:id/calls/stream`（SSE 流）。**不再有 `/api/sessions/{id}/calls` 和 `/api/calls/{seq}` 端点**（trace 数据已改为 IPC 方式）。
- `src/main/agents/`：多 Agent 支持。`AgentSpec` 注册表（`registry.ts`，含 claude/codex/opencode/omp 的 command/format/envVar/upstream/probe 等）+ `AgentKind` 类型。`app.ts` 按 `spec` 分派注入（claude 走 `--settings` 临时文件 + codex 走 `-c model_providers.<name>.base_url` 覆盖 + opencode/omp 走 env）、启动命令、PtyMode 与认证提示。
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
- `src/main/git.ts`：Git 面板的唯一入口，用 `simple-git` 包装系统 git CLI（与 VSCode 同理：不重新实现 git）。覆盖状态 / 暂存 / 提交 / 远程操作、按 revision 取文件、提交历史图、单个提交详情、分支、stash、blame、reset。`.git` 目录用 chokidar 监听，500ms 合帧后推 `git:changed`。
- `src/main/files.ts`：代码工作区的文件操作（列目录 / 读 / 写 / 新建 / 重命名 / 删除）+ 工作区 watcher（推 `file:changed`）。**不用 chokidar**：它给树内每个路径各建一个 `fs.watch`（单仓库 ~4000 句柄），改用原生 `fs.watch(workDir, { recursive: true })`，忽略逻辑按路径分段跑 `isIgnored` 等价子树剪枝。
- `src/main/shell.ts`：项目终端（每会话一个交互式 shell PTY）。复用 `pty.ts` 的 `raw` 直通模式绕开 win32 的 `cmd.exe /c` 包装（多一层 cmd 会让 Ctrl+C 语义变形），输出经**独立**的 `OutputBatcher` 以 `shell:<sid>` 事件推送 —— 与 Claude PTY 的 `session:<sid>` 通道分离，复用会串流。
- `src/main/tasks/`：定时任务（`claude -p` 无头执行 + cron 调度 + SQLite 存事件流），自洽子系统，不接 apiproxy / Trace / 云通道，见第 17 节。

### 3. Session 生命周期与 PTY
- **创建**：`App.createSessionInternal(workDir, prompt, extraArgs, autoTrust, botId?, agent?)` 是唯一入口。
  1. 用 `randomUUID()` 预生成 session ID。
  2. 启动 `APIProxy`（直接使用预生成的 UUID，不需要临时代理后迁移）。
  3. 按 agent 注入（`buildAgentInjection`）：claude 创建临时 `--settings` 覆盖文件（注入 `ANTHROPIC_BASE_URL` + hooks + `bypassPermissions`），**不修改全局 `~/.claude/settings.json`**；codex 用 `-c model_providers.<name>.base_url="<proxyUrl>"` 覆盖 config.toml；opencode/omp 用 env 注入 `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL`。
  4. claude 用 `PtyMode.New` + `--session-id <id>` + `--settings <tmpFile>` 启动交互式 Claude；非 claude 用 `PtyMode.Auto`（不传 session 参数）+ 各自 env 注入。
  5. `session.newSession()` + `session.register()` 注册到模块级 Map。
  6. `wirePty()` 连接 PTY 数据流（经 `OutputBatcher` 合帧后推送渲染进程）。
- **采纳（adopt）**：`adoptSession` IPC 对 Lynel Desktop 启动前已存在的历史 session 做注册，不启动进程。
- **打开终端（openTerminal）**：点击已有 session 时启动或复用 PTY；**按会话的 agent（从 recents 查）恢复**——claude 用 `--resume <sid>`（jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD）或 `--session-id`（jsonl 缺失/已 terminate 时）；codex/opencode/omp 用 `PtyMode.Auto`（无 session 参数）+ `buildAgentInjection` 注入。bin 路径按 `${agentKind}_path` 读设置，回退 `spec.command`。
- **发送消息**：`session.send(id, prompt)` 向 PTY 写裸文本，自动补 `\r`。
- **会话迁移（rebind）**：`session.rebind(oldId, newId, workDir)` 把 session 从旧 ID 迁移到新 ID（不 kill 进程，保留 process/buffer 引用）。用于 Claude `/clear` 后新 sessionId 接管当前 PTY，或 `/resume` 切换到历史会话的场景。
- **退出检测**：`exit-detect.ts` 的 `consumeInputForExitDetect()` 解析 PTY 输入流中的 ANSI 转义序列并识别 `/exit`/`/quit`（触发 session 结束）、`/clear`（触发 `rebind`）、`/resume`（触发 `rebind`）。
- **关闭**：`session.close(id, signal?)` kill 进程并标记 `done`；`session.remove(id)` 额外从 Map 删除并触发 `onRemove` 回调。
- `PtyMode` 三种 mode：
  - `New`：`--session-id <sid>`，新建 session 使用，传入预生成的 UUID。
  - `Resume`：`--resume <sid>`，jsonl 已存在的 sid 必须用它，否则 Claude 会 DEAD。
  - `Auto`：不带 flag，保留兼容性（一般不用）。
- PTY 启动前会做 darwin shell-env 解析（缓存到 `~/.lynel-desktop/darwin-env.json`），以及 `probeBin` 预探测（`claude --version`）。
- **启动链三条硬约束**（0.0.32 修复）：
  1. `probeBin` 用异步 spawn + 超时树杀（`execFileSync` 超时只杀得到 cmd.exe，背后的 claude 成孤儿）；**超时不判失败而是放行**交给 PTY spawn 暴露问题（主进程上下文探测可达 3~8s+，超时 ≠ binary 坏），成功结果按 bin 缓存（`probeOkCache`，失败不缓存）。
  2. `openTerminal` 有 in-flight 去重表（key=session id）：渲染层「列表点击 + xterm 挂载」会对同一 session 双发 open IPC，`s.process` 尚未设置的窗口内会双 spawn，产生表外孤儿 claude 并并发写坏同一 jsonl。
  3. 启动失败发 `{"type":"startup-error"}` 结构化信号，`XtermTerminal.vue` 识别后展示「错误 + 重试」覆盖层，**不再往终端写纯文本**；proxy 启动失败同样 resolve 让前端继续。
- **关闭不泄漏 conhost**：win32 上关闭会话必须杀掉 ConPTY 拉起的 headless conhost（跟着 PTY 句柄走），否则每次开关会话泄漏一个孤儿进程。

### 4. PTY 输入与 xterm.js 渲染（关键）
- 向交互式 Claude PTY 发送用户消息必须是裸文本，并以回车结束；没有回车 Claude 不会执行。
- `session.send(prompt)` 会做最小规范化：如果 prompt 没有以 `\n`/`\r` 结尾，则自动补 `\r`；已有回车不会重复追加。
- `session.writeInput(id, data)` 是原始字节写入通道，不追加回车。用于发送控制字符（Ctrl+C 等）。
- 主进程转发 PTY 原始 ANSI 字节；前端 `XtermTerminal.vue` 直接写入 xterm.js。
- `XtermTerminal.vue` 启动时显示 loading 菊花，直到 xterm buffer 中真正存在可见行时才隐藏；同时保留 30s 和 5s 两级兜底隐藏。
- 终端尺寸随容器变化自动调整：`ResizeObserver` 触发后 150ms debounce，再调用 `fitAddon.fit()` 计算新 `cols/rows`；只有尺寸真的改变时才调用 `ResizeTerminal` 通知 PTY。
- PTY 输出经 `OutputBatcher`（16ms 合帧窗口）合并后再通过 IPC 推送给渲染进程，避免高频 chunk 导致 IPC 洪峰。`session.appendBuffer` 的本地缓冲仍逐 chunk 追加。发送 done / 错误提示等 out-of-band 消息前必须调用 `batcher.flush(id)` 保序。
- xterm 额外加载 `addon-webgl`（渲染器）+ `addon-unicode11`（CJK / emoji 宽度），两者都必须在 `term.open()` 之后加载。WebGL 在大 scrollback + 高频流式输出下显著降低渲染开销；加载失败或运行中丢失 context 时 `dispose()` 后静默回退内置 renderer（只影响性能，不影响功能）。
- `XtermTerminal.vue` 里有依赖 xterm **内部私有 API** 的两处补丁（`_charSizeService.measure()`、`_viewport._sync()`）。升级 xterm 时必须回头确认它们还在 —— beta.291 → beta.304 时 `_core._renderService.onCharSizeChanged` 就被移除了（渲染层重构），只能改用 `CharSizeService`。

### 5. Hooks
- **配置方式**：不再修改全局 `~/.claude/settings.json`。`app.ts` 的 `createSettingsOverrideFile()` 在 `os.tmpdir()/lynel-desktop/` 下创建临时 settings 文件，通过 `--settings <tmpFile>` 传递给 Claude。文件包含：
  - `env.ANTHROPIC_BASE_URL`：指向本地代理。
  - `hooks`：4 类 hook（`PermissionRequest` 14400s、`PreToolUse` 5s、`PostToolUse` 5s、`PostToolUseFailure` 5s）。
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
  - `wecom-channel.ts`：动态加载 `@wecom/wecom-openclaw-plugin`，将阶段数据发送到企业微信；处理 PermissionRequest 模板卡片推送与 `#allow/#deny` 命令；支持控制指令（`/interrupt`、`/ctrl-c`、`/escape`、`/ctrl-d`、`/ctrl-z`、`/screenshot`）。另有**定时任务指令** `/tasks` 与 `/run <序号|名称>`，经 `setTaskBridge` 注入（通道不直接依赖 tasks store），触发走的是与桌面「立即执行」同一个 `scheduler.runTaskNow`（去重口径一致，否则手机上连发两次会起两个 claude 写同一个 jsonl）。
  - `localfile-channel.ts`：将阶段事件写入本地 JSONL/JSON 文件，过滤流式 text/thinking 碎片。
  - `state-channel.ts`：把 `LynelEnvelope` + `HookEventLike` 映射为 session 状态（idle/running/awaiting_permission/done）和活动（thinking/working/streaming/idle/awaiting_permission），通过回调驱动前端 UI 更新（会话状态展示与状态点）。
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
| `/screenshot` | `__screenshot__`（哨兵） | 截取当前终端画面（`renderBufferToPng` 渲染 PTY buffer → PNG 发送） |
| `/tasks` | 前缀指令（`parseTaskCommand`） | 列出所有定时任务（序号 / 名称 / 调度 / 状态 + 下次运行） |
| `/run <序号或名称>` | 前缀指令 | 立即执行某个定时任务；`resolveTaskArg` 依次按 序号 → 完整 id → 名称全等 → 名称唯一前缀 消歧，歧义时报错不猜 |
| `/help` | `__help__`（哨兵） | 发送 markdown 帮助 |

**处理流程：**

1. **入口拦截**（入站消息）：`extractInboundText()` 提取文本（text / mixed）→ 剥离 `@botname` 前缀 → 去末尾换行 → `CONTROL_COMMANDS[text]` 命中则进 `handleControlCommand()` 并 `return` → 未命中再试 `parseTaskCommand()`（`/tasks`、`/run <参数>`，**带参数所以不进上面那张精确匹配表**）→ 都没命中才走普通文本转发。控制指令要求整条消息精确匹配，带多余字符不触发。`taskBridge` 未注入时任务指令会退回普通转发。
2. **分发**：`handleControlCommand()` → `__screenshot__` → `handleScreenshot`；`__help__` → `handleHelp`；其余 → 解析目标会话 → `session.writeInput(sessionId, controlChar)`（原始字节，**不追加 `\r`**）→ 回执「已发送 xxx」。
3. **目标会话解析**（与普通消息一致的三级路由）：引用消息头部（`**project** · 会话#N · xxxxxxxx` / `会话#N`，经 `resolveSessionArg` 依次 序号 → 精确 ID → 前缀唯一匹配）→ bot 绑定反查（`currentBotId` → `sessionBotMap`）→ 兜底（`getMapping` / `chatIdToSession` / `lastActiveSession`）。无目标 → 回「当前没有绑定会话，无法发送控制指令。」
4. **截图特例**：`session.getBuffer()` 取终端原始缓冲 → `renderBufferToPng` → 走 bot 的 `wsClient.uploadMedia` + `sendMediaMessage` 发 PNG。
5. **帮助特例**：`resolveBotForChat` 找 bot → 发 markdown 指令表。

### 11. 两栏布局与每会话子页（Two-Panel Layout）

- 布局结构：左侧栏（280px，可折叠为 44px） | 中间内容区（flex:1）。**没有右侧 Trace 侧栏**。
  - 左侧栏（`HomeView.vue`）：顶部收起按钮 + 云状态；入口按钮（首页 / DeepSeek Harness / 搜索）；中部 SessionList；底部（账户 / 使用指南 / 设置）。
  - 中间内容区：GlobalTabs（首页 / 会话 / 设置 / 使用指南 / Harness）+ `.content`。
  - 会话标签页内是「**终端 / Trace / 文件**」三个子页（`activeSubTab` + `subTabBySession` 按会话记忆）。Trace 不再是固定侧栏，而是每会话独立的全屏子页。
- **终端子页左右分屏**：点终端输出里的 **workdir 内**文件路径不再跳「文件」子页，而是在终端右侧开出文件编辑分屏（左终端 / 右编辑器，中间可拖宽，右栏可收起）。目录与 workdir 外的路径仍走系统默认程序，由 `terminal/FileLinkProvider.ts` 分流，只有 workdir 内文件才 emit 到 `HomeView.onTerminalOpenFile` → `files.openInSplit()`。展开态存在 `stores/files.ts` 的 `splitOpen`；宽度是全局 localStorage `lynel:editor-split-width`（默认 480，钳制 320–动态上限，保证左侧终端至少 400px）。
  - 展开态**与文件现场一起按会话记忆**，恢复时有守卫：`saved.splitOpen && saved.openFiles.length > 0` —— 上次开着右栏但文件都被关掉了的会话，切回来不再恢复空右栏。注意这与「运行中关掉最后一个 tab」不同：后者右栏**保持展开**并显示编辑器空态（见下条 `hostInSplit` 的说明），只有切走再切回才不恢复。
- **编辑器区只有一个实例**：`FileEditorPanel`（= `FileTabs` + 互斥的 `CodeEditor` / `CodeDiffView`）挂在「分屏右栏」或「CodeView」两处之一，由 `HomeView` 的 `hostInSplit` 同一个条件驱动 `v-if` 互斥。**不能让两个实例并存** —— `CodeEditor` 用 `file:///${relPath}` 建 Monaco model，Monaco 对同一 URI 只允许一个 model，第二个实例直接抛 `Cannot add model because it already exists!`。分屏右栏那一侧必须用 `v-if`（不能只靠子页的 `v-show`），因为切到 Trace / 文件子页时终端子页只是被 `v-show` 隐藏。
- **切换瞬间也只有一个实例，靠的是 `CodeEditor.vue` 里的两处时序**：宿主互换时 `.sub-pane` 的补丁顺序会「先挂新 `CodeEditor`、后卸 `CodeView` 里的 `FileEditorPanel`」。之所以不冲突，是因为 (1) **调用方**在 `onMounted`（`CodeEditor.vue:272`）与 `watch(activeRelPath)`（`:207`）里先 `await nextTick()` 才调 `switchModel()`，而 `onMounted` 本身就是 post-flush 回调，`switchModel()` 内部还要再经 `ensureMonaco` / `ensureEditor` / `languageForPath` / `installTextMate` 等 await 才 `createModel()`（`:176`）；(2) 旧实例的 `model.dispose()` 在 `onBeforeUnmount`（`:280`）里**同步**执行。两者叠加 → 新的 `createModel` 总在旧 model 消失之后跑。**改动这两处 `nextTick` / `dispose` 时序前，必须先回来确认这条不变量还成立**，否则会出现两个 model 争同一 URI 的短暂窗口。
- 已知代价：宿主切换（终端子页 ↔ 文件子页、展开 / 收起分屏）会重建 Monaco 编辑器，**撤销栈丢失**；文件内容不丢（草稿在 `stores/files.ts` 的 `drafts`）。
- `styles/code.css` 的 `.code-workspace-theme` 是 `.code-view` 与 `EditorSplitPane` 共用的变量重映射类（把 UI 变量映射到 `--term-*`）。新增代码工作区容器时**必须挂这个类**，否则编辑器 / Git 面板配色会回退成 UI 面板色。
- `composables/useResizablePanel.ts` 是**代码工作区**拖宽面板的实现（`CodeView` 文件树 / `GitPanel` 变更列表 / `EditorSplitPane` 右栏共用），这三处不要再各写一份。**但它不是全仓唯一**：任务面板的 `components/tasks/TasksPane.vue`（`lynel:tasks-list-width`）与 `components/code/BottomPanel.vue`（垂直拖高）各有一份自己的拖拽实现 —— 将来若统一，把它们一并收编，别以为改这一个就够。`handle` 表示手柄所在边：`'right'` 是面板在左、向右拖变宽；`'left'` 是面板在右、向右拖变窄。
- TracePane：`src/renderer/src/components/trace/TracePane.vue`，会话子页的全屏面板
  - 顶部工具栏：请求数、总费用、刷新按钮、图过滤（model/errorsOnly）
  - 左侧请求缩略列表（240px，v2 分页 + 摘要索引）：状态点 · #seq · model · tokens · 延迟
  - 右侧 RequestDetailPane：单条请求详情（从完整 `<seq>.json` 按需加载）
  - 分页：初始加载 50 条，滚动到顶部触发 `loadMore()`
  - 状态覆盖：loading 骨架屏 / error 重试 / 空状态（"暂无 API 请求"）
- Trace store（Pinia）：`src/renderer/src/stores/trace.ts`（v2 分页）
  - 状态：workDir/sessionId/requests/detail/diffResult/loading/loadError/hasMore
  - 摘要索引：`_summaries.jsonl`（每行 ~200 字节，apiproxy 追加写入）
  - 数据来源：`_summaries.jsonl`（列表）+ `<seq>.json`（详情按需加载）
  - `load()` 首页 50 条，`loadMore()` 滚动分页，`fetchNew()` 增量加载（`sinceSeq`）
  - 图过滤（model/errorsOnly）变化时自动重新加载首页
  - 会话切换统一走 `trace.setSession(wd, id)` + `trace.load()`（HomeView `watch(activeSessionId)`），覆盖 SessionList 点击 / GlobalTabs 切换 / 最近会话打开 / 新建会话
- DeepSeek Harness：独立 tab，iframe 面板（`.dsh-frame-wrap`），始终挂载、非激活时 opacity:0 垫底（避免冻结重载）
- 已删除：`TraceSidebar.vue`、`TraceOverlay.vue`、`TraceTab.vue`、`TraceHeader.vue`、`RequestList.vue`、右侧 Workspace 面板
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

### 15. DeepSeek Harness（dsh）

- 进程管理：`src/main/dsh.ts` 的 `DshManager` 单例，`dsh:ensure` / `dsh:shutdown` IPC（`app.ts`）。
- 加载策略：**与 claude 一致，使用用户全局安装的 dsh**（`npm install -g @deepseek-ai/dsh`），Lynel **不内置** dsh 依赖。版本由用户用 npm 管理，命令行可直接管理插件（`dsh plugin`）。
  - 启动：`buildCommand()` 先探测 `dsh --version`（未安装则报错提示 `npm i -g @deepseek-ai/dsh`），Windows 用 `cmd.exe /c dsh web --port 0`（`.cmd` shim），其他平台直接 `dsh web --port 0`。
  - **不要**让 Lynel 依赖 `@deepseek-ai/dsh`：`node_modules/.bin/dsh` 会抢占 PATH，导致 `cmd.exe /c dsh` 解析到内置 bin 而非全局（claude 无此问题，因为 Lynel 不依赖 claude）。
  - win32 目录选择走 dsh 原生对话框，**不要**注入 `SSH_TTY=1`（那会强制页面内 browse、绕开本地弹窗）。此前注入过是为绕开 dsh win32 对话框 worker 竞态（"worker exited before reporting a result"），已实测全局 rc.7 的 koffi 3.1.5 可正常加载，故移除。
- 就绪信号：解析 stdout 的 `dsh web: http://127.0.0.1:<port>`（`--port 0` 让 OS 分配随机端口），120s 超时 kill 进程树。
- **更新 dsh**：用户 `npm i -g @deepseek-ai/dsh@latest`，不随 Lynel 发版。
- **插件管理**：共享 `~/.dsh`（默认 `DSH_HOME`）profile。命令行 `dsh plugin --profile web add <pkg>` 加插件（内部转 pnpm，需系统 pnpm），装进 `~/.dsh/profiles/web/`（`dsh.profile.bundles` + `cordis.patch.yml`）。Lynel harness 用 web profile；dsh 单例常驻不热加载，改 profile 后需重启 dsh/harness（重启应用或杀 dsh 进程）。

### 16. Git 面板与文件工作区

**布局**：「文件」子页（`CodeView.vue`）= 左侧文件树（可拖宽）| 编辑器区；编辑器区底部是横跨全宽的 `BottomPanel`，含「Git / 终端」两个标签（`v-show` 常驻 —— 切走再切回不能丢 xterm buffer 或重建 PTY）。

**编辑器区**：`FileTabs` + 两个 `v-show` 的 slot，由 `stores/files.ts` 的 `activeView`（`'file' | 'diff'`）决定显示 `CodeEditor` 还是 `CodeDiffView`。两者显隐用**互斥的 computed**（`showDiff` 与 `showEditor = !showDiff`）控制 —— 各自独立判断时，`activeView` 一旦取到意外值（如热更新后 store 实例陈旧、缺字段）会两个 `v-show` 同时为假，编辑器区整块空白。

**diff 是并列的 tab，不是覆盖层**：
- `diffRequest = { relPath, left, right, label }`，`right === 'WORKTREE'` 表示右侧取工作区文件内容。
- 变更列表用 `openDiff(path, 'HEAD', 'WORKTREE', '工作区')`；查看历史提交里的文件用 `openDiff(path, hash + '^', hash, shortHash)`（`<hash>^` 对根提交取不到，左侧归零为空，正好呈现「整个文件都是新增」）。
- **两侧 URI 必须互不相同**：未暂存的 diff 两侧 rev 都是 `'HEAD'`，只用 `?rev=` 会解析成同一个 URI，而 Monaco 的 ModelService 对同一 URI 只允许一个 model，第二次 `createModel` 直接抛 `Cannot add model because it already exists!`。故 URI 里带 `side=original|modified` 区分。

**GitPanel 是横向分栏**：左栏固定像素宽（可拖，200–640px，存 `localStorage` 的 `lynel:git-changes-width`）+ 右栏历史图自适应剩余宽度。用固定像素而非比例是为了配合拖拽。

**提交历史图**（`logGraph`）：用 `git log --graph --decorate=full --format=...`。解析时的关键点 —— commit 之间会插入**纯图形行**（只有连接线、不含任何字段），必须先判断行首图形前缀之后是否真有内容再决定是否消费后续 6 行，否则整体错位。

**单个提交详情**（`commitDetail`）：`git show --first-parent --name-status`。合并提交默认不输出文件列表（合并 diff 为空），`--first-parent` 让它相对第一父比较，点开才有内容。

**blame**（`blameFile`）：`git blame --porcelain` 的元信息（author / author-time / summary）**只在某个 commit 首次出现时输出**，之后引用同一 commit 的块只有块首行。必须按 hash 缓存元信息，否则后续行会**静默继承上一个 commit 的作者**。前端只给**光标所在行**挂行尾 `after` 装饰（GitLens 的默认形态），不给整文件打注解。

**reset**（`resetTo`）：soft / mixed / hard 三种模式，`hard` 不可逆 —— 二次确认的责任在前端（`GitPanel.vue` 的 `onReset`），文案要如实写明各模式的波及面。

**退出清理**：git watcher 挂在 `git.ts` 的**模块级 Map** 上（不归 App 实例管），所以 `App.shutdown()` 必须显式调 `closeAllGitWatchers()`；文件 watcher 由 `watchCleanup` 覆盖。会话关闭时 watcher 不通过 `setOnRemove` 释放，而是跟着「当前会话切换」走（`setSession` → `GitUnwatch(旧目录)`）—— 前提是 watcher 只服务当前会话。

`src/renderer/src/utils/time.ts` 的 `formatRelTime` 被提交历史与 blame 共用，不要各写一份。

**编辑器语言与语法高亮**：
- `monaco/languages.ts` 的 `languageForPath()` 从 `monaco.languages.getLanguages()` 构建「扩展名 / 文件名 → 语言 id」索引，**不要手写映射表**：手写的覆盖不全（原先只有 10 条扩展名）、会随 Monaco 升级漂移，而且原先由 `CodeEditor` 与 `CodeDiffView` 各写一份，已经漂移过一次（diff 那份漏了 yaml）。纯匹配逻辑在 `monaco/langIndex.ts`，与 `setup.ts` 解耦（setup 顶部有 `?worker` 资源 import，node 下跑单测会炸），可直接单测。
- `monaco/textmate.ts` 对**白名单语言**（markdown / yaml / ini）用 `vscode-textmate` + `vscode-oniguruma` 替换 Monaco 内置的 Monarch tokenizer —— 只挑 Monarch 明显不足或缺失的，因为 textmate 逐行用 oniguruma 扫描，比 Monarch 慢。语法文件在 `monaco/syntaxes/`（取自 VSCode 仓库，MIT），动态 import 按需加载；oniguruma 的 wasm 用 `?url` 取。
  - **必须在 `createModel` 之前调 `installTextMate`**，否则 model 已经用 Monarch tokenize 过了。
  - 不在白名单、已装过、或加载失败都是 no-op，失败静默回退 Monarch（高亮粗一点，不影响可用性）。

### 17. 定时任务（Tasks）

**入口与页面**：左栏「任务」（`HomeView.vue`，收藏夹按钮之前，折叠态另有一个「先展开侧栏再开 tab」的 handler）打开 `tasks` tab（`types/tab.ts` 的 `TabType` + `stores/tabs.ts` 的 `openTasks()`）。内容区 `components/tasks/TasksPane.vue` 是三段式（左任务列表 / 右任务详情 / 运行流水），与 `TracePane.vue` 同构。**UI 里没有「工作目录 / 项目」概念**，表单只有一行提示「要操作其他项目请在 prompt 里写绝对路径」。

**模块划分**（`src/main/tasks/`）：
- `paths.ts`：唯一工作目录 `tasksDir()`（读设置 `tasks_dir`，空则回退 `~/.lynel-desktop/tasks/`）+ `ensureTasksDir()`（`mkdir -p` + 落初始 `CLAUDE.md`，已存在不覆盖）。默认值**不要**指向安装目录：macOS 会破坏 `.app` 签名、electron-updater 升级会原地替换导致数据丢失、asar 内只读。
- `db.ts`：**`node:sqlite` 的唯一接触点**（open / `PRAGMA journal_mode=WAL` / migration / close；`setDbFile()` 供测试切库）。库文件 `~/.lynel-desktop/tasks.db`。schema **v2** 加了 `schedule_start_at` / `schedule_end_at`（生效区间）—— 必须走 `addColumn()` 的 `PRAGMA table_info` + `ALTER TABLE`，`CREATE TABLE IF NOT EXISTS` 只对全新库生效，老用户的库不加列就会 no such column。
- `store.ts`：纯 CRUD + run 状态机，无业务逻辑。四张表 `tasks` / `runs` / `run_events` + `meta`(schema_version)。**`tasks` 表没有 `workdir` 字段**（cwd 是常量）；`run_events.payload` 存**原始 JSONL 行**（写入侧零解析，CLI 升级不丢字段，解析只在读取侧）；`deleteTask` 手动级联删 runs / run_events —— 表间没有外键（`runs.task_id` 未声明 REFERENCES），不删就只增不减。
- `schedule.ts`：**纯函数**（不碰 DB、不碰时钟，时间一律由调用方传入）。调度模型是「一个 cron 表达式 + 可选的生效区间」：
  - `Schedule` = `daily`（`M H * * <dow>`）| `interval`（分钟 `*/N * * * <dow>`、小时 `0 */N * * <dow>`、天 `M H */N * *`、月 `M H <几号> */N *`）| `once`（`run_at`）| `cron`（原样）。
  - `scheduleToCron` / `cronToSchedule` 互转；`scheduleOf(row)` 从任务行还原（scheduler / IPC / 表单回填共用，**别再各写一份** —— 漏一处就会把生效区间抹平）；`computeNextRun` 用 `croner` 的 `nextRun()` + `startAt`/`stopAt` 选项（生效区间不进表达式，cron 没有日期边界）；`describeSchedule` 出人读摘要；`isWindowClosed` 供 scheduler 停用过期任务。
  - **两处硬约束**：①「每天 / 按间隔·分钟 / 按间隔·小时」的星期落 cron 的 dow 字段（唯一星期来源，语义精确）；「按间隔·天 / 月」的 dow 会与 日/月 字段构成 **OR** 语义（实测 croner 同样：`0 9 */2 * 1` 在「每 2 天」**或**「周一」都触发），拼不出「每 2 天的周一」，故这两档**拒绝**受限星期并抛错。② `computeNextRun` 必须吞掉 `scheduleToCron` 抛的错（空的 / 越界表达式）返回 null：它由 30s 一次的 tick 调用，抛一次整个调度器停摆。
  - 常量：`CATCH_UP_MS`(60min) / `QUEUE_TIMEOUT_MS`(30min) / `RUN_TIMEOUT_MS`(30min)。
- `streamParse.ts`：**纯函数**，NDJSON 行 → 归一化事件（`parseStreamLine`）：`tool_result.content` 三态归一化、`usage` 白名单（原始 usage 含嵌套对象与字符串字段，直接 `Object.entries` 会渲染出一堆 `[object Object]`）、空 thinking block 过滤、`isResumeMissing`。**解析只在主进程做一次**（主 / 渲染是两个 bundle，不能互 import），`tasks:runEvents` IPC 返回的是归一化后的事件对象，渲染层只做折叠。
- `runner.ts`：单次 run 的生命周期（spawn / 逐行消费 / 落库 / 推送 / 超时 kill / resume 回退）。**不建 run 记录**（调用方已建好 `queued`）。stdout 手写按 `\n` 切行（不用 `readline`：它会自作主张解析且不保序）；stderr 也进流（`type='stderr'`）并留尾部 20 行作为「无 result 事件」时的 error 文本；**成败以 `result` 事件的 `subtype` / `is_error` 判，exit code 只兜底**（存在 `subtype=success` + exit 0 但实际失败的场景）；没有 `result` 事件则无论 exit code 一律判 error。
- `scheduler.ts`：模块级单例，30s tick + 内存队列 + 并发闸门（`tasks_max_concurrency`，默认 6）。tick 顺序：取启用任务 → `isDue`（`not_due` / `due` / `missed`；超 60min 补跑窗的 `missed` 直接推进 `nextRunAt`，`once` 类型标 `missed` 且 `enabled=0`）→ **单任务去重**（该 task 已有非终态 run 就跳过，不建 run 也不推进时间）→ 建 `queued` run + **先落库再入队**（崩溃恢复靠它）→ `drain()`。出队时 `now - enqueuedAt > 30min` 标 `skipped`；`markRunRunning` 必须**先写 running 再 start** —— 并发闸门数的是 running，不写会一口气把整个队列放出去。`nextRunAt` 为空时**只补算落库、不触发**（安全网，避免首次启动炸一堆）；正常情况下它在创建 / 编辑任务时就算好落库，表单预览和列表的「下次运行」直接可见。
- `templates.ts`：用户自建模板，存 `~/.lynel-desktop/task-templates.json`（**不开新表**：模板是纯预填数据，不参与调度与状态机，放进 tasks.db 就得为它做迁移）。写盘先临时文件再 `rename`；文件缺失 / 损坏 / 条目形状不对一律逐条过滤当空列表 —— 模板读不出来只是少几个快捷入口，不该让任务面板打不开。内置模板在渲染层（`utils/taskTemplates.ts`，纯数据）。
- `index.ts`：`initTasks(getMainWindow)`（照 `updater/index.ts` 的先例）+ `tasksShutdown()` + **15 个 IPC handler**（list / get / create / update / delete / setEnabled / runNow / cancel / runs / run / runEvents / preview / templates / saveTemplate / deleteTemplate）+ 三个推送（`tasks:changed` / `tasks:runChanged` / `tasks:runEvent`）。`tasks:preview` 同时回 `{ nextRuns, summary, error }` —— **渲染层因此不再需要第二份「预设 ↔ cron」模板逻辑**。claude 路径每次调用重读设置（`claude_path`，回退 `spec.command`）。

**任务结果的提示按「窗口在不在前台」分流**（`notifyTaskFinished` 是唯一判定点，两边都弹会重复）：前台（`windowAttention.isForeground()` = 可见 && 未最小化 && 有焦点）→ IPC `tasks:finished` → 渲染层右上角 toast（复用 `ToastCenter`，展示任务名 / 执行时间 / 结果，点击跳到那次运行）；后台 → 托盘气泡 `displayBalloon`（win32）/ 系统通知（mac/Linux 没有 displayBalloon）。**所有终态都提示，含成功**（早期版本只挑 `error` / `timeout` / `interrupted`，`NOTIFY_STATUSES` 过滤已删）。两个已知限制：`displayBalloon` 没有 click 回调（要跳转得点托盘图标），且它在 Win11 上与系统通知外观几乎一致。

**启动顺序**（`app.ts` 的 `registerIpcHandlers()`）：`ensureTasksDir()` → **`jsonl.setExcludedProjects([tasksDir()])`** → `initTasks()`。退出时 `tasksShutdown()`（停 tick → `killTree` 在跑的 run 并标 `interrupted` → 关库）。

**为什么必须排除**：任务 jsonl 与普通会话同根落在 `~/.claude/projects/<tasks-encoded>/`。不排除有三层冲突 —— 任务会话混进会话列表、chokidar 递归监听导致列表反复刷新、用户点开它让 Lynel 用同一 sid 起交互式 PTY **与任务进程并发写坏同一个 jsonl**。排除只作用于**枚举**（`scanAll` 跳目录、`watchProjects` 按相对路径首段剪整棵子树）；`listSessionIds` / `getSessionJsonlPath` 是按路径直查，**不受影响**，所以任务自己的 `--resume` 照常工作。

**会话模型**：一个任务一个会话（创建时 `randomUUID()`）。首次 `--session-id`，成功后 `setTaskSession(..., true)` 之后走 `--resume`（**漏了这步下次会拿同一个 id 去「新建」，claude 报 Session ID already in use，上下文再也接不上**）。resume 目标缺失（`isResumeMissing`：`error_during_execution` + `is_error` + `num_turns=0` + 全程无 assistant 事件）→ 用 `--session-id` 重建**一次**，`fallbackUsed` 闸门防止 1s 一轮的 spawn 风暴；**那个错误 `result` 里的 `session_id` 是新生成的随机 UUID，绝不能写回 `tasks.session_id`**，否则下次 resume 指向空会话、静默丢掉全部上下文。`runs.resume_used` 是**三态**：`1` 真用了 `--resume`、`0` 回退重建过、`null` 其余（尤其首跑）—— 渲染层只在 `=== 0` 时显示「会话已重建」，首跑写 0 会误报。

**Windows 的 spawn 解析**（`runner.ts` 的 `buildSpawnCommand`）：win32 上 claude 是 npm 生成的 `.cmd` shim，裸名 `claude` 会 `ENOENT`（Node 不做 PATHEXT 解析），直接指向 `claude.cmd` 会 `EINVAL`（Node ≥18.20 / 20.12 / 21.7 对 `.cmd` / `.bat` 无 shell spawn 的加固，CVE-2024-27980）。故用 `pty.ts` 的 `resolveBin` 找到 shim 后读它文本、代入 `%dp0%` / `$basedir`，解析出背后的原生 `.exe`，**让 claude 自己当直接子进程**（不退回 `pty.ts` 同款 `cmd.exe /d /c <shim>` 套壳：多一层 cmd 就多一层引号 / 转义与输出转码，且杀树、判活的对象会变成 cmd 而不是 claude）；解析不出（非 npm 模板的自定义包装、旧版 `cli.js` 形态、PATH 里根本没有）就返回 `ok:false`、**直接判失败、绝不 spawn** —— 套壳命令本身能跑起来，但一条「明确失败 + 可照抄的 `claude_path` 建议」好过引入没人验证过的兜底路径。非 win32 行为不变。

**spawn 选项：绝不能带 `detached`**（`runner.ts` 的 `spawnOnce`，踩过的坑）：win32 上 `DETACHED_PROCESS` 会让 `CREATE_NO_WINDOW` 失效（MSDN：二者同用时后者被忽略），claude 于是没有控制台 —— 它每起一个 shell（Bash 工具）Windows 就给那个 shell 分配一个**新控制台**，即用户看到的「跑任务时频繁的 cmd 闪窗」。实测（枚举可见顶层窗口做差集）`detached: true` 每次必现 `CASCADIA_HOSTING_WINDOW_CLASS :: cmd.exe`，去掉后为 0。同理，`killTree` 在 win32 上也**不走 tree-kill**（它是 `exec('taskkill ...')`，而 `exec` 默认 `windowsHide: false`，Electron 主进程没有控制台 → 每杀一次闪一次窗），改为自己 `spawn('taskkill.exe', [...], { windowsHide: true })`（命令与 tree-kill 的 win32 分支逐字相同），并经 `deps.killTree` 注入，单测不会起真进程。

**result 卡片正文不重复渲染**（`utils/tasks.ts` 的 `flattenRunEvents` + `RunStreamView.vue`）：`result.result` 按定义就是「最后一条 assistant 消息的文本」，而那条消息在流里已作为 `text` 条目渲染过 —— 于是同一段话出现两次，且第二遍是纯文本（Markdown 表格与 `**` 原样显示）。现在折叠时把 `resultText` 与末尾连续的 `text` 串按「忽略空白后相等」比对，相等则置 `textRepeatsAbove`、渲染层只留状态头；不相等（典型是失败时 result 才携带的错误原因）才用 `<Markdown>` 渲染正文。

**无头参数**：`-p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions` + `--session-id|--resume <sid>`。`--verbose` 必需，不带直接报错；`stdio: ['ignore','pipe','pipe']` 中 `stdio[0]` 必须是 `'ignore'`（claude 会等 stdin 最多 3 秒，用 `pipe` 且不关会永久卡住）；env 里 `delete CLAUDECODE`（否则从 Claude Code 会话内 spawn 会被「不能嵌套」守卫挡住）。

**启动恢复**（只做一次）：`status='running'` 的 run → 标 `interrupted`（进程已不在），`status='queued'` 的 run → **重新入队**（不丢）；恢复失败时 `recovered` 不置位，由后续 tick 重试。**残留（已接受，见 spec §6.2）**：恢复只改行、不杀进程 —— App 被硬杀（`taskkill /F` / SIGKILL / 断电）时 `killAllRuns()` 没机会执行，那个 claude 进程会活着继续跑（输出管道已断；非 detached 的子进程不随父进程退出而终止，故去掉 detached 后这条行为不变），启动恢复不会去杀它；不做 pid 持久化 + 启动扫杀，因为跨平台判活/杀树不可靠（pid 复用会误杀），代价大于收益。

**会话初始化标记的判据**：`session_initialized` 只在「**claude 真的把会话建起来了**」时置位 —— 非回退路径上 `a.events.length > 0`（解析出过任何事件，含 stderr）即算，**不是**只认 `status === 'done'`。只认成功的话，首跑一旦以 `error` / `timeout` / `interrupted` 收场就永远停在 0，下次又拿同一个 UUID 去 `--session-id` 新建 → claude 报 `Session ID already in use` → 任务永久失败且无自愈路径。回退分支里的 `setTaskSession(..., false)` 是另一回事，保持不动。同理，终态的 `last_run_at` / `last_status` 回写**覆盖全部终态**（不止 `done` / `error`），否则超时与被取消的任务在列表里一直挂着上一次的「成功」。

**resume 回退重建前必须 `clearRunEvents(runId)`**：第一趟已经把 `run_events` 的 seq 0..N 落库了，只把 `a.seq` 归零会让重建这趟的每次插入都撞 `PRIMARY KEY (run_id, seq)`，而 `recordLine` 的 catch 吞掉异常、`a.seq += 1` 又在这个 try 里 —— 整趟事件一条都存不进去（run 报成功、流水空白）。

**「立即执行」也走去重**：`runTaskNow` 先查 `listLiveRuns()`，该任务已有非终态 run 时**直接返回那个 run 的 id、不新建**（连点两下否则会起两个 claude 并发写同一 jsonl）；删除任务前先 `cancelTaskRuns(taskId)` 杀掉在跑的进程，再 `deleteTask`（级联删行的同时把进程留住 = UI 看不见也取消不了的孤儿 + 永久孤儿 `run_events`）。

**渲染层**：`components/tasks/{TasksPane,TaskList,TaskDetailPane,TaskFormDialog,RunHistoryList,RunStreamView,ToolStepCard}.vue` + `stores/tasks.ts` + `utils/{tasks,taskStatus,taskTemplates}.ts` + `types/tasks.ts`，共享类在 `styles/tasks.css`（`.btn` / `.pill` / `.chip` / `.seg` / `.week` / `.blank` 曾在四个组件里各写一份，已漂移过，别再抄回去）。`flattenRunEvents(events)` 是纯函数：按 `message.id` 分组（C1：assistant 是「一个 content block 一行」，同一 id 跨多行，不能按行边界切消息）、`tool_use.id` ↔ `tool_result.tool_use_id` 配对、StepCard 摘要映射、子代理按 `parent_tool_use_id` 缩进；`result.resultText` 与上方助手正文按「忽略空白后相等」判重（`textRepeatsAbove`），是同一段话就不重复渲染。

**详情页结构**：工具栏（名称 + `运行 / 历史·N` 分段 + 立即执行 + `⋯` 溢出菜单）→ 摘要 chips → 主体二选一（`stores/tasks.ts` 的 `detailView`）。**`select()` 会自动 `openRun(runs[0].id)`** —— 打开任务就有内容，之前停在空白要用户自己去历史里点一行。历史是 `RunHistoryList` 的时间轴（节点 + 连接线），不再平铺在详情下方。

**表单**：新建 / 复制是两栏（左栏模板可搜索 + 分组「最近使用 / 我的模板 / 内置」），编辑是单栏（内容已在，套模板会覆盖用户改动）。执行频率 3 种模式 + 自定义 crontab，**cron 表达式一律由主进程构造**；渲染层只做「UI 星期(1–7) ↔ cron 星期(0–6)」的映射（`uiDayToCron` / `cronDayToUi`）与 `daysLabel` 文案。星期用 34×34 圆角方片 + 工作日/周末/全选快捷。

**测试设施**：根 `vitest.config.ts` 存在**只为**把 `node:sqlite` alias 到 `tests/helpers/node-sqlite.ts` —— vitest 2.1.9 的 vite-node 把内置模块白名单写死成 `node:test`，不认识 `node:sqlite`，会把裸 id `sqlite` 丢给 Vite 解析而失败。生产代码仍直接 `import 'node:sqlite'`。`flattenRunEvents` 是渲染层纯函数，但测试放 `tests/main/tasks/flatten.test.ts`（不依赖 Vue / 浏览器，可用真实 fixture 驱动「解析 → 折叠」整条链路），这是有意打破 `tests/main/` 镜像 `src/main/` 的约定。

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
- 所有定时任务共用一个固定工作目录（设置项 `tasks_dir`，默认 `~/.lynel-desktop/tasks/`）：`tasks` 表没有 `workdir` 字段，UI 里也没有「项目」概念，prompt 里必须写绝对路径。
- 任务会话的 jsonl 必须从会话枚举中排除（`jsonl.setExcludedProjects([tasksDir()])`），且必须在**任何会话扫描之前**调用；否则任务会话会进会话列表，用户点开它会与任务进程并发写坏同一个 jsonl。
- `src/main/tasks/db.ts` 是 `node:sqlite` 的唯一接触点（experimental API，便于将来换实现）；其它文件一律经 `store.ts` 读写，不直接 import `node:sqlite`。
- 无头 `-p` 模式下 `stdio[0]` 必须是 `'ignore'`：claude 会等 stdin 最多 3 秒，用 `pipe` 且不关闭会**永久卡住**。
- `claude -p --output-format stream-json` 必须同时带 `--verbose`，否则直接报错。
- win32 上解析不出 claude 背后的原生 `.exe` 时**直接判失败、绝不套壳 spawn**：套壳起来后杀树 / 判活的对象是 cmd 而不是 claude，且多一层转义与输出转码。
- 任务进程的 spawn **绝不带 `detached`**：win32 上 `DETACHED_PROCESS` 会让 `CREATE_NO_WINDOW` 失效，claude 每起一个 shell 就弹一个可见 cmd 窗口（用户报过的「频繁闪窗」）；杀进程树的 taskkill 也必须带 `windowsHide`。
- resume 回退只允许一次，且失败 `result` 里的 `session_id`（新生成的随机 UUID）绝不能写回 `tasks.session_id`。

---

## 相关文档

- `README.md` —— 项目总览、完整数据流、目录结构。
- `docs/usage.md` —— 使用指南（安装、配置、企业微信集成、截图等）。
- `docs/user-guide.md` —— 面向最终用户的完整用户指南。
- `docs/macos-signing.md` —— macOS 签名 / 公证方案记录（待落地 build.yml）。
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
- `docs/superpowers/plans/2026-08-09-multi-agent-ui.md` —— 多 Agent 前端 UI 实施计划。
- `docs/superpowers/specs/2026-09-18-tasks-scheduler-design.md` —— 定时任务设计文档（调度 / SQLite 存储 / 流水渲染）。
- `docs/superpowers/plans/2026-09-18-tasks-scheduler.md` —— 定时任务实施计划。
- `docs/superpowers/specs/2026-09-22-terminal-file-split-design.md` —— 终端侧边文件编辑分屏设计文档。
- `docs/superpowers/plans/2026-09-22-terminal-file-split.md` —— 终端侧边文件编辑分屏实施计划。

---

## 备注

- `AGENTS.md` 已过时（版本号停留在 0.0.11，引用已删除的 `notch-window.ts`、错误的 hook 数量等），以本文件为准。
