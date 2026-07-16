# 使用指南（标题栏入口 + 指南标签页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标题栏设置按钮左边添加"使用指南"入口，点击后在全局 Tab 中打开多章节 Markdown 指南页。

**Architecture:** 复用现有 GlobalTabs 单例 Tab 机制（与设置 Tab 同构）新增 `guide` 类型；指南内容为 `src/renderer/src/guide/*.md`，通过 Vite `import.meta.glob` 构建期打包，`marked` 渲染，左侧章节导航 + 右侧内容区。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia（setup style）、marked 18.0.5（已安装）、@lucide/vue 1.23.0、Vite `import.meta.glob`。

**规格文档:** `docs/superpowers/specs/2026-07-16-user-guide-design.md`

## Global Constraints

- 所有代码注释、UI 文案、commit message 用简体中文。
- 样式只用 `styles/theme.css` 的 CSS 变量，禁止硬编码颜色。
- 图标只用 `@lucide/vue` 经 `components/Icon.vue` 注册引用，禁止 emoji/Unicode 符号。
- 本项目 renderer 无单元测试框架；每个 Task 的验证方式为 `cd src/renderer && npx vue-tsc --noEmit` 全绿（不新增测试框架，YAGNI）。全部完成后另跑 `npm run test:main` 回归。
- **不执行任何 git 提交**（用户全局约定：未主动要求不得计划/执行 git 操作）。计划中不含 commit 步骤；用户要求提交时遵循项目提交规范。
- 不涉及主进程 / IPC / preload 的任何改动。
- 注意：本版本 `@lucide/vue@1.23.0` 中问号圆圈图标导出名为 `CircleQuestionMark`（无 `CircleHelp`），视觉一致。

---

### Task 1: Tab 类型与 store 扩展

**Files:**
- Modify: `src/renderer/src/types/tab.ts:1`
- Modify: `src/renderer/src/stores/tabs.ts:50-52`（在 `openSettings` 后新增）、`src/renderer/src/stores/tabs.ts:78-90`（return 导出）

**Interfaces:**
- Consumes: 现有 `open(tab: Omit<Tab, 'id'>)`（`stores/tabs.ts`，单例 id 由 `generateTabId` 按 type 生成）。
- Produces: `TabType` 含 `'guide'`；`useTabsStore().openGuide(): string`（返回 tab id `'guide'`，重复调用只激活不重建）。Task 3 的 HomeView 依赖这两者。

- [ ] **Step 1: 扩展 TabType**

`src/renderer/src/types/tab.ts` 第 1 行改为：

```ts
export type TabType = 'welcome' | 'session' | 'settings' | 'guide'
```

- [ ] **Step 2: store 新增 openGuide**

`src/renderer/src/stores/tabs.ts`，在 `openSettings()` 函数定义之后新增：

```ts
  function openGuide() {
    return open({ type: 'guide', title: '使用指南' })
  }
```

并在文件末尾的 `return { ... }` 中 `openSettings,` 之后加一行 `openGuide,`。

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误退出（exit 0）。

---

### Task 2: 图标注册与标题栏入口按钮

**Files:**
- Modify: `src/renderer/src/components/Icon.vue:3-27`（import 列表）、`src/renderer/src/components/Icon.vue:35-59`（icons 映射）
- Modify: `src/renderer/src/components/TitleBar.vue:9-12`（模板）、`src/renderer/src/components/TitleBar.vue:41-42`（props/emits）
- Modify: `src/renderer/src/components/GlobalTabs.vue:14-20`（tab 图标分支）

**Interfaces:**
- Consumes: 无（不依赖 Task 1）。
- Produces: `Icon` 组件支持 `name="help"`；`TitleBar` 新增 prop `showGuide?: boolean`（默认 undefined 即不显示）与事件 `guide`。Task 3 的 HomeView 依赖 `show-guide` prop 和 `@guide` 事件。

- [ ] **Step 1: Icon.vue 注册 help 图标**

在 `@lucide/vue` 的 import 列表中按字母序（`ChevronRight` 与 `Cloud` 之间）加入 `CircleQuestionMark,`：

```ts
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleQuestionMark,
  Cloud,
  // ……其余保持不变
} from '@lucide/vue'
```

在 `icons` 映射中 `settings: Settings,` 附近加入：

```ts
  help: CircleQuestionMark,
```

- [ ] **Step 2: TitleBar.vue 新增指南按钮与接口**

模板中，在设置按钮（`aria-label="设置"` 的 button）**之前**插入：

```vue
      <button v-if="props.showGuide" class="iconbtn" aria-label="使用指南" title="使用指南" @click="$emit('guide')">
        <Icon name="help" :size="14" />
      </button>
```

脚本中 props 与 emits 改为：

```ts
const props = defineProps<{ username?: string; showGuide?: boolean }>()
defineEmits<{ (e: 'settings'): void; (e: 'guide'): void }>()
```

- [ ] **Step 3: GlobalTabs.vue 增加 guide 类型图标**

`tab-icon` 的分支链中，在 `settings` 分支之后插入：

```vue
          <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
```

即：

```vue
        <span class="tab-icon">
          <Icon v-if="tab.type === 'welcome'" name="bot" :size="12" />
          <Icon v-else-if="tab.type === 'settings'" name="settings" :size="12" />
          <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
          <Icon v-else-if="isRunning(tab.id)" name="loader" :size="12" class="spin" />
          <Icon v-else-if="isAwaitingPermission(tab.id)" name="warning" :size="12" class="pulse-icon" />
          <Icon v-else name="terminal" :size="12" />
        </span>
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误退出（exit 0）。此时按钮尚未在任何视图启用（无视图传 `showGuide`），界面无变化。

---

### Task 3: 指南内容骨架、GuideTab 组件与 HomeView 接线

**Files:**
- Create: `src/renderer/src/guide/01-快速开始.md`
- Create: `src/renderer/src/guide/02-会话管理.md`
- Create: `src/renderer/src/guide/03-常见问题.md`
- Create: `src/renderer/src/components/GuideTab.vue`
- Modify: `src/renderer/src/views/HomeView.vue:3`（TitleBar）、`:48-50` 附近（新增面板）、`:73-86`（import）、`:203-205` 附近（新增函数）

**Interfaces:**
- Consumes: Task 1 的 `useTabsStore().openGuide()` 与 `TabType 'guide'`；Task 2 的 `TitleBar` `showGuide` prop / `guide` 事件、`Icon name="help"`。
- Produces: `GuideTab.vue`（无 props、无 emits 的自包含组件）；`src/renderer/src/guide/` 内容目录约定（`NN-章节名.md`，数字前缀排序、去前缀为章节名）。

- [ ] **Step 1: 创建章节骨架文件**

`src/renderer/src/guide/01-快速开始.md`：

```markdown
# 快速开始

欢迎使用 Lynel Desktop。

## 创建第一个会话

1. 点击左侧会话列表的"新建"按钮。
2. 选择工作目录。
3. 在终端中输入你的第一个 prompt。

> 本章内容待补充完善。
```

`src/renderer/src/guide/02-会话管理.md`：

```markdown
# 会话管理

## 会话列表

左侧面板展示全部会话及其运行状态。

## 恢复历史会话

点击历史会话即可在终端中恢复上下文继续对话。

> 本章内容待补充完善。
```

`src/renderer/src/guide/03-常见问题.md`：

```markdown
# 常见问题

## 终端没有反应怎么办？

请确认会话状态并尝试重新打开会话。

> 本章内容待补充完善。
```

- [ ] **Step 2: 创建 GuideTab.vue**

`src/renderer/src/components/GuideTab.vue` 完整内容：

```vue
<template>
  <div class="guide-tab">
    <nav class="sidebar">
      <button
        v-for="ch in chapters"
        :key="ch.key"
        class="chapter"
        :class="{ active: ch.key === activeKey }"
        @click="selectChapter(ch.key)"
      >
        {{ ch.title }}
      </button>
    </nav>
    <main ref="contentEl" class="content">
      <article v-if="activeChapter" class="markdown" v-html="activeChapter.html" />
      <div v-else class="empty">暂无指南内容</div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { marked } from 'marked'

interface Chapter {
  key: string
  title: string
  html: string
}

// 构建期打包全部章节，运行时零 IO
const rawModules = import.meta.glob<string>('../guide/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 文件名格式 NN-章节名.md：数字前缀定序，去前缀为章节名
const chapters: Chapter[] = Object.keys(rawModules)
  .sort()
  .map((path) => {
    const file = path.split('/').pop() ?? path
    const key = file.replace(/\.md$/, '')
    const title = key.replace(/^\d+-/, '')
    let html: string
    try {
      html = marked.parse(rawModules[path]) as string
    } catch {
      // 解析失败时显示转义后的原始文本兜底
      html = `<pre>${escapeHtml(rawModules[path])}</pre>`
    }
    return { key, title, html }
  })

const activeKey = ref(chapters[0]?.key ?? '')
const contentEl = ref<HTMLElement | null>(null)
const activeChapter = computed(() => chapters.find((c) => c.key === activeKey.value) ?? null)

function selectChapter(key: string) {
  activeKey.value = key
  contentEl.value?.scrollTo({ top: 0 })
}
</script>

<style scoped>
.guide-tab {
  flex: 1;
  display: flex;
  min-height: 0;
  background: var(--bg-primary);
}
.sidebar {
  width: 200px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
  flex-shrink: 0;
  overflow-y: auto;
}
.chapter {
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.chapter:hover { color: var(--text-primary); background: var(--accent-soft-bg); }
.chapter.active { color: var(--accent); background: var(--accent-soft-bg); font-weight: 650; }
.content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: 24px 32px;
}
.empty {
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 24px;
}
.markdown { max-width: 760px; color: var(--text-primary); font-size: 14px; line-height: 1.7; }
.markdown :deep(h1) { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
.markdown :deep(h2) { font-size: 17px; font-weight: 700; margin: 24px 0 10px; }
.markdown :deep(h3) { font-size: 15px; font-weight: 650; margin: 18px 0 8px; }
.markdown :deep(p) { margin: 0 0 12px; }
.markdown :deep(ul), .markdown :deep(ol) { margin: 0 0 12px; padding-left: 22px; }
.markdown :deep(li) { margin: 4px 0; }
.markdown :deep(a) { color: var(--accent); }
.markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}
.markdown :deep(pre) {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0 0 12px;
}
.markdown :deep(pre code) { border: none; background: transparent; padding: 0; }
.markdown :deep(blockquote) {
  margin: 0 0 12px;
  padding: 6px 14px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft-bg);
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
}
.markdown :deep(table) { border-collapse: collapse; margin: 0 0 12px; }
.markdown :deep(th), .markdown :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-size: 13px;
}
.markdown :deep(th) { background: var(--bg-panel); }
.markdown :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
</style>
```

- [ ] **Step 3: HomeView.vue 接线**

第 3 行 TitleBar 改为：

```vue
    <TitleBar :username="username" show-guide @settings="openSettingsTab" @guide="openGuideTab" />
```

内容区 settings 面板之后新增：

```vue
          <div v-show="tabsStore.activeType === 'guide'" class="content-pane">
            <GuideTab />
          </div>
```

import 区（`import SettingsTab ...` 之后）新增：

```ts
import GuideTab from '../components/GuideTab.vue'
```

`openSettingsTab()` 函数之后新增：

```ts
function openGuideTab() {
  tabsStore.openGuide()
}
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误退出（exit 0）。

- [ ] **Step 5: 手动验证（npm run dev）**

Run: `npm run dev`（仓库根目录，需要 Electron runtime）
验证清单：
1. 首页标题栏设置按钮左边出现问号圆圈按钮，tooltip"使用指南"；登录页无此按钮。
2. 点击打开"使用指南" Tab（图标为问号圆圈）；重复点击只激活已有 Tab，不重复创建。
3. 左侧显示"快速开始 / 会话管理 / 常见问题"三章，按序排列，默认选中第一章。
4. 切换章节内容正确渲染（标题、列表、引用块样式正常），且内容区滚动回顶部。
5. 浅色/深色主题下文字与背景均清晰可读。
6. 关闭该 Tab 后可再次打开。

- [ ] **Step 6: 主进程回归**

Run: `npm run test:main`
Expected: 全绿（本次未改主进程，仅回归确认）。
