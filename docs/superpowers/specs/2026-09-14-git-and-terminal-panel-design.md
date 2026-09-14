# Git 与终端面板设计

日期：2026-09-14

## 背景与目标

「文件」子页（`CodeView.vue`）目前是两栏：左侧文件树 + 右侧 Monaco 编辑器。用户在跑 Claude 会话时，改完代码要切到外部工具才能看 diff、提交、跑命令。

目标：在 `CodeView` 底部新增一个**横跨全宽的可折叠面板**，内含「Git」与「终端」两个标签。Git 面板提供变更列表、diff、暂存、提交、推送与提交历史图；终端面板提供绑定当前会话工作目录的交互式 shell。让"改代码 → 看变更 → 提交推送 → 跑命令"在同一个画面闭环。

参考 VSCode 的成熟做法：**Git 面板只负责"列出变更"，diff 交给编辑器区全宽渲染**（VSCode 的 `vscode.diff` 同思路）。这样避免了"侧栏太窄，diff 挤成一团"的问题。

## 已确认需求

1. **布局**：底部全宽面板，`[Git] [终端]` 两个标签，可拖高、可折叠。`Git` 标签内左右分栏：变更列表 30% / 提交历史图 70%。
2. **diff 位置**：在中间编辑器区以 Monaco DiffEditor 双栏视图打开，不占用侧栏。
3. **Git 能力**：状态（分支、ahead/behind、变更分组）、diff、暂存/取消暂存、丢弃、提交、fetch/pull/push、提交历史图、查看某次提交的文件变更。
4. **终端作用域**：每个 Claude 会话一个独立 shell 终端，`cwd` 绑定该会话的 workDir。
5. **不做**：checkout / stash / rebase / cherry-pick / 冲突解决。分支列表只读展示。这些留在终端里手工执行。
6. **分期实施**：Phase 1 面板容器 + 终端；Phase 2 Git 变更列表 + diff + 提交推送；Phase 3 提交历史图。

## 总体布局

```
CodeView（文件子页）
┌──────────┬────────────────────────────────────┐
│ 文件树   │  FileTabs + Monaco                 │
│ 300px    │  ← 普通编辑 / Diff 双栏视图          │
│ 可拖宽   │                                    │
├──────────┴────────────────────────────────────┤
│ [Git] [终端]                     ⇕拖高   ⌄折叠 │
│ ┌─────────────┬──────────────────────────────┐│
│ │ 变更 (30%)  │ 提交历史图 (70%)              ││
│ │             │                              ││
│ │ M app.ts    │ ●─┐ feat: xxx      2h ago     ││
│ │ A git.ts    │ │ ●─┘ fix: yyy    5h ago     ││
│ │             │ ●  init            1d ago     ││
│ │ [msg…][提交]│                              ││
│ └─────────────┴──────────────────────────────┘│
└───────────────────────────────────────────────┘
```

| 属性 | 值 |
|---|---|
| 默认高度 | 320px |
| 高度范围 | 120px – 70% 视口高 |
| 折叠态 | 32px 标签条 |
| 宽度 | 横跨 `CodeView` 全宽（含文件树下方） |
| Git 标签左栏 | `flex: 0 0 30%; min-width: 220px`，固定不拖拽 |
| 持久化 | localStorage，key `lynel:code-bottom-height` / `lynel:code-bottom-collapsed` |

拖高逻辑照搬 `CodeView.vue:34-67` 现有的拖宽实现（`mousedown` → `mousemove` → `mouseup`，期间 `document.body.style.userSelect = 'none'`）。

标签切换用 `v-show` 而非 `v-if`：终端 xterm 实例必须常驻，切走再切回不能丢 buffer，也不能重建 PTY。

## 主进程设计

### 1. `src/main/git.ts`（新增）

GitService，封装 `simple-git`。每个方法接收 `workDir`，内部维护 `Map<workDir, SimpleGit>` 实例缓存。

```ts
interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  detached: boolean
  staged: GitFileChange[]      // 暂存区
  unstaged: GitFileChange[]    // 工作区
  untracked: GitFileChange[]   // 未跟踪
  conflicted: GitFileChange[]  // 冲突
}

interface GitFileChange {
  path: string      // 相对 workDir，正斜杠
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'
  oldPath?: string  // 重命名时的原路径
}

interface GitCommit {
  hash: string
  parents: string[]   // 泳道算法依赖父子关系
  message: string     // 仅首行 subject
  author: string
  date: number        // epoch ms
  refs: string[]      // ['HEAD', 'main', 'origin/main', 'tag: v1.0']
}
```

所有方法的返回值统一为 `{ ok: true, data }` 或 `{ ok: false, error: string }`，**不抛异常**（主进程未捕获异常会导致窗口白屏）。

`.git` 变更监听：`chokidar` 监听 `<workDir>/.git/HEAD`、`.git/index`、`.git/refs/**`，忽略 `.git/objects/**` 与 `.git/logs/**`（太吵）。500ms debounce 后 `getBus().emit('git:changed', workDir)`。监听随 `file:watch` / `file:unwatch` 的会话生命周期启停，避免泄漏。

> 注：`.git` 目录已存在于 `files.ts:11-14` 的 `IGNORED_DIRS` 中，文件树不会展示它；Git 的 watcher 独立于文件树 watcher。

### 2. `src/main/shell.ts`（新增）

项目 shell 会话表，key 为 Claude 的 sessionId（每会话一个终端）。

```ts
ensure(sessionId, workDir, cols, rows): { replay: string }
write(sessionId, data): void
resize(sessionId, cols, rows): void
close(sessionId): void
closeAll(): void
```

- 每个会话保留 ring buffer（最近 64KB），重开面板时回放，避免白屏。
- 输出经独立的 `OutputBatcher` 实例合帧后 `getBus().emit('shell:' + sessionId, data)`。
- **事件前缀必须是 `shell:`，不能复用 `session:`** —— 后者是 Claude PTY 的输出通道，复用会导致两个终端的输出串流。
- 进程退出时 `getBus().emit('shell:exit:' + sessionId)`，前端显示"进程已退出"并允许重启。

shell 选择：

| 平台 | 首选 | 回退 |
|---|---|---|
| win32 | `powershell.exe` | `cmd.exe` |
| darwin | `process.env.SHELL` | `/bin/zsh`、`/bin/bash` |
| linux | `process.env.SHELL` | `/bin/bash` |

`pty.ts` 的 `start()` 内部已调 `resolveBin()` 解析绝对路径（`pty.ts:415`），找不到会 throw 明确错误，`shell.ts` 无需重复处理。但 win32 回退 `cmd.exe` 时，必须传绝对路径 —— native 侧对相对命令名的 PATH 解析不可靠（`pty.ts:342-349`）。`resolveCmdExe()`（`pty.ts:351-360`）当前未导出，需改为导出后在 `shell.ts` 复用。

**会话生命周期联动**：shell 与 Claude session 同生共死，需在 `app.ts` 挂钩两个现有回调：

| 场景 | 处理 |
|---|---|
| `session.remove(id)` | `shell.close(id)`，否则 PTY 泄漏成孤儿进程 |
| `/clear` 触发 `doRebindSession(oldId, newId)` | `shell.rebind(oldId, newId)`，让终端跟着用户走，而不是被留在一个已废弃的 id 上 |

`shell.rebind` 语义与 `session.rebind`（`session.ts:72-79`）一致：迁移 Map 中的 key，不 kill 进程，保留 buffer。`app.ts` 还需在应用退出时调用 `shell.closeAll()`。

### 3. `src/main/pty.ts`（改动）

新增 `StartOptions.raw?: boolean`。置位时**跳过 `buildCommand()`**，直接把 `{ file: bin, args }` 交给 `pty.spawn`。

理由：`buildCommand()`（`pty.ts:362-389`）在 win32 下总会包一层 `cmd.exe /c`。若 `bin` 本身就是 `powershell.exe`，会产出 `cmd.exe /c powershell.exe` —— 多出的 cmd 层级会让 Ctrl+C、Ctrl+Z 等控制字符的语义变形。`raw` 模式绕开这层包装，也跳过 `--session-id` / `--resume` 这些 Claude 专属参数。

`raw` 模式下 `opts.probe` 必须保持 false（`probeBin` 用 `--version` 探测，是 Claude 专属，shell 不认）。

### 4. IPC 接口

在 `registerGitIpc()` / `registerShellIpc()` 中注册，由 `app.ts` 调用。

**Git**

| channel | 入参 | 返回 |
|---|---|---|
| `git:status` | `workDir` | `GitStatusResult` |
| `git:log` | `workDir, { skip, limit }` | `{ commits: GitCommit[], hasMore: boolean }` |
| `git:commitFiles` | `workDir, hash` | `{ files: GitFileChange[] }` |
| `git:fileAtRev` | `workDir, rev, relPath` | `{ content, binary, truncated }` |
| `git:stage` | `workDir, relPaths[]` | `{ ok }` |
| `git:unstage` | `workDir, relPaths[]` | `{ ok }` |
| `git:discard` | `workDir, relPaths[]` | `{ ok }` |
| `git:commit` | `workDir, message` | `{ ok }` |
| `git:remoteOp` | `workDir, op: 'fetch'\|'pull'\|'push'` | `{ ok, summary }` |

**Shell**

| channel | 入参 | 返回 |
|---|---|---|
| `shell:ensure` | `sessionId, workDir, cols, rows` | `{ ok, replay }` |
| `shell:write` | `sessionId, data` | `{ ok }` |
| `shell:resize` | `sessionId, cols, rows` | `{ ok }` |
| `shell:close` | `sessionId` | `{ ok }` |

**主进程 → 渲染进程事件**

| 事件 | 载荷 | 触发 |
|---|---|---|
| `git:changed` | `workDir` | `.git` 变化（debounce 后） |
| `shell:<sessionId>` | `string` | shell 输出（合帧后） |
| `shell:exit:<sessionId>` | `{ code }` | shell 进程退出 |

事件转发无需改 `app.ts:409-418` —— 那里已经 monkey-patch 了 `bus.emit`，会自动 `webContents.send` 同名事件。

### 5. `src/main/preload.ts` + `src/renderer/src/composables/useElectron.ts`

按现有风格（每个 API 一行 `ipcRenderer.invoke`）追加转发函数。`useElectron.ts` 是唯一接触 `window.electronAPI` 的文件，新增导出：

```ts
export const GitStatus = (workDir: string) => api().gitStatus(workDir)
export const GitLog = (workDir: string, opts: { skip: number; limit: number }) => api().gitLog(workDir, opts)
// ... 其余同理
export const ShellEnsure = (sessionId: string, workDir: string, cols: number, rows: number) => api().shellEnsure(sessionId, workDir, cols, rows)
```

## 渲染进程设计

### 新增组件

| 组件 | 职责 |
|---|---|
| `components/code/BottomPanel.vue` | 底部面板容器：拖高、折叠、`[Git] [终端]` 标签切换 |
| `components/code/GitPanel.vue` | 左栏：分支状态条 + 变更分组列表 + commit message + 提交/推送 |
| `components/code/CommitGraph.vue` | 右栏：提交历史图（泳道 SVG），无外部依赖 |
| `components/code/ProjectTerminal.vue` | 项目终端 xterm 实例 |
| `components/code/CodeDiffView.vue` | Monaco DiffEditor 包装 |

### 既有文件的改动

| 文件 | 改动 |
|---|---|
| `CodeView.vue` | 挂载 `BottomPanel`；编辑器区按 `diffRequest` 在 `CodeEditor` / `CodeDiffView` 之间切换 |
| `stores/files.ts` | 新增 `diffRequest: { relPath: string; rev: string } \| null` 与 `openDiff()` / `closeDiff()` |
| `XtermTerminal.vue` | 改为从 `terminal/theme.ts` 引入主题函数，删除本地重复实现（行为不变） |
| `app.ts` | 调用 `registerGitIpc()` / `registerShellIpc()`；挂 session remove / rebind / 应用退出时的 shell 联动 |

### 抽出的共享模块

`src/renderer/src/terminal/theme.ts`（新增）：从 `XtermTerminal.vue:52-120` 抽出 `THEME_VARS`、`applyThemeSync`、`waitForFontReady`、`scheduleThemeSync`。`XtermTerminal.vue` 与 `ProjectTerminal.vue` 共用，避免主题逻辑两份实现（DRY）。

抽出时保持 `XtermTerminal.vue` 的行为完全不变 —— 这是纯重构，不改语义。

### Diff 视图

`CodeView` 决定编辑器区挂载 `CodeEditor` 还是 `CodeDiffView`：

- 普通编辑：现状不变
- Diff 模式：`files store` 新增 `diffRequest: { relPath, rev: string } | null`，非空时挂载 `CodeDiffView`

Monaco DiffEditor 的左右两侧内容：

| 场景 | 左侧（原始） | 右侧（修改后） |
|---|---|---|
| 未暂存变更 | `git show HEAD:<path>` | 工作区文件（`file:read`） |
| 已暂存变更 | `git show HEAD:<path>` | `git show :<path>`（index） |
| 提交详情 | `git show <parent>:<path>` | `git show <commit>:<path>` |

主题复用 `CodeEditor.vue:78-110` 的 `buildMonacoTheme`（同一份 `--term-*` 色源），保证 diff 与编辑器配色一致。二进制文件或超 1MB 不渲染 DiffEditor，直接显示占位文案。

### 提交历史图（泳道算法）

数据来源：`git log --all --parents --pretty=format:...`。

算法（约 150–250 行）：按提交顺序遍历，为每个提交分配 lane —— 若某提交的某父节点与当前活跃 lane 的尖端匹配则复用该 lane，否则开新 lane；合并提交会闭合多余 lane。每个提交产出 `{ lane, color, segments[] }`，`segments` 描述与前一行的连线（直线 / 曲线）。

渲染用 SVG：泳道宽度约 14px/lane，最多显示 12 条泳道，超出折叠。分支颜色由 lane index 映射到一个调色板，调色板从 `--term-*` 变量派生，随主题联动。

分页：初始 200 条，滚动到底部 `skip += 200` 加载更多。

### 组件与数据处理

- `stores/git.ts`（新增，Pinia setup style）：持有 `workDir`、`status`、`commits`、`loading`、`error`。监听 `git:changed` 触发 `refresh()`。Pinia 中 `ref<Record<K,V>>` 更新必须用整体 spread（`state.value = { ...state.value, [k]: v }`）。
- 终端实例的生命周期分两个维度，行为不同：
  - **面板内标签切换**（Git ↔ 终端）：`v-show`，xterm 实例与 PTY 都保留，切回即见原内容。
  - **切换 Claude 会话**：xterm 实例重建，主进程 PTY 保留；新实例挂载后调 `shell:ensure` 拿 `replay` 回放 ring buffer，视觉上无缝衔接。不维护跨会话的实例 Map —— 内存开销与复杂度都不划算。
- 会话切换：`git` store 的 `workDir` 跟随 `activeSessionId`，与 `files` store 现有行为对齐。

## 依赖变化

| 位置 | 新增 | 说明 |
|---|---|---|
| 主进程 | `simple-git` | 唯一新增运行时依赖。纯 JS，无原生编译 |

渲染进程无新增依赖：Monaco（含 DiffEditor）、`@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-serialize` 均已在 `src/renderer/package.json` 中。

选型说明：`isomorphic-git` 纯 JS 但不支持 SSH 且性能差；`nodegit` 已实质废弃。`simple-git` 包装系统 git CLI，功能完整、社区标准。

实现注意：主进程是 ESM（`type: module` + `module: NodeNext`），`simple-git` 是 CJS 包。安装后需先验证 `import simpleGit from 'simple-git'` 在 `tsc` 构建 + Electron 运行时下可用。若互操作有问题，回退方案是自建一个约 30 行的 `runGit(workDir, args)` 包装 `execFile('git', ...)` —— 本设计只用到 9 个 git 子命令，不值得为此引入构建复杂度。

## 错误处理

| 场景 | 表现 |
|---|---|
| 非 Git 仓库（无 `.git`） | Git 面板显示空状态"当前目录不是 Git 仓库"，不报错 |
| git 未安装 | 同上的空状态，文案提示安装 git |
| push/pull 鉴权失败或冲突 | `pushToast` 展示 stderr 摘要（截断至 200 字） |
| 长时间远程操作 | 按钮转圈 + 禁用，防重复点击 |
| shell 启动失败 | 终端区显示错误文案 + "重试"按钮 |
| shell 进程退出 | 终端区显示"进程已退出" + "重新启动"按钮 |
| 任何 IPC 异常 | 返回 `{ ok: false, error }`，绝不抛未捕获异常 |

丢弃变更（`git:discard`）是**不可逆操作**，前端必须二次确认对话框，且文案需列出待丢弃的文件。

## 测试

**主进程**（`tests/main/`，与 `src/main/` 结构镜像）

- `git.test.ts`：用 `fs.mkdtemp` 建临时仓库，真实执行 `init` / `add` / `commit` / 建分支 / 制造改名，断言 `status` / `log` / `commitFiles` / `fileAtRev` 的解析结果。覆盖：空仓库、有未跟踪文件、重命名检测（`R` 状态）、分离 HEAD。
- `shell.test.ts`：`ensure` 后写入 `echo <标记>`，断言输出包含该标记；断言 `resize` 不抛；断言 `close` 后会话表清除。

**前端**：`cd src/renderer && npx vue-tsc --noEmit` 必须全绿。

**回归**：`npm run test:main`（`npm test`）必须全绿。

## 不变量与约束

1. `shell:` 事件前缀必须独立于 `session:`，两者输出通道不得复用。
2. `pty.ts` 的 `raw: true` 路径必须跳过 `probeBin`（`--version` 是 Claude 专属探测）。
3. Git 与 shell 的所有 IPC 返回 `{ ok, error }` 结构，不抛异常。
4. 终端面板用 `v-show` 保留实例，不用 `v-if`。
5. `useElectron.ts` 是唯一接触 `window.electronAPI` 的文件；新组件必须经它调用。
6. 样式用 `styles/theme.css` 的 CSS 变量，图标用 `@lucide/vue` 经 `components/Icon.vue` 引用。
7. `.git` 目录继续留在 `IGNORED_DIRS`，文件树不展示。
8. 设计文档中的 Monaco DiffEditor 复用 `buildMonacoTheme`，不另建主题。

## 分期实施

| 阶段 | 内容 | 可独立交付 |
|---|---|---|
| Phase 1 | `BottomPanel.vue` 容器（拖高/折叠/标签）+ `shell.ts` + `pty.ts` 的 `raw` 模式 + `ProjectTerminal.vue` + `terminal/theme.ts` 抽出 | 是 |
| Phase 2 | `git.ts` + `stores/git.ts` + `GitPanel.vue`（变更列表 / stage / commit / remoteOp）+ `CodeDiffView.vue` + `CodeView` 挂载 Diff | 是 |
| Phase 3 | `CommitGraph.vue` 泳道渲染 + 分页 + 提交详情 | 是 |

每阶段结束需 `npm run test:main` 与 `vue-tsc --noEmit` 全绿。
