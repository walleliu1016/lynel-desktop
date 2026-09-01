# 代码编辑器改为第三个子页设计

日期：2026-09-01

## 背景与目标

上一版设计（`2026-09-01-code-editor-sidebar-design.md`）把代码编辑器实现为会话页**最右侧常驻窄栏**（360px，可拖 240–600）。冒烟反馈：窄栏空间太小、位置不佳，编辑器可读性差。

目标：把代码编辑器从右侧窄栏改为**会话页第三个子页「代码」**，与「终端 / Trace」并列，占满整个内容区（与终端一样大），内部为「左文件树 + 右多文件编辑器」的 VSCode 风格布局。

## 已确认需求

1. **位置**：会话页 `sub-tabs` 新增「代码」按钮，顺序 `[终端] [Trace] [代码]`，点击后整页显示代码工作区。
2. **内部布局**：左侧文件树（文件管理器）+ 右侧多文件编辑器；文件树可拖宽（240–600）、默认 300px、可折叠为 32px 图标条（折叠后编辑器占满）。
3. **多文件**：打开的文件在右侧 tab 依次排列（脏标记圆点、外部变更重载提示、关闭），沿用现有 `FileTabs` + `CodeEditor`。
4. **空状态**：未打开文件时编辑器区显示「从左侧文件树选择文件」。
5. **子页记忆**：`subTabBySession` 扩展支持 `'code'`，切回会话保留上次选中的子页。
6. **会话切换**：`files.setSession` 重置 openFiles（沿用首版简单化行为）。
7. **编辑/文件管理能力**：全部沿用上一版已实现能力（Monaco 懒加载单例、右键新建/重命名/删除、外部变更刷新、Ctrl+S 保存、文件内搜索）。

## 布局与交互

```
会话页 sub-tabs: [终端] [Trace] [代码]        ← 点击「代码」
┌──────────┬──────────────────────────────┐
│ 文件树    │ [tab1][tab2][tab3]  ...  ×   │  ← 顶部 editor tabs（脏点/重载/关闭）
│ 可折叠   │                              │
│ (默认300)│      Monaco 编辑器            │
│          │                              │
│          │   （未打开文件：从左侧文件树选择文件）│
└──────────┴──────────────────────────────┘
   └ 文件树面板可拖宽(240–600)、可折叠为 32px 图标条
```

- 文件树面板顶部工具条：刷新文件树 · 新建文件 · 折叠按钮（沿用现有 CodeSidebar 工具条逻辑）。
- 折叠态：文件树收成 32px 窄条，仅保留展开按钮，编辑器占满剩余空间；宽度与折叠态 localStorage 持久化。
- 「代码」子页仅在 `activeType === 'session'` 时可见（与其他子页一致）。

## 组件结构

- **新增 `components/code/CodeView.vue`**：子页容器，横向 flex：
  - 左：文件树面板（工具条 + `FileTree`），持宽度/折叠态与拖宽逻辑（从 `CodeSidebar.vue` 迁入）。
  - 右：编辑器面板（`FileTabs` + `CodeEditor`），flex:1。
- **删除 `components/code/CodeSidebar.vue`**：窄栏容器不再需要。
- **复用不动**：`FileTree.vue`、`FileTabs.vue`、`CodeEditor.vue`、`stores/files.ts`（除 `collapsed` 语义外）。
- `stores/files.ts`：`collapsed` 语义从「整个侧栏折叠」改为「文件树面板折叠」。

## 实现改动

### 1. `HomeView.vue`
- `sub-tabs` 增加「代码」按钮（图标可选 `file-code`）。
- `subTabBySession` 类型扩展 `'terminal' | 'trace' | 'code'`；`activeSubTab` computed 相应扩展。
- 新增 `code` sub-pane：`<div v-show="activeSubTab === 'code'" class="sub-pane"><CodeView /></div>`。
- **移除** layout 层级的 `<CodeSidebar v-if="tabsStore.activeType === 'session' && activeSessionWorkdir" />` 及 import。
- 非目标保留：不在终端/Trace 里做点击文件跳转代码页（YAGNI，沿用原 spec 非目标）。

### 2. `components/code/CodeView.vue`（新建）
- 从 `CodeSidebar.vue` 迁入：宽度 localStorage 读写、拖宽逻辑（右边缘手柄）、工具条（刷新/新建/折叠）。
- 内部结构：`<div class="code-view"> <aside class="tree-panel"> <FileTree/> </aside> <div class="editor-panel"> <FileTabs/><CodeEditor/> </div> </div>`。
- 折叠态：`tree-panel` 收窄为图标条，仅保留展开按钮；折叠时不渲染 `FileTree`（节省渲染）。

### 3. `stores/files.ts`
- `collapsed` 命名保持，语义改为「文件树面板折叠」，由 `CodeView` 读写。

## 资源消耗（沿用并保持）

1. **Monaco 懒加载**：仅首次打开文件时 `import('monaco-editor')`；「代码」子页无打开文件不加载。
2. **单例编辑器**：复用同一个 Monaco editor，切 tab 换 model，关 tab dispose model。
3. **监听按需启停**：只 watch 当前激活会话 workDir；切会话/离开会话页即 unwatch（现有 HomeView watch 逻辑不变）。
4. **惰性目录加载**：文件树按需单层拉取。
5. **变更局部更新**：`file:changed` 只定向刷新受影响节点/tab。
6. **子页 v-show 常驻**：切换子页不卸载 CodeView，草稿（store.drafts）不丢；Monaco 实例常驻，`automaticLayout: true` 处理 display:none 切换后的重排。

## 错误处理

沿用上一版：读/写/建/删/改名失败 toast；删除二次确认；二进制/超大文件只读提示。

## 测试

- 类型检查 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 主进程 `npm run test:main` 全绿（本次改动全在前端，主进程无改动，确认不受影响）。
- 手动冒烟：
  1. 会话页可见 `[终端] [Trace] [代码]` 三个子页，点击「代码」整页显示。
  2. 文件树展开/右键新建/重命名/删除正常；拖宽、折叠/展开正常；刷新正常。
  3. 打开多个文件 → tab 依次排列；切 tab；编辑置脏；Ctrl+S 保存；外部改动提示条。
  4. 切走「代码」子页再切回：未保存草稿保留；子页选中态按会话记忆。
  5. 切换会话：文件树切到新 workDir、openFiles 重置。
  6. 修复回归：此前 `Maximum call stack size exceeded` 无限递归（`<script setup>` 内 Symbol 注入键）不得复发。

## 提交规范

- 按 task 拆分 commit，`<type>: <subject>`，中文 message。
- 改 `main.ts` 等诊断代码时 commit message 标注**临时**（本设计无此改动）。

## 非目标（YAGNI）

- 不做终端/Trace 内点击文件路径跳转代码页（后续可加）。
- 不做按会话记忆打开的 tab 列表（切会话即重置，沿用首版）。
- 不做 Git 集成、diff 面板、拖拽上传。
- 不做文件树宽度与会话绑定的记忆（宽度全局 localStorage，不按会话区分）。
