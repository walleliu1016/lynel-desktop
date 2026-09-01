# 代码工作区个性化 + 会话现场保留 设计

日期：2026-09-01

## 背景与目标

代码编辑器已改为会话页第三个子页「代码」（左文件树 + 右多文件编辑器）。当前问题：

1. **配色割裂**：代码工作区（文件树 + Monaco 编辑器）用 UI 主题配色（`--bg-panel`/`--text-secondary`/`vs-dark`），与终端 8 套主题配色（`data-term-theme` + `--term-*`）完全脱节。用户希望代码工作区与终端配色一致。
2. **字号固定**：Monaco `fontSize: 12` 与 `theme: 'vs-dark'` 硬编码（`CodeEditor.vue`），无法调节。
3. **会话现场丢失**：切会话时 `files.setSession` 把 `openFiles`/`drafts` 清空，A→B→A 后 A 打开的文件与未保存编辑全部丢失，需重开。

目标：
- 代码工作区（文件树 + 编辑器 tab + Monaco）配色**跟随终端主题**，换终端配色即换工作区配色。
- 代码编辑器**字号可调**（独立于终端字号）。
- **会话现场保留**：每个会话独立记忆打开的 tab、未保存草稿、激活文件、文件树展开状态，切换会话即时还原。

## 已确认需求

1. **配色跟随终端**：文件树里文件的图标、颜色，与 Monaco 编辑器配色，都跟随终端主题（8 套）。代码工作区配色独立于 UI 浅/深主题——终端选亮色，工作区即亮色。
2. **会话现场保留**：打开的 tab 列表 + 未保存草稿 + 激活文件 + 文件树展开状态，全部按会话记忆。
3. **代码编辑器字号可调**：滑杆调节，即时生效，持久化。

## 现状机制（复用不动）

- **终端主题**：`<html data-term-theme="<id>">`，`theme.css` 为 8 套主题定义 `--term-bg`/`--term-fg`/`--term-cursor`/`--term-selection` + 16 个 ANSI 色（`--term-<color>` 与 `--term-bright-<color>`）。`--term-*` 是**唯一色源**，挂在 `html` 上全局可用。
- **终端主题切换链路**：`AppearanceTab` → `settings.cfg.terminal.theme` → `XtermTerminal` watch → `syncXtermTheme` 设 `data-term-theme`。
- **Monaco**：懒加载单例（`CodeEditor.vue`），`ensureEditor` 用 `theme: 'vs-dark'`、`fontSize: 12` 创建。
- **会话切切换**：`files.setSession(wd)`（`stores/files.ts:31`）切走时清空 openFiles/drafts/activeRelPath/expanded。`trace.setSession(wd, id)` 已是按会话记忆模式（参照）。

## 设计

### A. 代码工作区配色跟随终端主题

**A1. 文件树 + 编辑器 tab（CSS 变量覆盖）**

在 `CodeView.vue` 的 `.code-view` 容器上，把代码工作区用到的 UI 变量**重映射**为终端色，使 `FileTree.vue`/`FileTabs.vue` 内部样式无需改动即可跟随：

```css
.code-view {
  --bg-panel: var(--term-bg);            /* 工作区背景 */
  --text-primary: var(--term-fg);        /* 主文本 */
  --text-secondary: var(--term-fg);      /* 次级文本（行、图标） */
  --text-tertiary: var(--term-fg);       /* 占位/空状态 */
  --bg-hover: var(--code-hover);         /* 行 hover */
  --accent-soft-bg: var(--term-selection); /* 选中行/激活 tab */
  --accent: var(--term-fg);              /* 激活文字高亮 */
  --border: var(--code-border);          /* 分隔线 */
  --bg-input: var(--term-bg);            /* 行内输入 */
  --border-focus: var(--code-border);
}
```

**兜底（重要）**：`--term-*` 目前只定义在 `[data-term-theme="<id>"]` 块（`theme.css:292` 起），而 `data-term-theme` 由 `XtermTerminal` 挂载时才 `setAttribute`（`XtermTerminal.vue:82`）。若终端未挂载，`var(--term-bg)` 等无值，工作区配色会失效。因此须在 `theme.css` 的 `:root` 补一套 `--term-*` 默认值（取值 = `default-dark` 的色值），保证工作区始终有兜底色；`XtermTerminal` 设置 `data-term-theme` 后自动覆盖。

衍生色（基于 `--term-*`，用 `color-mix` 保持单一来源，依赖上述 `:root` 兜底）：
```css
:root {
  --code-hover: color-mix(in srgb, var(--term-fg) 10%, transparent);
  --code-border: color-mix(in srgb, var(--term-fg) 18%, transparent);
}
```

文件树图标颜色：文件夹图标沿用 lucide `folder-open`，图标颜色跟随 `--text-secondary`（即 `--term-fg`）；若需点缀，文件夹可用 `--term-blue`、文件用 `--term-fg`（在 `FileTree.vue` 内指定，见 A3）。

**A2. Monaco 编辑器（运行时从 CSS 读色 + defineTheme）**

- `CodeEditor.vue` 在 `ensureMonaco` 后，用 `getComputedStyle(document.documentElement)` 读取当前 `data-term-theme` 下的 `--term-*` 值，调用 `monaco.editor.defineTheme('code-' + themeId, ...)` 构建 Monaco 主题，再 `editor.setTheme('code-' + themeId)`。
- **色源单一**：不硬编码色值，运行时从 CSS 变量读，保证与终端完全一致。
- 语法高亮 token → ANSI 色映射：

| Monaco token | CSS 变量 | 语义 |
|---|---|---|
| 默认文本 | `--term-fg` | 前景 |
| `comment` | `--term-bright-black` | 注释（灰） |
| `keyword` / `delimiter.bracket` | `--term-magenta` | 关键字（紫） |
| `string` | `--term-green` | 字符串（绿） |
| `number` | `--term-yellow` | 数字（黄） |
| `type` / `identifier` | `--term-blue` | 类型（蓝） |
| `function` / `tag` | `--term-cyan` | 函数（青） |
| `operator` | `--term-red` | 运算符（红） |
| 选择区背景 | `--term-selection` | 选中高亮 |
| 行号 | `--term-bright-black` | 行号（灰） |

- **触发时机**：watch `settings.cfg.terminal.theme`（或 `document.documentElement` 的 `data-term-theme`），变化时重读 CSS 变量 → 重新 `defineTheme` → `setTheme`。编辑器已存在则 `editor.setTheme`；未创建则下次创建时用当前主题。
- 亮色终端主题（solarized-light/warm-light）同样生效——背景读 `--term-bg` 即为亮背景。

**A3. 文件树图标色（可选点缀）**

`FileTree.vue` 的行图标：
- 文件夹：`color: var(--term-blue)`
- 文件：`color: var(--term-fg)`（随文字）
- 选中行 `active` 背景沿用 `--accent-soft-bg`（即 `--term-selection`）

### B. 代码编辑器字号可调

- `types/settings.ts` 新增：

```ts
export interface CodeConfig {
  /** 代码编辑器字号 px，10-20 */
  fontSize: number
}
```

`Settings` 增加 `code: CodeConfig`；`defaultCodeConfig()` 返回 `{ fontSize: 12 }`。`settings` store 迁移时缺省回退默认值。

- `AppearanceTab.vue` 新增「代码编辑器」section：字号滑杆（min 10 / max 20 / step 1），v-model 到本地 ref → `syncToStore`（复用现有 cfg 模式）。提示「配色跟随终端主题」。
- `CodeEditor.vue`：watch `settings.cfg.code.fontSize` → `editor.updateOptions({ fontSize })`（编辑器已存在即时生效；未创建则创建时读当前值）。`ensureEditor` 创建时 `fontSize` 改为读取设置值。
- 与终端字号（`terminal.fontSize`）互不影响。

### C. 会话现场保留

- `stores/files.ts` 新增按会话快照：

```ts
interface SessionWorkspace {
  openFiles: OpenFile[]
  drafts: Record<string, string>
  activeRelPath: string | null
  expanded: string[]
}
const sessionState = ref<Record<string, SessionWorkspace>>({})
```

- `setSession` 签名改为 `setSession(id: string, wd: string)`：
  1. 当前会话（`workDir` 非空时）现场快照进 `sessionState[oldId]`（oldId 由调用方传入或存 store）。
  2. `workDir` 切换、unwatch 旧目录、watch 新目录（现有逻辑保留）。
  3. 若 `sessionState[newId]` 存在 → 恢复 `openFiles`/`drafts`/`activeRelPath`/`expanded`；否则初始化空。
  4. `expanded` 恢复后，对每个展开目录重新 `loadDir`（FileTree 惰性加载，树内容需重新拉取）。
- `HomeView.vue` 调用点：
  - `watch(activeSessionId)`（现 370-376 行）：`files.setSession(newId, wd)`。
  - 切离会话处（现 518 行，`type !== 'session'`）：`files.setSession('', '')`（保存现场并清空当前）。
- `cleanupWatcher` / `FileWatch`/`FileUnwatch` 逻辑不变，仅按会话重挂。
- 边界：会话删除时清理 `sessionState[sid]` 槽位（跟随 `subTabBySession` 清理处，HomeView 458 行附近已有模式）。

## 布局与交互

```
代码子页（配色随终端主题）
┌──────────┬──────────────────────────────┐
│ 文件树    │ [tab1][tab2]  ...        ×   │  ← FileTabs 背景/选中随终端
│ (bg:term)│                              │
│ 图标随终端│        Monaco（theme 随终端）  │
│          │   （字号可调 10–20）           │
└──────────┴──────────────────────────────┘
  ← 整体配色 = data-term-theme 的 --term-*
```

- 「外观」设置页新增「代码编辑器」区：字号滑杆；配色提示「跟随终端主题」。
- 会话切换 A→B→A：B 的工作区现场还原，A 的现场（tab/草稿/展开态）保留，切回时还原。

## 组件与文件改动

| 文件 | 改动 |
|---|---|
| `styles/theme.css` | `:root` 补 `--term-*` 默认色（= default-dark），保证兜底 |
| `components/code/CodeView.vue` | `.code-view` 容器加 `--term-*` 变量覆盖 + 衍生色 |
| `components/code/FileTree.vue` | 行图标色（文件夹 `--term-blue`/文件 `--term-fg`） |
| `components/code/CodeEditor.vue` | Monaco 主题运行时构建 + setTheme、fontSize 从设置读取 + watch |
| `components/settings/AppearanceTab.vue` | 新增「代码编辑器」section（字号滑杆） |
| `types/settings.ts` | `CodeConfig` + `Settings.code` + `defaultCodeConfig` |
| `stores/settings.ts` | 兼容 `code` 缺省（load 时回退默认） |
| `stores/files.ts` | `sessionState` 快照 + `setSession(id, wd)` 恢复/保存 |
| `views/HomeView.vue` | `setSession` 调用点传 sessionId；切离会话保存现场 |

## 测试

- `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 根目录 `npm run test:main` 全绿（本次全在前端，主进程确认不受影响）。
- 手动冒烟：
  1. 换终端主题（外观 → 终端配色）→ 代码子页文件树 + 编辑器配色同步变化；亮色终端（warm-light/solarized-light）文件树随之变亮。
  2. 代码编辑器字号滑杆 → Monaco 字号即时变化；重启后保留。
  3. 会话 A 打开多文件、编辑留草稿、展开文件树 → 切会话 B → 回 A：tab、未保存草稿、激活文件、展开状态全部还原。
  4. 代码子页/文件树操作（右键新建/重命名/删除、拖宽、折叠）在终端配色下正常。
  5. 回归：切页/切会话不丢草稿；无 `Maximum call stack size exceeded`。

## 提交规范

- 按 task 拆分 commit，`<type>: <subject>`，中文 message。
- 每个 commit 前 `cd src/renderer && npx vue-tsc --noEmit` 与 `npm run test:main` 全绿。

## 非目标（YAGNI）

- 不做 Monaco 光标位置/滚动位置按会话恢复（先简单版）。
- 不做不同文件类型不同图标（沿用 lucide 文件/文件夹图标，仅颜色随主题）。
- 不做 UI 主题独立于终端主题的代码工作区配色（即不提供「工作区配色与终端解耦」开关，跟随即跟随）。
- 不做 Monaco 字体族设置（字号可调即可）。
- 不改终端本身配色机制（`data-term-theme`/`--term-*` 不动）。
