# 右侧代码编辑器侧栏设计

日期：2026-09-01

## 背景与目标

Lynel Desktop 的会话页目前只有「终端 / Trace」两个子页。用户在运行 Claude 会话时，无法直接查看/编辑工作目录里的代码——Claude 在改文件，用户只能切到外部编辑器看。

目标：在会话页右侧新增一个**常驻、可折叠的代码编辑器侧栏**（Cursor 风格），支持查看、编辑、保存工作目录文件，并在 Claude 外部改动文件时同步刷新。

## 已确认需求

1. **用途**：查看/编辑会话工作目录（workDir）里的文件。
2. **位置**：会话页右侧常驻侧栏，终端/Trace 两个子页都可见；默认宽 360px，可拖拽调宽（240–600px），可折叠为细条（折叠后再点展开）。
3. **编辑**：可编辑 + 手动保存（Ctrl+S 或工具条按钮），打开的文件有脏标记圆点。
4. **文件树**：全量递归展示（惰性按层加载），内置忽略清单过滤常见目录。
5. **管理操作**：文件树右键菜单支持新建文件/文件夹、重命名、删除（删除前二次确认）。
6. **文件内搜索**：Monaco 原生 Ctrl+F。
7. **外部变更**：chokidar 监听 workDir，外部改动自动刷新（无脏修改直接 reload；有脏修改弹提示条由用户决定）。
8. **切换会话**：编辑器打开的 tab 重置（首版简单化，后续可做成按会话记忆）。

## 布局与交互

```
会话页（终端 / Trace 子页右侧）
┌────────────────────────────┐
│ 刷新 · 新建文件 · 折叠      │  ← 顶部工具条
├────────────────────────────┤
│ 文件树（多级懒加载展开）    │  ← 上部，可收起
│  · 右键菜单：新建/重命名/删除│
├────────────────────────────┤
│ [文件tab1] [文件tab2] ...  │  ← 已打开文件标签（脏标记圆点）
│ Monaco 编辑器               │
│  · 多 tab 切换 · Ctrl+S 保存│
└────────────────────────────┘
```

- 仅当 `activeType === 'session'` 时显示右侧栏；非会话页隐藏。
- 切换会话：文件树切到新会话 workDir，编辑器 tab 重置为空。
- 折叠态：侧栏收成窄条（如 32px），仅保留展开按钮；折叠时暂停文件监听。

## 主进程文件服务（`src/main/files.ts`）

注册 IPC handler（`ipcMain.handle`），均带 workDir 白名单校验（限制在 `~/.lynel-desktop/projects/...` 等合法路径，防止任意路径读写）：

| IPC | 入参 | 返回 / 作用 |
|---|---|---|
| `file:listDir` | `(workDir, relPath?)` | 惰性返回单层目录 `[{ name, isDir }]`，目录在前按名称排序；`relPath` 为空取根层 |
| `file:read` | `(workDir, relPath)` | `{ content, size, binary }`；二进制或超大文件（>1MB）标记 `binary: true` |
| `file:write` | `(workDir, relPath, content)` | 写盘，成功返回 `{ ok: true }` |
| `file:create` | `(workDir, relPath, isDir)` | 新建文件或目录 |
| `file:rename` | `(workDir, oldRel, newRel)` | 重命名文件/目录 |
| `file:delete` | `(workDir, relPath)` | 删除文件或目录；目录递归删除，前端删除前二次确认 |
| `file:watch` | `(workDir)` | 启动 chokidar 监听，返回 watcher id |
| `file:unwatch` | `(workDir)` | 停止对应监听 |

错误一律 `reject`（返回错误对象），不抛未捕获异常（遵循现有约定：主进程未捕获异常会导致窗口白屏）。

### 忽略清单

常量数组，过滤以下目录/文件（后续可搬设置项，首版内置）：

```
node_modules  .git  dist  build  out  .venv  venv  __pycache__
.next  .cache  coverage  .vscode  .idea  *.log  *.lock  *.min.js
```

`file:listDir` 和 chokidar 监听都应用该清单（监听时跳过，控制事件量）。

### 外部变更监听

- 用 chokidar 监听**当前激活会话**的 workDir；切换会话先 unwatch 旧目录再 watch 新目录；侧栏折叠或离开会话页时暂停。
- 事件经 `webContents.send('file:changed', { relPath, type })` 推送渲染进程，`type` 为 `add` / `change` / `unlink` / `addDir` / `unlinkDir`。

## 外部变更处理（渲染进程）

收到 `file:changed` 后：

1. **文件树**：定向更新受影响节点（新增/删除/重命名局部刷新），不整树重建。
2. **编辑器打开的该文件**：
   - 无脏修改 → 自动 reload 内容。
   - 有脏修改 → 顶部提示条「文件已在外部变更」，用户点「重新加载」放弃本地改动，或「保留本地」忽略。
3. 提供手动刷新按钮兜底。

## Monaco 集成（渲染进程）

- 依赖 `monaco-editor`，Vite ESM 引入：`import * as monaco from 'monaco-editor'`，worker 用 `?worker` 直接引入，不引额外 vite 插件。
- **懒加载**：动态 `import('monaco-editor')`，只在侧栏首次展开且首次打开文件时才加载内核；纯文件树浏览不加载。
- **单例实例**：复用同一个 Monaco editor 实例，切 tab 只换 model（`setModel`），不重复创建；关闭 tab 时 `model.dispose()` 释放内存。
- **语言映射**：按扩展名映射（ts/js/vue/json/md/yaml/python/css/html 等），Monaco 基础语言自带。
- **保存**：Ctrl+S（Monaco addCommand）+ 工具条保存按钮，写盘成功清脏标记，失败 toast。
- **主题**：`vs-dark`，背景/边框对齐 `theme.css` 变量。

## 渲染进程结构

- `composables/useElectron.ts`：新增类型化转发函数（唯一 IPC 入口，禁止直接 `window.electronAPI`）。
- `stores/files.ts`（Pinia）：文件树数据与展开态、已打开 tab 列表、当前文件、脏标记、`file:changed` 订阅与分发。
- 组件：
  - `components/code/CodeSidebar.vue`：容器，顶部工具条 + 折叠态。
  - `components/code/FileTree.vue`：树渲染 + 右键菜单（新建/重命名/删除）。
  - `components/code/FileTabs.vue`：已打开文件标签。
  - `components/code/CodeEditor.vue`：Monaco 封装（懒加载、单例、脏标记、Ctrl+S）。
- 挂载点：`HomeView.vue` 的 layout 中 center 右侧新增 `CodeSidebar`，`v-show` 绑定 `activeType === 'session'` 且侧栏未折叠。

## 资源消耗（重点约束）

1. **Monaco 懒加载**：动态 import，侧栏纯树浏览不加载编辑器内核。
2. **单例编辑器**：复用实例，切 tab 换 model，关 tab dispose model。
3. **监听按需启停**：只 watch 当前激活会话 workDir；切会话/折叠/离开会话页即 unwatch，不并发 watch 多个目录。
4. **惰性目录加载**：树按需单层拉取，不整树递归扫描。
5. **变更局部更新**：`file:changed` 只定向刷新受影响节点/tab，不整树重建、不整编辑器重载。
6. **超大文件**：>1MB 标记 `binary` 只读，不交给 Monaco 渲染。

## 错误处理

- 读失败/权限/二进制/超大文件 → 只读提示，不可编辑。
- 写/建/删/改名失败 → toast 展示主进程错误。
- 删除（含目录递归）→ 二次确认，防误删。

## 测试

- 主进程文件服务单测 `tests/main/files.spec.ts`：
  - 忽略清单过滤正确。
  - `listDir` 排序（目录在前）、惰性按层。
  - `read`/`write`/`rename`/`delete` 往返、`binary` 判定（二进制/超大文件）。
  - 目录递归删除。
- commit 前 `npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit` 全绿。

## 提交规范

- 按 task 拆分 commit，`<type>: <subject>`，中文 message。
- 新增依赖 `monaco-editor` 属 chore/feat，随功能 commit。

## 非目标（YAGNI）

- 不做按会话记忆编辑器 tab（首版切换即重置）。
- 不做 .gitignore 解析（只用内置忽略清单）。
- 不做 Git 集成、diff 面板、拖拽上传。
- 不做侧栏内容区域与终端的联动（如点击错误跳转文件）。
