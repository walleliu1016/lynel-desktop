# AGENTS.md

本文件供 AI 编码代理阅读，假设读者对本项目一无所知。

---

## 项目概览

**Lynel Desktop**（`package.json` name: `lynel-desktop`，当前版本 0.0.11）是一个跨平台的 Claude CLI 会话管理桌面应用：把 Claude CLI 包装成一个带本地登录、权限拦截、API Trace 查看能力的 GUI，同时保留 `claude -r <sid>` 在系统终端继续使用的体验。

核心功能：

- 本地账户密码登录（bcrypt 哈希，5 次失败锁定）
- 自动扫描 `~/.claude/projects/` 历史会话，文件变化即时刷新
- 内嵌 xterm.js 终端，经 `node-pty` 驱动交互式 Claude
- 三段式布局：左侧会话列表（280px，可折叠为 44px）| 中间 Tabs + 终端 | 右侧 Trace 面板（200px）
- 本地 API 网关代理（注入 `ANTHROPIC_BASE_URL`）拦截 Claude API 流量，提取 prompt / tool_use / tool_result 等阶段事件
- 权限仲裁器：统一管理权限请求，支持主窗口 / 企业微信 / 灵动岛悬浮窗多通道审批
- 企业微信双向通道（多 Bot、模板卡片审批、AskUserQuestion 问答、控制指令、终端截图）
- 云端上行通道与本地文件通道（阶段事件推送 / JSONL 落盘）
- Hook 编辑器（12 类 Claude hooks 表单配置，自动备份 `~/.claude/settings.json`）

## 技术栈

- **桌面壳**：Electron 43（主进程 Node.js >= 20）
- **前端**：Vue 3 + TypeScript + Pinia 3 + vue-router（hash mode）+ Vite（dev server 端口 5173）
- **终端**：`node-pty` + `@xterm/xterm`（前端渲染）/ `@xterm/headless`（主进程截图）
- **持久化**：electron-store + 本地 JSON/JSONL（`~/.lynel-desktop/`）
- **日志**：electron-log
- **打包**：electron-builder 26（Windows NSIS / macOS dmg / Linux AppImage）
- **测试**：vitest 2（根目录，`tests/main/`）+ node:test smoke 脚本；前端目录有 vitest 4 但脚本为占位
- 包管理：根目录与 `src/renderer/` 是**两个独立的 npm 项目**（各自有 package-lock.json 和 pnpm-lock.yaml，CI 用 `npm ci`）

## 常用命令

```bash
# 安装依赖（两个目录都要装）
npm ci
cd src/renderer && npm ci

# 全栈开发（推荐）：dev-cleanup + Vite + tsc --watch + electron
npm run dev

# 仅前端开发（Vite dev server，5173 端口；无 Electron runtime，
# window.electronAPI 为 undefined，只适合纯 UI 调试）
cd src/renderer && npm run dev

# 主进程测试（commit 前必须全绿）
npm run test:main          # = vitest run --dir tests/main

# 冒烟测试（node:test，验证 protocol/formats 等核心模块）
npm run test:smoke         # = npx tsx --test scripts/smoke-test.ts

# 前端类型检查
cd src/renderer && npx vue-tsc --noEmit

# 生产构建（前端产物 src/renderer/dist/，主进程产物 dist-electron/）
npm run build              # = build:frontend（vue-tsc + vite build）+ build:electron（tsc）

# 打包安装包（产物在 dist/）
npm run dist               # 当前平台
npm run dist:win / dist:mac / dist:linux
```

入口文件：`package.json` 的 `main` 指向 `dist-electron/src/main/index.js`（由根目录 `tsc` 从 `src/main/` 编译而来）。主进程 tsconfig：`module: NodeNext`、`strict: true`、`outDir: dist-electron`。

## 代码组织

### 主进程 `src/main/`（全部 Electron 主进程代码）

- `index.ts` —— 创建 BrowserWindow、Tray、单例锁，实例化 `App`
- `app.ts` —— 组装 store / events / log / auth / jsonl / session / hookserver / channels / apiproxy / permission-broker / notch-window，注册所有 IPC handler
- `preload.ts` —— 通过 `contextBridge` 暴露 `window.electronAPI`
- `session.ts` —— 会话状态机与 orchestrator（SessionManager）
- `pty.ts` —— 基于 `node-pty` 启动交互式 Claude
- `hookserver.ts` —— Express HTTP server（`127.0.0.1:<port>`），接收 Claude hooks；端点 `/hook`、`/api/send`、`/api/sessions/{id}/calls`、`/api/sessions/{id}/calls/stream`、`/api/calls/{seq}`；自动写 `~/.claude/settings.json`
- `apiproxy.ts` —— 本地 HTTP→HTTPS 代理，按 session 拦截 Claude API 流量并 emit 阶段事件
- `permission-broker.ts` —— 权限仲裁器单例（raise/resolve/cancel、`allocateSeq` 预分配序号、EventBus 同步灵动岛）
- `notch-window.ts` —— 灵动岛浮动窗口（透明无边框、alwaysOnTop，闭口 240×34 药丸，开口最大 400×500，鼠标穿透切换）
- `auth.ts` / `store.ts` / `jsonl.ts` / `log.ts` / `events.ts` —— 登录认证 / 持久化 / JSONL / 日志 / 事件总线
- `terminal-screenshot.ts` —— `@xterm/headless` 终端截图（供企业微信等通道）
- `channels/` —— Channel Dispatcher：`channel.ts`（`OutputChannel` 接口 + `ProxyStageEvent`）、`registry.ts`（`ChannelDispatcher` 多通道分发、错误隔离）、`sse-channel.ts`、`wecom-channel.ts`（+ `wecom-cards/` 模板卡片：card-builder / card-store / event-handler）、`localfile-channel.ts`、`cloud-channel.ts`、`desktop-socket.ts`、`state-channel.ts`
- `adapter/` —— 请求解析、session 适配、工具生命周期、turn 状态机、usage 附加
- `archive/` —— blobs / rawArchive / usageSummary / happyJsonl 落盘
- `cost/` —— 价格表与用量计费
- `formats/` —— anthropic / openai / pi 消息格式适配
- `protocol/` —— envelope / events / usage 协议定义
- `trace/` —— Trace IPC 与计时
- `types/` —— bot 类型、wecom 插件类型声明

### 前端 `src/renderer/`（独立 npm 项目）

- `src/views/` —— HomeView / LoginView / WelcomeView / SettingsView / NotchView（灵动岛独立入口页面，Vite 多入口构建）
- `src/components/` —— SessionList / GlobalTabs / XtermTerminal / trace/（TraceSidebar、TraceOverlay）/ settings/ 等
- `src/stores/` —— Pinia stores：auth / sessions / tabs / trace / settings / bots / channels / providers / recent
- `src/composables/` —— **useElectron.ts 是唯一接触 `window.electronAPI` 的文件**；useWindowState.ts 是唯一的窗口尺寸/最大化状态管理中心
- `src/router/` —— hash mode 路由
- `src/styles/theme.css` —— CSS 变量主题（红蓝浅色风格）

### 其他

- `tests/main/` —— 主进程 vitest 测试，目录结构与 `src/main/` 对应
- `scripts/` —— dev-cleanup、smoke-test、mock-cloud-server、企业微信调试脚本等
- `vendor/openclaw-stub/` —— `openclaw` 包的本地 stub（`@wecom/wecom-openclaw-plugin` 的 peer dependency），经 `file:vendor/openclaw-stub` 依赖引入
- `build/` —— electron-builder 图标资源（appicon、trayicon，按平台分目录）
- `docs/` —— 设计文档与使用指南：`usage.md`、`channel.md`、`envelope-format.md`、`hook.md`、`desktop-permission-request.md`、`superpowers/`（迁移与布局的设计/计划文档）等
- `dist-electron/`、`src/renderer/dist/`、`dist/` —— 构建产物，不要提交

## 代码风格约定

- 所有回复、代码注释、commit message、PR 描述用**简体中文**。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`；路由用 hash mode。
- 前端禁止直接 `window.electronAPI.X(...)`；必须 `import { X } from '../composables/useElectron'`。
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色。
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用；禁止用 emoji / Unicode 符号当图标。
- `Pinia ref<Record<K, V>>` 更新用整体 spread：`state.value = { ...state.value, [id]: v }`。
- 错误返回 `error` / reject，不要抛未捕获异常——主进程未捕获异常会导致窗口白屏。
- 禁止在视图组件里直接调用 BrowserWindow 尺寸方法；统一走 `useWindowState.applyLoginLayout()` / `applyHomeLayout()` / `applySettingsLayout()`。

## 测试策略

- **主进程**：`npm run test:main`（vitest，`tests/main/`）。覆盖 auth / session / pty / hookserver / permission-broker / channels（含 wecom-cards）/ archive / cost / formats / protocol / trace 等，测试目录与 `src/main/` 结构对应。新增主进程逻辑应在对应位置补测试。
- **冒烟测试**：`npm run test:smoke`（node:test + tsx），验证 protocol/formats 核心模块。
- **前端**：`src/renderer/package.json` 的 `test` 脚本是占位（`echo 'no tests yet'`）；目录里装了 vitest 4 + @vue/test-utils + jsdom，存在个别 `*.test.ts`（如 `XtermTerminal.test.ts`），但没有接入统一测试命令。前端以 `vue-tsc --noEmit` 类型检查为主要门禁。
- **commit 前必须全绿**：`npm run test:main` 和 `cd src/renderer && npx vue-tsc --noEmit`。
- CI（`.github/workflows/build.yml`）：push 到 `electron`/`main`、PR、`v*` tag 时，在 windows / macos(x64, arm64) / ubuntu 矩阵上跑 `npm ci`（根 + renderer）→ `npm test` → `npm run build` → electron-builder 打包。

## 提交与开发流程

- 一个 task 一个 commit，格式 `<type>: <subject>`，type：`feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `ci`。
- 每次 commit 前在仓库内设置 local git identity（`git config user.name/user.email`），不依赖全局身份。
- 不要提交构建产物、诊断文件或运行时垃圾（`.claude/`、`build/bin/`、`*-err.log`、临时 `.cmd`、`.exe` 等）。
- 改 `preload.ts` / `index.html` 的诊断代码时，commit message 里标 **临时**。
- 发布：打 `v*` tag 触发 CI 全平台构建；安装包命名 `lynel-desktop-<version>-<arch>.<ext>`。

## 架构要点与重要不变量（改动前必须确认）

1. **Session 生命周期**：新建 session 用 `randomUUID()` 预生成 UUID + `claude --session-id <sid>` 启动（`PtyMode.New`）；jsonl 已存在的 sid 必须用 `claude --resume <sid>`（`PtyMode.Resume`），否则 Claude 会 DEAD；不再依赖 SessionStart hook。历史 session 用 `SessionManager.adopt` 注册、不启动进程。
2. **PTY 输入**：向交互式 Claude PTY 发用户消息必须是裸文本并以回车结尾；`session.send()` 会自动补 `\r`（用于文本消息），`writeTerminalInput` / `session.writeInput()` 是逐键/原始字节通道（用于控制字符），**不要**在这里自动补回车。
3. **API 代理**：启动 PTY 前必须先启动对应 session 的 `APIProxy` 并把 `ANTHROPIC_BASE_URL` 注入 env；代理直接用预生成的 UUID，不需迁移。`ProxyStore` 是全局单例，一个 session 只建一个 proxy。代理启动失败**不阻塞 PTY**（打日志后继续）。
4. **网关数据定位**：apiproxy 阶段数据是 PTY+xterm.js 的**补充**，不替代终端渲染；前端消费失败不能影响 Claude 正常运行。数据落盘 `~/.lynel-desktop/projects/<encoded-project>/<sid>-calls.jsonl` 与 `raw/<seq>.json`。
5. **权限仲裁**：`PermissionBroker` 是主进程单例；`allocateSeq(id)` 在 dispatch 前预分配序号（企业微信消息展示 `#1` 而非 UUID）；`resolve` 先到先生效（Map 保护），`cancelBySessionTool` 在终端自行解决时清理所有 UI。
6. **灵动岛**：初始鼠标穿透（`setIgnoreMouseEvents(true, {forward: true})`），hover 展开、leave 恢复；resize 后需强制重算命中区域；通过 `SetNotchSize(w, h)` IPC 动态调整尺寸。
7. **企业微信卡片**：`task_id` 全局唯一，多问题卡片必须追加 `-{qIdx}` 后缀（否则企业微信返回 42014）；event_key 格式 `wecom:<action>:<requestId>`；卡片发送失败降级为 Markdown 文本；控制指令（`/interrupt` `/ctrl-c` `/escape` `/ctrl-d` `/ctrl-z`）经 `session.writeInput()` 发原始控制字节，不转发给 Claude。
8. **IPC**：所有主进程方法走 `ipcMain.handle` / `ipcRenderer.invoke`；`preload.ts` 暴露、`useElectron.ts` 转发，三层保持同步。

更详细的架构说明见 `CLAUDE.md`（与本文档互补，含数据流与企业微信卡片交互细节），使用指南见 `docs/usage.md`。

## 安全注意事项

- 本地密码用 bcryptjs 哈希存储，5 次失败锁定；不要明文存密码或 token。
- `hookserver` 只监听 `127.0.0.1`，不要改成对外绑定。
- 灵动岛/主窗口走 `contextBridge` 白名单暴露 API，新增 IPC 时保持最小暴露面，不要把 `ipcRenderer` 整个透出。
- 企业微信凭据、云端通道配置属于敏感信息，不要写入日志或提交到仓库；不要把真实聊天数据 commit 进测试夹具。
- `vendor/openclaw-stub/` 是 peer dependency 的最小 stub，不要把它当成真实 SDK 扩展功能。
