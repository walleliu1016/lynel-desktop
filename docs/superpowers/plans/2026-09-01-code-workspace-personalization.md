# 代码工作区个性化 + 会话现场保留 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 代码工作区（文件树 + Monaco 编辑器）配色跟随终端主题、编辑器字号可调、每个会话独立保留打开 tab / 未保存草稿 / 激活文件 / 文件树展开状态。

**Architecture:** 三块独立改动——(A) 终端主题色复用：`--term-*` 已是 `html` 全局唯一色源，CodeView 容器把 UI 变量重映射为 `--term-*` 让 FileTree/FileTabs 无改动跟随；Monaco 用运行时 `getComputedStyle` 读 `--term-*` 构建 defineTheme。(B) 字号：`Settings.code.fontSize` 新增配置项 + 外观页滑杆。(C) 现场保留：files store 加 `Record<sessionId, SessionWorkspace>` 快照，`setSession(id, wd)` 切走保存 / 切回恢复。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia setup store、Monaco（懒加载单例）、CSS 变量 + `color-mix`。

## Global Constraints

- 配色单一来源：`--term-*` 是唯一色源（`html` 上全局），代码工作区**不得硬编码颜色**，只能 `var(--term-*)` 或运行时读 CSS 变量。
- `--term-*` 目前只定义在 `[data-term-theme="<id>"]` 块（`theme.css:292` 起），该属性由 `XtermTerminal.vue` 挂载时 `setAttribute`。`:root` 必须补一套默认值（= default-dark 色值）作为兜底，否则终端未挂载时工作区配色失效。
- 衍生色用 `color-mix(in srgb, var(--term-fg) <pct>%, transparent)` 保持单色源，依赖 `:root` 兜底。
- Monaco token 映射：默认→`--term-fg`、`comment`→`--term-bright-black`、`keyword`/`delimiter.bracket`→`--term-magenta`、`string`→`--term-green`、`number`→`--term-yellow`、`type`→`--term-blue`、`function`→`--term-cyan`、`operator`→`--term-red`、选择区→`--term-selection`、行号→`--term-bright-black`。
- `CodeConfig.fontSize` 范围 10-20，默认 12；独立于终端字号（`terminal.fontSize`）。
- 每个 commit 前必须 `cd src/renderer && npx vue-tsc --noEmit` 与 `cd G:/work/lynel-desktop && npm run test:main` 全绿。
- commit message 中文，格式 `<type>: <subject>`，一个 task 一个 commit。
- 不新增依赖；不改终端配色机制（`data-term-theme` / `--term-*` 语义不动）。
- 注入键必须声明在普通 `<script>` 块（`FileTree.vue` 的 `TREE_ROW_CTX` 是前置 bug 修复，不得改回 `<script setup>`）。

---

### Task 1: 终端主题色兜底 + 代码工作区 CSS 配色跟随

**Files:**
- Modify: `src/renderer/src/styles/theme.css`（终端配色段前补 `:root` 兜底）
- Modify: `src/renderer/src/components/code/CodeView.vue`（`.code-view` 变量覆盖）
- Modify: `src/renderer/src/components/code/FileTree.vue`（文件夹图标色）

**Interfaces:**
- Consumes: 现有 `--term-*`（`[data-term-theme]` 块）+ 本 task 新增的 `:root` 兜底。
- Produces: `:root` 新增 `--term-*` 默认值 + `--code-hover`/`--code-border` 衍生色（Task 3 的 Monaco 运行时读取依赖它们）。

- [ ] **Step 1: theme.css 加 `:root` 兜底色**

在 `src/renderer/src/styles/theme.css` 中、终端配色段（`/* === default-dark：中性的深色 === */` 前，即现有第 291 行前）插入以下块（色值 = default-dark 的副本，含衍生色）：

```css
/* =====================================================================
 * 终端配色兜底默认值（= default-dark）
 * 代码工作区（文件树 + Monaco）在没有 XtermTerminal 挂载 data-term-theme 时
 * 需要 --term-* 有值可读；XtermTerminal 挂载后会 setAttribute data-term-theme 覆盖。
 * 衍生色：基于 --term-fg 的半透明叠加，保持单色源。
 * ===================================================================== */
:root {
  --term-bg: #1e1e1e;
  --term-fg: #d4d4d4;
  --term-cursor: #d4d4d4;
  --term-cursor-accent: #1e1e1e;
  --term-selection: #264f78;

  --term-black: #000000;
  --term-red: #cd3131;
  --term-green: #0dbc79;
  --term-yellow: #e5e510;
  --term-blue: #2472c8;
  --term-magenta: #bc3fbc;
  --term-cyan: #11a8cd;
  --term-white: #e5e5e5;

  --term-bright-black: #666666;
  --term-bright-red: #f14c4c;
  --term-bright-green: #23d18b;
  --term-bright-yellow: #f5f543;
  --term-bright-blue: #3b8eea;
  --term-bright-magenta: #d670d6;
  --term-bright-cyan: #29b8db;
  --term-bright-white: #ffffff;

  --code-hover: color-mix(in srgb, var(--term-fg) 10%, transparent);
  --code-border: color-mix(in srgb, var(--term-fg) 18%, transparent);
}
```

说明：`:root` 优先级 `(0,1,0)` 与 `[data-term-theme]` 同级，且本块出现在所有 `[data-term-theme]` 块之前，故终端挂载后 `[data-term-theme]` 块自动覆盖，兜底不影响已挂载场景。

- [ ] **Step 2: CodeView.vue `.code-view` 变量覆盖**

`src/renderer/src/components/code/CodeView.vue` 的 `<style scoped>` 中，把 `.code-view` 规则替换为（原属性保留，新增变量覆盖）：

```css
.code-view {
  /* 代码工作区配色跟随终端主题：把 UI 变量重映射为 --term-*（html 上全局可用） */
  --bg-panel: var(--term-bg);
  --text-primary: var(--term-fg);
  --text-secondary: var(--term-fg);
  --text-tertiary: var(--term-fg);
  --bg-hover: var(--code-hover);
  --tab-hover-bg: var(--code-hover);
  --accent-soft-bg: var(--term-selection);
  --accent: var(--term-fg);
  --border: var(--code-border);
  --border-strong: var(--code-border);
  --bg-input: var(--term-bg);
  --border-focus: var(--code-border);
  --status-warn: var(--term-yellow);
  --status-warn-soft: var(--code-hover);
  --status-warn-border: var(--code-border);
  --status-error: var(--term-red);
  --status-error-soft: var(--code-hover);
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--bg-panel);
  overflow: hidden;
}
```

CSS 变量沿 DOM 继承，FileTree / FileTabs / CodeEditor 的 scoped 样式引用的 `--bg-panel`、`--text-*`、`--accent-soft-bg`、`--border`、`--status-*` 等全部被重映射为终端色，内部样式无需改动。

- [ ] **Step 3: CodeView.vue 工具栏高度对齐 + 显示项目目录**

`src/renderer/src/components/code/CodeView.vue`（与 Step 2 同文件）：

1. 模板 `.panel-toolbar` 内、「新建文件」按钮之后、`<span class="toolbar-spacer" />` 之前插入：

```html
        <span class="toolbar-dir" :title="store.workDir">{{ dirName }}</span>
```

2. `<script setup>` import 区 `import { onBeforeUnmount, ref } from 'vue'` 改为：

```ts
import { computed, onBeforeUnmount, ref } from 'vue'
```

3. `const store = useFilesStore()` 之后加：

```ts
/** 项目目录 basename（title 展示完整路径） */
const dirName = computed(() => {
  const wd = store.workDir
  if (!wd) return ''
  return wd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? wd
})
```

4. `.panel-toolbar` 高度 40px → 32px（与右侧 FileTabs 高度一致）：

```css
.panel-toolbar {
  height: 32px;
  min-height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
```

5. `.toolbar-spacer` 之后加（目录名用终端次色，弱于主文本）：

```css
.toolbar-dir {
  margin-left: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  color: var(--term-bright-black);
}
```

- [ ] **Step 4: FileTree.vue 文件夹图标色**

`src/renderer/src/components/code/FileTree.vue` 三处行图标给文件夹加 `icon-dir` class（文件图标继承 `.row` 的 `color: var(--text-secondary)` 即 `--term-fg`，无需处理）：

模板第 230 行（编辑态）与第 250 行（普通态）：

```html
          <Icon :name="entry.isDir ? 'folder-open' : 'file-text'" :size="14" :class="{ 'icon-dir': entry.isDir }" />
```

模板第 265 行（新建 ghost 行）：

```html
      <Icon :name="editing.isDir ? 'folder-open' : 'file-text'" :size="14" :class="{ 'icon-dir': editing.isDir }" />
```

`<style scoped>` 末尾追加：

```css
.icon-dir { color: var(--term-blue); }
```

- [ ] **Step 5: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。

- [ ] **Step 6: 主进程测试确认不受影响**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/styles/theme.css src/renderer/src/components/code/CodeView.vue src/renderer/src/components/code/FileTree.vue
git commit -m "feat: 代码工作区配色跟随终端主题 + 工具栏对齐/显示目录"
```

- [ ] **Step 8: 手动冒烟（dev server 运行中）**

1. 打开某会话的「代码」子页，确认文件树背景为 `--term-bg`（暗色终端下深色、亮色终端下浅色）。
2. 外观 → 终端配色换成 solarized-light：文件树 / 编辑器 tab / 工具条立即变亮。
3. 从未挂载终端时（新建会话直接切「代码」），工作区用 default-dark 兜底色，不白屏不失效。
4. 文件夹图标为蓝色（`--term-blue`），文件图标跟随文字色。
5. 文件树工具栏（刷新 / + / 折叠）高度与右侧编辑器 tab 栏完全一致（32px），上下无错位。
6. `+` 按钮右侧显示当前项目目录名（basename）；hover 显示完整路径；目录过长时省略号截断。

---

### Task 2: code.fontSize 设置项

**Files:**
- Modify: `src/renderer/src/types/settings.ts`（`CodeConfig` + `Settings.code` + `defaultCodeConfig`）
- Modify: `src/renderer/src/stores/settings.ts`（`defaultSettings` + `load` 兼容回退）
- Modify: `src/renderer/src/components/settings/AppearanceTab.vue`（「代码编辑器」section）

**Interfaces:**
- Consumes: 无（自包含配置项）。
- Produces: `Settings.code: CodeConfig`（`{ fontSize: number }`）、`defaultCodeConfig(): CodeConfig`（`{ fontSize: 12 }`）。Task 3 的 CodeEditor 依赖 `settings.cfg.code.fontSize`。

- [ ] **Step 1: types/settings.ts 新增 CodeConfig**

`src/renderer/src/types/settings.ts` 在 `defaultTerminalConfig()` 之后追加：

```ts
export interface CodeConfig {
  /** 代码编辑器字号 px，10-20 */
  fontSize: number
}

export function defaultCodeConfig(): CodeConfig {
  return { fontSize: 12 }
}
```

`Settings` 接口在 `terminal: TerminalConfig` 之后加一行：

```ts
  terminal: TerminalConfig
  /** 代码编辑器配置 */
  code: CodeConfig
```

- [ ] **Step 2: stores/settings.ts 兼容 code 缺省**

`src/renderer/src/stores/settings.ts`：

1. import 行改为：

```ts
import { defaultTerminalConfig, defaultCodeConfig, type Settings, type TerminalTheme } from '../types/settings'
```

2. `defaultSettings()` 返回值中 `terminal: defaultTerminalConfig(),` 之后加一行：

```ts
    code: defaultCodeConfig(),
```

3. `load()` 中 `const merged: Settings = { ...defaultSettings(), ...(raw || {}) }` 之后、`if (terminalExplicit)` 之前插入（兼容旧版本无 `code` 字段）：

```ts
    // 兼容旧版本：code 缺省时回退默认
    merged.code = { ...defaultCodeConfig(), ...(raw?.code || {}) }
```

- [ ] **Step 3: AppearanceTab.vue 新增「代码编辑器」section**

`src/renderer/src/components/settings/AppearanceTab.vue`：

1. 模板中「终端配色」`</section>`（现有第 31 行）之后插入：

```html
    <!-- 代码编辑器 -->
    <section class="section">
      <div class="section-title">代码编辑器</div>
      <div class="form-group">
        <label class="form-label">
          字号
          <span class="form-value">{{ codeCfg.fontSize }}px</span>
        </label>
        <input
          type="range"
          min="10"
          max="20"
          step="1"
          v-model.number="codeCfg.fontSize"
          @input="onCodeFontSizeInput"
        />
        <p class="form-hint">配色跟随终端主题，切换终端配色即生效。</p>
      </div>
    </section>
```

2. import 行改为：

```ts
import { defaultTerminalConfig, defaultCodeConfig, type TerminalConfig, type CodeConfig, type TerminalTheme, type TerminalCursorStyle } from '../../types/settings'
```

3. `const cfg = ref<TerminalConfig>(defaultTerminalConfig())` 之后加：

```ts
/** 代码编辑器配置的本地镜像，与 cfg 同机制同步 */
const codeCfg = ref<CodeConfig>(defaultCodeConfig())
```

4. `syncToStore()` 之后加：

```ts
function syncCodeToStore() {
  if (!settings.cfg || syncing) return
  settings.cfg.code = { ...codeCfg.value }
  settings.markDirty()
}
```

5. `onMounted` 回调里 `cfg.value = { ...settings.cfg.terminal }` 之后加一行：

```ts
    codeCfg.value = { ...settings.cfg.code }
```

6. `watch(() => settings.cfg?.terminal, ...)` 块之后追加（store 重新 load 时同步 code）：

```ts
watch(() => settings.cfg?.code, (c) => {
  if (!c) return
  syncing = true
  codeCfg.value = { ...c }
  syncing = false
}, { deep: true })
```

7. `onFontSizeInput` 函数之后追加：

```ts
/** 代码字号拖动时同步到 store，CodeEditor 的 watch 实时应用 */
function onCodeFontSizeInput() {
  syncCodeToStore()
}
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。

- [ ] **Step 5: 主进程测试确认不受影响**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/types/settings.ts src/renderer/src/stores/settings.ts src/renderer/src/components/settings/AppearanceTab.vue
git commit -m "feat: 代码编辑器字号可调（外观页滑杆 + 持久化）"
```

- [ ] **Step 7: 手动冒烟（dev server 运行中）**

1. 外观页出现「代码编辑器」区，默认 12px。
2. 拖动字号滑杆到 16px → 值即时显示「16px」。
3. 重启应用后字号保持 16px（持久化）。

---

### Task 3: Monaco 主题运行时构建 + 字号应用

**Files:**
- Modify: `src/renderer/src/components/code/CodeEditor.vue`

**Interfaces:**
- Consumes: Task 1 的 `:root` 兜底 `--term-*` 与 `--code-hover`/`--code-border`；Task 2 的 `settings.cfg.code.fontSize`。
- Produces: Monaco 编辑器 `theme: 'code-<themeId>'`（运行时由 CSS 变量构建）、字号从设置读取。

- [ ] **Step 1: CodeEditor.vue 增加主题构建与字号应用**

`src/renderer/src/components/code/CodeEditor.vue` 按下列 5 处修改：

1. import 区加 settings store：

```ts
import { useFilesStore, type OpenFile } from '../../stores/files'
import { useSettingsStore } from '../../stores/settings'
```

2. `const store = useFilesStore()` 之后加：

```ts
const settings = useSettingsStore()
```

3. 模块级 `let activeModelRelPath` 之后加：

```ts
// 当前 Monaco 主题名。编辑器创建时使用；终端主题变化时重建。
let currentThemeName = 'code-default-dark'
```

4. `languageFor` 函数之后、`ensureMonaco` 之前插入下列函数：

```ts
/** 读 CSS 变量值（html 上全局 --term-*）。未定义时回退黑色，避免 Monaco 报非法色值 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000'
}

/** 当前终端主题 id：优先 data-term-theme 属性，缺省回退 default-dark */
function currentThemeId(): string {
  return document.documentElement.getAttribute('data-term-theme') || 'default-dark'
}

/** 由 --term-* 构建 Monaco 主题（运行时读 CSS，单一色源）。返回主题名。 */
function buildMonacoTheme(monaco: Monaco, themeId: string): string {
  const themeName = `code-${themeId}`
  const fg = cssVar('--term-fg')
  const bg = cssVar('--term-bg')
  const selection = cssVar('--term-selection')
  const cursor = cssVar('--term-cursor')
  const brightBlack = cssVar('--term-bright-black')
  // 亮色终端（solarized-light / warm-light）用浅色 base，保证未映射 token 有足够对比度
  const base = themeId === 'solarized-light' || themeId === 'warm-light' ? 'vs' : 'vs-dark'
  monaco.editor.defineTheme(themeName, {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: brightBlack },
      { token: 'keyword', foreground: cssVar('--term-magenta') },
      { token: 'string', foreground: cssVar('--term-green') },
      { token: 'number', foreground: cssVar('--term-yellow') },
      { token: 'type', foreground: cssVar('--term-blue') },
      { token: 'identifier', foreground: fg },
      { token: 'function', foreground: cssVar('--term-cyan') },
      { token: 'delimiter.bracket', foreground: cssVar('--term-magenta') },
      { token: 'operator', foreground: cssVar('--term-red') },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': brightBlack,
      'editor.selectionBackground': selection,
      'editorCursor.foreground': cursor,
    },
  })
  return themeName
}

/** 应用当前终端主题：先把 data-term-theme 同步为目标主题（幂等，与 XtermTerminal 同源），
 *  再 getComputedStyle 读新色值构建 Monaco 主题并应用到 live 编辑器。
 *  settings.cfg.terminal.theme 由 watch 触发时已是新值；未加载时回退 data-term-theme 属性。 */
async function applyMonacoTheme() {
  const m = await ensureMonaco()
  if (!m) return
  const theme = settings.cfg?.terminal.theme ?? currentThemeId()
  document.documentElement.setAttribute('data-term-theme', theme)
  currentThemeName = buildMonacoTheme(m, theme)
  if (editor) editor.setTheme(currentThemeName)
}
```

5. `ensureEditor` 中，把 `if (!m || !el) return null` 之后加 settings 加载、创建选项改为主题与字号：

```ts
async function ensureEditor(): Promise<StandaloneEditor | null> {
  const m = await ensureMonaco()
  const el = editorEl.value
  if (!m || !el) return null
  if (!settings.cfg) await settings.load()
  if (editor && editorHost === el) return editor
  // 首次创建，或宿主元素随 v-if 分支重建后重新创建（同一时刻仍只有 1 个 live 编辑器）
  if (editor) editor.dispose()
  // 先同步主题（可能已由 watch 更新过 currentThemeName，也可能需要初始化）
  await applyMonacoTheme()
  editor = m.editor.create(el, {
    theme: currentThemeName,
    automaticLayout: true,
    fontSize: settings.cfg?.code?.fontSize ?? 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
  })
  editorHost = el
  editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => { void saveActive() })
  return editor
}
```

6. `onMounted` 开头加 settings 加载：

```ts
onMounted(async () => {
  if (!settings.cfg) await settings.load()
  await nextTick()
  await switchModel()
})
```

7. `onBeforeUnmount` 前（现有 watch 之后）追加两个 watch：

```ts
// 终端主题变化：重建 Monaco 主题并应用到 live 编辑器
watch(
  () => settings.cfg?.terminal.theme,
  () => { void applyMonacoTheme() },
)

// 代码编辑器字号变化：即时应用到 live 编辑器（未创建时创建已读最新值，跳过即可）
watch(
  () => settings.cfg?.code?.fontSize,
  (n) => {
    if (typeof n !== 'number') return
    if (editor) editor.updateOptions({ fontSize: n })
  },
)
```

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。

- [ ] **Step 3: 主进程测试确认不受影响**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/code/CodeEditor.vue
git commit -m "feat: Monaco 编辑器配色跟随终端主题（运行时构建主题）+ 字号应用"
```

- [ ] **Step 5: 手动冒烟（dev server 运行中）**

1. 打开「代码」子页打开一个 `.ts` 文件：Monaco 背景为 `--term-bg`、关键字紫、字符串绿、数字黄、类型蓝、函数青、注释灰、行号灰。
2. 外观 → 终端配色切换（含 solarized-light）：Monaco 背景/语法色立即跟随，编辑器已打开的文件同样变化。
3. 字号滑杆拖到 16px → Monaco 字号即时变；切会话再回来仍 16px。
4. 亮色终端下 Monaco 用浅底深字，可读。

---

### Task 4: 会话现场保留

**Files:**
- Modify: `src/renderer/src/stores/files.ts`（`sessionState` 快照 + `setSession(id, wd)` + `forgetSession`）
- Modify: `src/renderer/src/views/HomeView.vue`（两处 `setSession` 调用 + 会话删除清理）

**Interfaces:**
- Consumes: 现有 `setSession(wd)` 的调用方（`HomeView.vue:376`、`HomeView.vue:518`）改为新签名。
- Produces: `setSession(id: string, wd: string)`、`forgetSession(sid: string)`。

- [ ] **Step 1: files.ts 加会话现场快照**

`src/renderer/src/stores/files.ts`：

1. `OpenFile` 接口之后追加：

```ts
/** 按会话记忆的工作区现场（tab / 草稿 / 激活文件 / 展开态） */
export interface SessionWorkspace {
  openFiles: OpenFile[]
  drafts: Record<string, string>
  activeRelPath: string | null
  expanded: string[]
}
```

2. `const collapsed = ref(false)` 之后追加：

```ts
// 每个会话独立记忆的工作区现场。切换会话即时还原。
const sessionState = ref<Record<string, SessionWorkspace>>({})
// 当前已加载现场的会话 id（'' = 无）。setSession 切走时先保存现场到该槽位。
let lastSessionId = ''
```

3. `setSession` 整体替换为：

```ts
  async function setSession(id: string, wd: string) {
    // 同一会话重复设置：现场已就绪，直接返回避免误清
    if (lastSessionId === id && workDir.value === wd) return
    // 1. 保存当前会话现场（仅当确实有会话在场）
    if (lastSessionId && workDir.value) {
      sessionState.value = {
        ...sessionState.value,
        [lastSessionId]: {
          openFiles: openFiles.value.map((o) => ({ ...o })),
          drafts: { ...drafts.value },
          activeRelPath: activeRelPath.value,
          expanded: [...expanded.value],
        },
      }
    }
    // 2. 切换工作目录：unwatch 旧目录
    if (workDir.value) await FileUnwatch(workDir.value).catch(() => {})
    workDir.value = wd
    lastSessionId = id
    tree.value = { '': [] }
    rootCreateRequest.value = 0
    // 3. 恢复新会话现场；无则初始化空
    const saved = id ? sessionState.value[id] : undefined
    if (saved) {
      openFiles.value = saved.openFiles.map((o) => ({ ...o }))
      drafts.value = { ...saved.drafts }
      activeRelPath.value = saved.activeRelPath
      expanded.value = new Set(saved.expanded)
    } else {
      openFiles.value = []
      drafts.value = {}
      activeRelPath.value = null
      expanded.value = new Set()
    }
    // 4. 挂载新目录 watcher + 拉取根目录；恢复的展开目录内容需重新惰性拉取
    if (wd) {
      await FileWatch(wd).catch(() => {})
      await loadDir('').catch(() => {})
      if (saved) {
        for (const dir of saved.expanded) {
          await loadDir(dir).catch(() => {})
        }
      }
    }
  }

  /** 会话删除时清理其现场快照，避免泄漏 */
  function forgetSession(sid: string) {
    if (!(sid in sessionState.value)) return
    const next = { ...sessionState.value }
    delete next[sid]
    sessionState.value = next
  }
```

4. `return` 对象里 `setSession` 之后加 `forgetSession`：

```ts
    setSession, forgetSession, loadDir, toggleExpand, openFile, closeFile, saveFile, reloadFile,
```

- [ ] **Step 2: HomeView.vue 更新调用点**

`src/renderer/src/views/HomeView.vue` 三处修改：

1. `watch(activeSessionId)` 中（现有第 376 行）：

```ts
  void files.setSession(newId, wd)
```

2. `watch(() => tabsStore.activeType)` 中（现有第 518 行）：

```ts
    if (type !== 'session') void files.setSession('', '')
```

3. `closeSessionTab` 中 `subTabBySession` 清理处（现有第 460-464 行）之后追加一行：

```ts
  // 清理该会话的代码工作区现场
  files.forgetSession(sid)
```

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。若报 `files.setSession` 参数不匹配，说明有遗漏调用点，grep `\.setSession\(` 复查。

- [ ] **Step 4: 主进程测试确认不受影响**

Run: `cd G:/work/lynel-desktop && npm run test:main`
Expected: 38 文件 / 344 用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/files.ts src/renderer/src/views/HomeView.vue
git commit -m "feat: 会话切换保留代码工作区现场（tab/草稿/激活文件/展开态）"
```

- [ ] **Step 6: 手动冒烟（dev server 运行中）**

1. 会话 A：打开 2 个文件、编辑一个留草稿（置脏）、展开若干目录 → 切会话 B → 回 A：tab 列表、未保存草稿、激活文件、展开目录全部还原。
2. A 的展开目录内容被重新拉取（树里能看到子项），非空白。
3. 切离会话页（回首页/搜索）再进会话：现场仍在。
4. 关闭会话 A：再次打开同名 workdir 的新会话 A'：不残留 A 的旧 tab（`forgetSession` 生效）。
5. 回归：快速切 A→B→A 不出现 `Maximum call stack size exceeded`；文件树右键新建/重命名/删除正常。

---

## 自审记录

- **Spec 覆盖**：A1（CodeView 变量覆盖 + `:root` 兜底）→ Task 1；A2（Monaco 运行时构建）→ Task 3；A3（文件树图标色）→ Task 1；B（`code.fontSize` + 滑杆）→ Task 2；C（sessionState + `setSession(id, wd)` + HomeView + 删除清理）→ Task 4。spec「组件与文件改动」表 9 个文件全部覆盖。
- **补充需求（用户 2026-09-01 追加）**：文件树工具栏高度与右侧 tab 栏对齐（32px）+ 显示项目目录名 → 并入 Task 1 Step 3（CodeView.vue）。
- **占位符扫描**：无 TBD/TODO；所有代码步含完整内容；CodeEditor/HomeView 大文件改动采用 old→new 精确块。
- **类型一致性**：`defaultCodeConfig()`/`Settings.code` 定义于 Task 2，AppearanceTab（Task 2）与 CodeEditor（Task 3）引用一致；`setSession(id, wd)`/`forgetSession(sid)` 定义于 Task 4，HomeView 两处调用与删除清理签名一致。
- **非目标（YAGNI）**：不做 Monaco 光标/滚动位置按会话恢复；不做不同文件类型不同图标；不做工作区配色与终端解耦开关；不做 Monaco 字体族设置；不改终端配色机制。
