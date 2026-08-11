# 首页重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主页欢迎页重设计为「首页」：会话列表上方加首页入口、顶部 tab 栏去掉首页 tab、首页内提供快速开会话框与历史会话。

**Architecture:** 前端纯 Vue 改造：`GlobalTabs` 过滤 welcome tab；`HomeView` 左侧工具条加首页按钮；新建 `QuickLaunch` 快速开会话框并嵌入改造后的 `WelcomeTab`。主进程仅一处兜底：`app:createSession` 对空 workdir 回退 `os.homedir()`。

**Tech Stack:** Electron + Vue 3 + Pinia + @lucide/vue + vitest（主进程）。

## Global Constraints

- 全部注释、commit message 用简体中文。
- 不主动执行 git commit；如需提交须先征得用户明确同意。
- 主进程改动（Task 1）完成后 `npm run test:main` 必须全绿。
- 每个前端任务完成后 `cd src/renderer && npx vue-tsc --noEmit` 必须全绿。
- 图标统一用 `@lucide/vue`（通过 `components/Icon.vue`），禁止 emoji / Unicode 符号。
- 颜色只用 `styles/theme.css` 的 CSS 变量，不硬编码。
- 任务内的 commit 步骤仅在用户要求提交时才执行，验证命令始终执行。

---

### Task 1: 主进程空 workdir 兜底

**Files:**
- Create: `src/main/workdir.ts`
- Test: `tests/main/workdir.test.ts`
- Modify: `src/main/app.ts:1517-1519`（handler 内改用 `normalizeWorkdir`）

**Interfaces:**
- Consumes: 无（纯函数模块）
- Produces: `normalizeWorkdir(workdir?: string): string` —— 空白回退 `os.homedir()`，非空去首尾空白原样返回。后续任务不依赖此函数。

- [ ] **Step 1: 写失败测试**

创建 `tests/main/workdir.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import { normalizeWorkdir } from '../../src/main/workdir'

describe('normalizeWorkdir', () => {
  it('空白/空串回退到用户主目录', () => {
    expect(normalizeWorkdir('')).toBe(os.homedir())
    expect(normalizeWorkdir('   ')).toBe(os.homedir())
    expect(normalizeWorkdir(undefined)).toBe(os.homedir())
  })
  it('非空目录原样返回并去除首尾空白', () => {
    expect(normalizeWorkdir('/tmp/foo')).toBe('/tmp/foo')
    expect(normalizeWorkdir('  C:\\Work\\Project  ')).toBe('C:\\Work\\Project')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --dir tests/main --reporter=dot`
Expected: FAIL —— `Cannot find module '../../src/main/workdir'`

- [ ] **Step 3: 写实现**

创建 `src/main/workdir.ts`：

```ts
import os from 'node:os';

/** 创建会话时规范化工作目录：空白回退到用户主目录（快速开会话未选目录时的兜底） */
export function normalizeWorkdir(workdir?: string): string {
  const w = (workdir || '').trim();
  return w || os.homedir();
}
```

- [ ] **Step 4: 在 app.ts 接入**

在 `src/main/app.ts` import 区（`./session.js` 之后）新增：

```ts
import { normalizeWorkdir } from './workdir.js';
```

并把 handler 内部改为：

```ts
return await this.createSessionInternal(normalizeWorkdir(workDir), prompt, extraArgs, false, undefined, agent as AgentKind);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/main/workdir.test.ts --reporter=dot`
Expected: PASS (3 用例)

- [ ] **Step 6: 提交（需用户明确同意才执行）**

```bash
git add src/main/workdir.ts tests/main/workdir.test.ts src/main/app.ts
git commit -m "feat: 创建会话时空 workdir 兜底到用户主目录"
```

---

### Task 2: GlobalTabs 过滤 welcome tab

**Files:**
- Modify: `src/renderer/src/components/GlobalTabs.vue`

**Interfaces:**
- Consumes: props `tabs: Tab[]`、`activeId: string | null`（来自 HomeView，签名不变）
- Produces: 组件内部不再渲染 `type === 'welcome'` 的 tab；HomeView 传参不变

- [ ] **Step 1: 加过滤 computed**

在 `<script setup>` 中 `const emit = ...` 之后新增：

```ts
const visibleTabs = computed(() => props.tabs.filter((t) => t.type !== 'welcome'))
```

- [ ] **Step 2: 模板改用 visibleTabs**

模板第 5 行 `v-for="tab in tabs"` 改为 `v-for="tab in visibleTabs"`。

- [ ] **Step 3: 删除不再命中的 welcome 图标分支**

模板中 tab-icon 里的 welcome 分支删除（welcome 不会再渲染）：

```html
<span v-if="tab.type !== 'session'" class="tab-icon">
  <Icon v-if="tab.type === 'welcome'" name="bot" :size="12" />
  <Icon v-else-if="tab.type === 'settings'" name="settings" :size="12" />
  <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
</span>
```

改为：

```html
<span v-if="tab.type !== 'session'" class="tab-icon">
  <Icon v-if="tab.type === 'settings'" name="settings" :size="12" />
  <Icon v-else-if="tab.type === 'guide'" name="help" :size="12" />
</span>
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（全绿）

- [ ] **Step 5: 提交（需用户明确同意才执行）**

```bash
git add src/renderer/src/components/GlobalTabs.vue
git commit -m "feat: 顶部 tab 栏隐藏首页 tab，仅保留会话/设置/指南"
```

---

### Task 3: 新建 QuickLaunch 快速开会话框

**Files:**
- Create: `src/renderer/src/components/QuickLaunch.vue`

**Interfaces:**
- Consumes: `AgentSelect`、`Icon`、`PickDirectory`、`useBotsStore`、`useSessionsStore`、`agentMeta`/`AgentKind`（均已有）
- Produces: `QuickLaunch`，props `loading?: boolean`；emit `create(workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind)`。Task 4 消费此事件。

- [ ] **Step 1: 写组件**

创建 `src/renderer/src/components/QuickLaunch.vue`：

```vue
<template>
  <form class="quick-launch" @submit.prevent="onSubmit">
    <div class="ql-top">
      <AgentSelect v-model="agent" class="ql-agent" />
    </div>
    <textarea
      v-model="prompt"
      class="ql-input"
      rows="2"
      :placeholder="`你想让 ${agentMeta(agent).short} 做什么？`"
      :disabled="loading"
      @keydown.enter="onEnter"
    />
    <div class="ql-bottom">
      <div class="ql-left">
        <button type="button" class="ql-dir" :title="workdir || '未选择，使用默认目录'" :disabled="loading" @click="onPick">
          <Icon name="folder" :size="13" />
          <span class="ql-dir-text">{{ workdir || '默认目录' }}</span>
          <Icon name="chevron-down" :size="11" class="ql-chevron" />
        </button>
        <select class="ql-bot" v-model="selectedBot" :disabled="loading">
          <option value="">不绑定</option>
          <option v-for="b in botOptions" :key="b.id" :value="b.id" :disabled="!isBotAvailable(b.id)">
            {{ b.name }}{{ getBotBoundSessionName(b.id) ? `（已绑定 ${getBotBoundSessionName(b.id)}）` : '' }}
          </option>
        </select>
      </div>
      <button type="submit" class="ql-send" :disabled="!prompt.trim() || loading">
        <span v-if="loading" class="ql-spinner" />
        <Icon v-else name="paper-plane" :size="14" />
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import AgentSelect from './AgentSelect.vue'
import { agentMeta, type AgentKind } from '../types/agents'
import { PickDirectory } from '../composables/useElectron'
import { useBotsStore } from '../stores/bots'
import { useSessionsStore } from '../stores/sessions'

const props = defineProps<{ loading?: boolean }>()
const emit = defineEmits<{
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
}>()

const workdir = ref('')
const prompt = ref('')
const agent = ref<AgentKind>('claude')
const selectedBot = ref('')

const botsStore = useBotsStore()
const sessions = useSessionsStore()
const botOptions = computed(() => botsStore.bots)

onMounted(() => {
  void botsStore.load()
  void sessions.loadBotBindings()
})

function isBotAvailable(botId: string): boolean {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  return !sessionId
}

function getBotBoundSessionName(botId: string): string | undefined {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  if (!sessionId) return undefined
  return sessions.getBotBoundSessionName(botId)
}

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) return
  e.preventDefault()
  onSubmit()
}

async function onPick() {
  try {
    const dir = await PickDirectory()
    if (dir) workdir.value = dir
  } catch {}
}

function onSubmit() {
  if (!prompt.value.trim() || props.loading) return
  emit('create', workdir.value.trim(), prompt.value.trim(), [], selectedBot.value || undefined, agent.value)
}
</script>

<style scoped>
.quick-launch {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  padding: 10px 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.quick-launch:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft-bg);
}
.ql-top { display: flex; }
.ql-agent { width: auto; min-width: 140px; padding: 6px 10px; font-size: 12px; }
.ql-input {
  width: 100%; border: none; outline: none; background: transparent;
  color: var(--text-primary); font-size: 14px; font-family: inherit;
  resize: none; line-height: 1.5;
}
.ql-input::placeholder { color: var(--text-tertiary); }
.ql-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ql-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ql-dir {
  display: flex; align-items: center; gap: 6px; max-width: 200px;
  padding: 5px 10px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-panel);
  color: var(--text-secondary); font-size: 12px; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.ql-dir:hover:not(:disabled) { border-color: var(--accent); color: var(--text-primary); }
.ql-dir-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ql-chevron { color: var(--text-tertiary); flex-shrink: 0; }
.ql-bot {
  max-width: 160px; padding: 5px 8px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-panel);
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.ql-bot:focus { outline: none; border-color: var(--accent); }
.ql-send {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%;
  border: none; background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: white; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: filter 0.15s;
}
.ql-send:hover:not(:disabled) { filter: brightness(1.08); }
.ql-send:disabled { opacity: 0.45; cursor: not-allowed; }
.ql-spinner {
  width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff; border-radius: 50%;
  animation: ql-spin 0.75s linear infinite;
}
@keyframes ql-spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（全绿）

- [ ] **Step 3: 提交（需用户明确同意才执行）**

```bash
git add src/renderer/src/components/QuickLaunch.vue
git commit -m "feat: 新增 QuickLaunch 快速开会话框（agent/提示词/目录/bot/发送）"
```

---

### Task 4: 改造 WelcomeTab 为首页

**Files:**
- Modify: `src/renderer/src/components/WelcomeTab.vue`（整体重写模板 + emits）

**Interfaces:**
- Consumes: `QuickLaunch`（Task 3）、`Icon`、`RecentSessionList`、`useRecentStore`、`useRecentSessionSearch`、`RecentSession` 类型
- Produces: emits `guide: []`、`create(workdir, prompt, extraArgs, botId?, agent?)`、`open-recent: [RecentSession]`。Task 5 在 HomeView 消费新 `create` 事件。

- [ ] **Step 1: 重写组件**

整体替换 `src/renderer/src/components/WelcomeTab.vue` 内容：

```vue
<template>
  <div class="home-tab">
    <div class="card">
      <div class="brand">
        <div class="brand-name">
          <span class="brand-lynel">Lynel</span>
          <span class="brand-desktop">Desktop</span>
        </div>
        <button class="guide-btn" @click="$emit('guide')">
          <Icon name="help" :size="15" />
          <span>使用指南</span>
        </button>
      </div>
      <p class="tagline">集成 Claude / Codex / OpenCode 的多 Agent 桌面终端，请求与成本全程可视化，权限审批经企业微信与手机远程完成。</p>
      <div class="badges">
        <span class="badge">多 Agent 终端</span>
        <span class="badge">请求可视化</span>
        <span class="badge">远程审批</span>
      </div>
      <QuickLaunch class="quick" :loading="creating" @create="onQuickCreate" />
      <div class="recent-section">
        <div class="section-header">
          <div class="section-title">历史会话</div>
          <span v-if="recent.recentSessions.length" class="count">{{ recentSearchText ? `${filteredRecent.length} / ${recent.recentSessions.length}` : recent.recentSessions.length }}</span>
        </div>
        <div v-if="recent.loading" class="loading">加载中...</div>
        <template v-else>
          <div class="recent-search">
            <Icon name="search" :size="12" class="search-icon" />
            <input
              v-model="recentSearchText"
              class="search-input"
              placeholder="搜索（项目 / 标题 / 目录）"
              @keydown.escape="recentSearchText = ''"
            />
            <button v-if="recentSearchText" class="search-clear" aria-label="清除搜索" title="清除搜索" @click="recentSearchText = ''">
              <Icon name="close" :size="12" />
            </button>
          </div>
          <div v-if="!filteredRecent.length" class="loading">{{ recentSearchText ? '无匹配结果' : '暂无历史会话' }}</div>
          <RecentSessionList
            v-else
            :list="filteredRecent"
            :limit="10"
            @select="$emit('open-recent', $event)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import QuickLaunch from './QuickLaunch.vue'
import RecentSessionList from './RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import { useSessionsStore } from '../stores/sessions'
import { useRecentSessionSearch } from '../composables/useRecentSessionSearch'
import type { AgentKind } from '../types/agents'
import type { RecentSession } from '../types/recent'

const recent = useRecentStore()
const sessions = useSessionsStore()
const { search: recentSearchText, filtered: filteredRecent } = useRecentSessionSearch()

// 创建中 loading 直接绑定全局 store，创建成功/失败后自动复位
const creating = computed(() => sessions.creating)

const emit = defineEmits<{
  guide: []
  create: [workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind]
  'open-recent': [item: RecentSession]
}>()

function onQuickCreate(workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind) {
  emit('create', workdir, prompt, extraArgs, botId, agent)
}

onMounted(() => {
  void recent.loadRecentSessions()
})
</script>

<style scoped>
.home-tab {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: var(--bg-primary); padding: 24px; min-height: 0; overflow: auto;
}
.card {
  width: min(680px, 100%); max-height: min(760px, calc(100% - 48px));
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-panel);
  padding: 28px 28px 22px; display: flex; flex-direction: column; overflow: hidden;
}
.brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.brand-name { display: flex; align-items: center; gap: 6px; font-size: 24px; font-weight: 700; }
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--status-error); font-weight: 500; }
.guide-btn {
  display: flex; align-items: center; gap: 6px; padding: 7px 14px;
  border: none; border-radius: var(--radius-md); background: var(--accent);
  color: var(--text-inverse); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.guide-btn:hover { background: var(--accent-deep); }
.tagline {
  margin: 6px 0 10px; font-size: 13px; color: var(--text-secondary);
  text-align: center; line-height: 1.6;
}
.badges { display: flex; justify-content: center; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.badge {
  padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600;
  color: var(--accent); background: var(--accent-soft-bg);
}
.quick { margin-bottom: 22px; }
.recent-section { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.section-title { font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.count { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft-bg); color: var(--accent); }
.loading { padding: 16px; text-align: center; font-size: 12px; color: var(--text-secondary); }
.recent-search { position: relative; margin-bottom: 10px; }
.recent-search .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
.recent-search .search-input {
  width: 100%; height: 32px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 0 28px 0 30px; color: var(--text-primary);
  font-size: 12px; font-family: inherit; outline: none; transition: border-color 0.15s;
}
.recent-search .search-input:focus { border-color: var(--accent); }
.recent-search .search-input::placeholder { color: var(--text-tertiary); }
.recent-search .search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%; border: none; background: transparent; cursor: pointer;
}
.recent-search .search-clear:hover { background: var(--border); color: var(--text-primary); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（全绿）

- [ ] **Step 3: 提交（需用户明确同意才执行）**

```bash
git add src/renderer/src/components/WelcomeTab.vue
git commit -m "feat: 首页改为艺术字+介绍+快速开会话框+历史会话"
```

---

### Task 5: HomeView 加首页按钮并接通首页创建

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

**Interfaces:**
- Consumes: `tabsStore.openWelcome()`（已有）、`onCreate`（已有）
- Produces: 左侧工具条「首页」按钮；`WelcomeTab` 的 `@create` 绑定改为直接创建会话

- [ ] **Step 1: left-top 加首页按钮**

在 `HomeView.vue` 模板 `!sidebarCollapsed && !searchOpen` 分支内，Windows 品牌字 `brand-inline` 之后、「打开 Session」按钮之前插入：

```html
<button class="top-btn tooltip-wrap" aria-label="首页" title="首页" @click="tabsStore.openWelcome()">
  <Icon name="house" :size="16" />
  <span class="tooltip-down">首页</span>
</button>
```

- [ ] **Step 2: 改 WelcomeTab 的 create 绑定**

模板中 WelcomeTab 使用处：

```html
<WelcomeTab
  @create="showOpenFolder = true"
  @guide="openGuideTab"
  @open-recent="onOpenRecent"
/>
```

改为：

```html
<WelcomeTab
  @create="onCreateFromHome"
  @guide="openGuideTab"
  @open-recent="onOpenRecent"
/>
```

- [ ] **Step 3: 加 onCreateFromHome 方法**

在 `<script setup>` 中 `onCreate` 函数之后新增：

```ts
async function onCreateFromHome(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string, agent?: string) {
  await onCreate(workdir, prompt, extraArgs, botId, agent)
}
```

- [ ] **Step 4: 移除 OpenFolderDialog 死代码**

首页快速框已内置目录选择，`WelcomeTab` 不再触发 `OpenFolderDialog`，其原唯一入口已消失，删除死代码：

- 移除模板 `<OpenFolderDialog :open="showOpenFolder" ... />` 整块。
- 移除 script 中：
  - `import OpenFolderDialog from '../components/OpenFolderDialog.vue'`
  - `const showOpenFolder = ref(false)`
  - `async function onCreateFromFolder(...) {...}`
- 完成后 `showOpenFolder` / `onCreateFromFolder` / `OpenFolderDialog` 应无任何引用（`vue-tsc` 通过即为清理干净）。

- [ ] **Step 5: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（全绿）

- [ ] **Step 6: 提交（需用户明确同意才执行）**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "feat: 会话列表上方加首页按钮，首页快速框直达创建会话"
```

---

### Task 6: 全量验证

**Files:**
- 无代码改动，纯验证

- [ ] **Step 1: 主进程测试**

Run: `npm run test:main`
Expected: 全部通过（含新增 `workdir.test.ts`）

- [ ] **Step 2: 前端类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: 手动冒烟（可选，需 dev 环境）**

`npm run dev` 后验证：
1. 左侧工具条出现「首页」按钮，点击后内容区显示首页、顶部 tab 栏无「首页」tab。
2. 快速框选 agent → 输入提示词 →（可选选目录 / bot）→ 发送 → 打开会话 tab。
3. 未选目录时发送，确认会话在用户主目录创建成功。
4. 历史会话区显示约 10 条 + 搜索可用。
