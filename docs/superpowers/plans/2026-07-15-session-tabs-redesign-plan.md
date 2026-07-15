# 全局 Tab 系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Lynel Desktop 从「页面跳转 + HomeView 内局部 Tab」改造为「全局 Tab 系统」，使 session、设置、未来功能都以顶部 Tab 形式打开、切换和关闭。

**Architecture:** 新增 Pinia `tabs` store 统一管理全局 Tab 状态（打开/关闭/激活）；新增 `GlobalTabs` 组件渲染顶部 Tab 栏；`HomeView` 改造为 Tab 宿主，根据当前激活 Tab 类型渲染左侧边栏和右侧内容；保留 `sessions` store 仅负责 session 业务状态。

**Tech Stack:** Vue 3 (script setup), Pinia, Vue Router, TypeScript, `@lucide/vue`, theme.css CSS 变量。

---

## File Map

| 文件 | 责任 |
|------|------|
| `src/renderer/src/stores/tabs.ts` | 新增：全局 Tab 状态管理（tabs 列表、activeId、open/close/activate） |
| `src/renderer/src/types/tab.ts` | 新增：Tab 类型定义 |
| `src/renderer/src/components/GlobalTabs.vue` | 新增：全局 Tab 栏组件（渲染 tabs、active 顶色条、hover tooltip） |
| `src/renderer/src/components/SessionTabs.vue` | 删除或合并到 GlobalTabs（本次计划直接删除，避免重复） |
| `src/renderer/src/views/HomeView.vue` | 改造：移除 ToolBar，接入 GlobalTabs，按 Tab 类型渲染内容与边栏 |
| `src/renderer/src/views/WelcomeView.vue` | 修改：不再独占路由，作为 HomeView 内 welcome Tab 的内容组件 |
| `src/renderer/src/views/SettingsView.vue` | 修改：不再独占路由，作为 HomeView 内 settings Tab 的内容组件 |
| `src/renderer/src/components/TitleBar.vue` | 修改：设置按钮触发 `openSettingsTab()` 而非 `router.push('/settings')` |
| `src/renderer/src/components/SessionList.vue` | 修改：保持现有逻辑，但需在 HomeView 内按 Tab 类型条件渲染 |
| `src/renderer/src/router/index.ts` | 修改：移除 `/settings` 独立路由，所有路由指向 HomeView 并打开对应 Tab |
| `src/renderer/src/App.vue` | 可能无需修改，保持 `<router-view />` |
| `src/renderer/src/composables/useElectron.ts` | 无需修改，已有 `CloseSession` |

---

## Task 1: 定义 Tab 类型与 tabs store

**Files:**
- Create: `src/renderer/src/types/tab.ts`
- Create: `src/renderer/src/stores/tabs.ts`
- Test: `src/renderer/src/stores/__tests__/tabs.test.ts`（若项目无 renderer 测试，可跳过或后续补充）

- [ ] **Step 1: 创建 Tab 类型**

Create `src/renderer/src/types/tab.ts`:

```ts
export type TabType = 'welcome' | 'session' | 'settings'

export interface Tab {
  id: string
  type: TabType
  title: string
  payload?: Record<string, unknown>
}

export interface SessionTabPayload {
  sessionId: string
  workdir: string
}
```

- [ ] **Step 2: 创建 tabs store**

Create `src/renderer/src/stores/tabs.ts`:

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Tab, TabType, SessionTabPayload } from '../types/tab'

function generateTabId(type: TabType, payload?: Record<string, unknown>): string {
  if (type === 'session' && payload?.sessionId) {
    return `session-${payload.sessionId}`
  }
  return type
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([{ id: 'welcome', type: 'welcome', title: '首页' }])
  const activeId = ref<string>('welcome')

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)
  const activeType = computed(() => activeTab.value?.type ?? 'welcome')

  function activate(id: string) {
    if (tabs.value.some((t) => t.id === id)) {
      activeId.value = id
    }
  }

  function open(tab: Omit<Tab, 'id'>) {
    const id = generateTabId(tab.type, tab.payload)
    const existing = tabs.value.find((t) => t.id === id)
    if (existing) {
      activeId.value = existing.id
      return existing.id
    }
    const newTab: Tab = { ...tab, id }
    tabs.value = [...tabs.value, newTab]
    activeId.value = id
    return id
  }

  function openWelcome() {
    return open({ id: 'unused', type: 'welcome', title: '首页' })
  }

  function openSession(sessionId: string, workdir: string, title?: string) {
    return open({
      type: 'session',
      title: title ?? sessionId.slice(0, 8),
      payload: { sessionId, workdir },
    })
  }

  function openSettings() {
    return open({ type: 'settings', title: '设置' })
  }

  function close(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    const wasActive = activeId.value === id
    tabs.value = tabs.value.filter((t) => t.id !== id)

    if (tabs.value.length === 0) {
      openWelcome()
      return
    }

    if (wasActive) {
      const next = tabs.value[idx] || tabs.value[idx - 1] || tabs.value[0]
      activeId.value = next.id
    }
  }

  function updateTitle(id: string, title: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) {
      tab.title = title
    }
  }

  return {
    tabs,
    activeId,
    activeTab,
    activeType,
    activate,
    open,
    openWelcome,
    openSession,
    openSettings,
    close,
    updateTitle,
  }
})
```

- [ ] **Step 3: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

---

## Task 2: 创建 GlobalTabs 组件

**Files:**
- Create: `src/renderer/src/components/GlobalTabs.vue`
- Modify: `src/renderer/src/components/Icon.vue`（如需要新增图标）

- [ ] **Step 1: 创建 GlobalTabs.vue**

Create `src/renderer/src/components/GlobalTabs.vue`:

```vue
<template>
  <div class="global-tabs">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === activeId }"
        @click="$emit('select', tab.id)"
        @mousedown="onMouseDown($event, tab.id)"
        @mouseenter="hoverId = tab.id"
        @mouseleave="hoverId = null"
      >
        <span class="tab-icon">
          <Icon v-if="tab.type === 'welcome'" name="bot" :size="12" />
          <Icon v-else-if="tab.type === 'settings'" name="settings" :size="12" />
          <Icon v-else-if="isRunning(tab.id)" name="loader" :size="12" class="spin" />
          <Icon v-else-if="isAwaitingPermission(tab.id)" name="shield-alert" :size="12" />
          <Icon v-else name="terminal" :size="12" />
        </span>
        <span class="tab-title" :title="tooltipFor(tab)">{{ tab.title }}</span>
        <span
          v-if="showClose(tab.id)"
          class="tab-close"
          @click.stop="$emit('close', tab.id)"
        >
          <Icon name="close" :size="12" />
        </span>
      </div>
    </div>
    <button class="tab-new" @click="$emit('create')">
      <Icon name="plus" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import { useSessionsStore } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import type { Tab } from '../types/tab'

const props = defineProps<{
  tabs: Tab[]
  activeId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  create: []
}>()

const sessions = useSessionsStore()
const tabsStore = useTabsStore()
const hoverId = ref<string | null>(null)

function isRunning(tabId: string) {
  if (!tabId.startsWith('session-')) return false
  const sid = tabId.slice(8)
  const state = sessions.state[sid]
  return state === 'waiting' || state === 'thinking' || state === 'streaming' || state === 'running_tool'
}

function isAwaitingPermission(tabId: string) {
  if (!tabId.startsWith('session-')) return false
  const sid = tabId.slice(8)
  return sessions.state[sid] === 'awaiting_permission'
}

function tooltipFor(tab: Tab) {
  if (tab.type !== 'session') return tab.title
  const sid = tab.payload?.sessionId as string
  const meta = sessions.list.find((s) => s.id === sid)
  const state = sessions.state[sid] || 'idle'
  return [
    meta?.ai_title || meta?.first_prompt || sid.slice(0, 8),
    `项目：${meta?.project || meta?.workdir || '未知'}`,
    `Session：${sid}`,
    `状态：${state}`,
  ].join('\n')
}

function showClose(id: string) {
  return id === props.activeId || hoverId.value === id
}

function onMouseDown(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    emit('close', id)
  }
}
</script>

<style scoped>
.global-tabs {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-strong);
  user-select: none;
  padding: 0 8px;
  gap: 2px;
}

.tabs-scroll {
  flex: 1;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tabs-scroll::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  max-width: 180px;
  min-width: 80px;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  position: relative;
  transition: background 0.12s, border-color 0.12s;
}

.tab:hover {
  background: var(--session-item-hover-bg);
}

.tab.active {
  background: var(--bg-terminal);
  color: var(--text-primary);
  border-color: var(--border-strong);
  border-bottom: 1px solid var(--bg-terminal);
  margin-bottom: -1px;
  z-index: 1;
}

.tab.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 8px 8px 0 0;
}

.tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.tab.active .tab-icon {
  color: var(--accent);
}

.tab-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}

.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 0.7;
}

.tab-close:hover {
  background: var(--status-error-soft);
  color: var(--status-error);
}

.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 2px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.tab-new:hover {
  background: var(--session-item-hover-bg);
  color: var(--text-primary);
}

.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
```

- [ ] **Step 2: 确保 Icon.vue 包含所需图标**

Verify `src/renderer/src/components/Icon.vue` exports: `loader`, `terminal`, `shield-alert`, `close`, `plus`, `bot`, `settings`.
If missing, add them.

- [ ] **Step 3: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

---

## Task 3: 改造 HomeView 为 Tab 宿主

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`
- Delete: `src/renderer/src/components/SessionTabs.vue`（若存在）
- Delete: `src/renderer/src/components/ToolBar.vue`（从 HomeView 移除引用，文件可保留若他处使用）

- [ ] **Step 1: 重构 HomeView 模板结构**

Modify `src/renderer/src/views/HomeView.vue` template to:

```vue
<template>
  <div class="home">
    <TitleBar :username="username" @settings="openSettingsTab" />
    <GlobalTabs
      :tabs="tabsStore.tabs"
      :active-id="tabsStore.activeId"
      @select="onSelectTab"
      @close="onCloseTab"
      @create="onCreateTab"
    />
    <div class="layout">
      <aside class="left">
        <WelcomeSidebar v-if="tabsStore.activeType === 'welcome'" @open-recent="onOpenRecent" @create="showNew = true" />
        <SessionList
          v-else-if="tabsStore.activeType === 'session'"
          :list="sessions.list"
          :active-id="activeSessionId"
          @create="showNew = true"
          @select="onSelectSession"
        />
        <SettingsSidebar v-else-if="tabsStore.activeType === 'settings'" />
      </aside>
      <main class="right">
        <WelcomeView v-if="tabsStore.activeType === 'welcome'" @create="showNew = true" @open-recent="onOpenRecent" />
        <SessionTabContent
          v-else-if="tabsStore.activeType === 'session'"
          :session-id="activeSessionId"
          :workdir="activeSessionWorkdir"
        />
        <SettingsView v-else-if="tabsStore.activeType === 'settings'" />
        <div v-else class="empty">未知页面</div>
      </main>
    </div>
    <NewSessionDialog
      :open="showNew"
      :loading="sessions.creating"
      @close="showNew = false"
      @create="onCreate"
      @open-recent="onOpenRecent"
    />
  </div>
</template>
```

- [ ] **Step 2: 引入 tabs store 并替换原有逻辑**

Modify `src/renderer/src/views/HomeView.vue` script:

```ts
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import GlobalTabs from '../components/GlobalTabs.vue'
import SessionList from '../components/SessionList.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import { useSessionsStore } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import {
  WriteTerminalInput,
  GetAppInfo,
  AdoptSession,
  OpenSessionTerminal,
  CloseSession,
} from '../composables/useElectron'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
const tabsStore = useTabsStore()
useEventStream()

const showNew = ref(false)
const username = ref('')

const activeTab = computed(() => tabsStore.activeTab)
const activeSessionId = computed(() => {
  if (activeTab.value?.type !== 'session') return null
  return (activeTab.value.payload?.sessionId as string) ?? null
})
const activeSessionWorkdir = computed(() => {
  if (activeTab.value?.type !== 'session') return ''
  return (activeTab.value.payload?.workdir as string) ?? ''
})

onMounted(async () => {
  try {
    const info = await GetAppInfo()
    username.value = info.username
  } catch {}
})

function onSelectTab(id: string) {
  tabsStore.activate(id)
}

function onCreateTab() {
  tabsStore.openWelcome()
}

function isRunningState(state: SessionState) {
  return (
    state === 'waiting' ||
    state === 'thinking' ||
    state === 'streaming' ||
    state === 'running_tool' ||
    state === 'awaiting_permission'
  )
}

async function onCloseTab(id: string) {
  const tab = tabsStore.tabs.find((t) => t.id === id)
  if (!tab) return

  if (tab.type === 'session') {
    const sid = tab.payload?.sessionId as string
    const state = sessions.state[sid] || 'idle'
    if (isRunningState(state)) {
      const ok = window.confirm('该会话仍在运行中，关闭将终止 Claude，是否继续？')
      if (!ok) return
    }
    try {
      await CloseSession(sid)
    } catch (e: any) {
      console.error('[home] close session failed:', e?.message || e)
    }
  }

  tabsStore.close(id)
}

async function onSelectSession(id: string) {
  const meta = sessions.list.find((s) => s.id === id)
  if (!meta) return
  tabsStore.openSession(id, meta.workdir, meta.ai_title || meta.first_prompt)
  await sessions.select(id)
}

async function onCreate(workdir: string, prompt: string, extraArgs: string[] = []) {
  try {
    const id = await sessions.create(workdir, prompt, extraArgs)
    const meta = sessions.list.find((s) => s.id === id)
    if (meta) {
      tabsStore.openSession(id, meta.workdir, meta.ai_title || meta.first_prompt || prompt)
    }
    showNew.value = false
  } catch (e: any) {
    alert('创建失败：' + (e?.message ?? e))
  }
}

async function onOpenRecent(item: RecentSession) {
  try {
    sessions.open(item)
    tabsStore.openSession(item.sessionId, item.workdir, item.aiTitle || item.firstPrompt)
    await AdoptSession(item.sessionId, item.workdir)
    await OpenSessionTerminal(item.sessionId, item.workdir)
    showNew.value = false
  } catch (e: any) {
    console.error('[home] open recent failed:', e?.message || e)
    alert('打开最近会话失败：' + (e?.message || e))
  }
}

function openSettingsTab() {
  tabsStore.openSettings()
}

// Watch session list to update tab titles when ai_title/first_prompt loads
watch(
  () => sessions.list.map((s) => `${s.id}:${s.ai_title}:${s.first_prompt}`).join('|'),
  () => {
    for (const s of sessions.list) {
      const tabId = `session-${s.id}`
      const tab = tabsStore.tabs.find((t) => t.id === tabId)
      if (tab) {
        const newTitle = s.ai_title || s.first_prompt || s.id.slice(0, 8)
        if (tab.title !== newTitle) {
          tab.title = newTitle
        }
      }
    }
  }
)
```

- [ ] **Step 3: 删除 SessionTabs.vue 和 ToolBar 引用**

Remove imports of `ToolBar` and `SessionTabs` from HomeView.
Delete `src/renderer/src/components/SessionTabs.vue` if it exists from earlier iteration.

- [ ] **Step 4: 更新 HomeView 样式**

Ensure `.home` still uses `flex-direction: column; height: 100vh;` and `.layout` flexes correctly.
Remove `.toolbar` related styles if any.

- [ ] **Step 5: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS (may reveal missing WelcomeSidebar/SettingsSidebar/SessionTabContent components — handle in Task 4)

---

## Task 4: 拆分 Tab 内容组件

**Files:**
- Create: `src/renderer/src/components/SessionTabContent.vue`
- Create: `src/renderer/src/components/WelcomeSidebar.vue`
- Create: `src/renderer/src/components/SettingsSidebar.vue`
- Modify: `src/renderer/src/views/WelcomeView.vue`
- Modify: `src/renderer/src/views/SettingsView.vue`

- [ ] **Step 1: 创建 SessionTabContent.vue**

This component replaces the inline terminal area from old HomeView.

Create `src/renderer/src/components/SessionTabContent.vue`:

```vue
<template>
  <div class="session-tab-content">
    <div v-if="loading" class="terminal-area-loading">
      <div class="spinner" />
      <div class="loading-text">正在启动 Claude 会话…</div>
    </div>
    <XtermTerminal
      :session-id="sessionId"
      :workdir="workdir"
      :visible="true"
      @starting="loading = true"
      @ready="loading = false"
      @data="onTerminalData"
    />
    <PermissionToast
      :tool-name="permissionToastName"
      :tool-input="permissionToolInput"
      :session-id="sessionId"
      :request-id="permissionRequestId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import XtermTerminal from './XtermTerminal.vue'
import PermissionToast from './PermissionToast.vue'
import { useSessionsStore } from '../stores/sessions'
import { WriteTerminalInput } from '../composables/useElectron'

const props = defineProps<{
  sessionId: string
  workdir: string
}>()

const sessions = useSessionsStore()
const loading = ref(false)

const permissionToastName = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.toolName || ''
})

const permissionRequestId = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.requestId || ''
})

const permissionToolInput = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.toolInput as Record<string, unknown> | undefined
})

async function onTerminalData(data: string) {
  try {
    await WriteTerminalInput(props.sessionId, data)
  } catch (e: any) {
    console.error('[terminal] write failed:', e?.message)
  }
}
</script>

<style scoped>
.session-tab-content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-terminal);
  padding-left: 8px;
  border-left: 1px solid var(--border-strong, var(--border));
}
.terminal-area-loading {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  background: var(--bg-terminal-loading);
  pointer-events: none;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.loading-text { font-size: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: 创建 WelcomeSidebar.vue**

Create `src/renderer/src/components/WelcomeSidebar.vue`:

```vue
<template>
  <div class="welcome-sidebar">
    <button class="new-btn" @click="$emit('create')">+ 打开 Session</button>
    <div class="section-title">最近会话</div>
    <!-- Can list recent sessions here if needed; for now minimal -->
  </div>
</template>

<script setup lang="ts">
defineEmits<{ (e: 'create'): void; (e: 'open-recent', item: any): void }>()
</script>

<style scoped>
.welcome-sidebar {
  display: flex;
  flex-direction: column;
  padding: 16px;
}
.new-btn {
  background: var(--accent);
  color: white;
  border: none;
  padding: 10px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 16px;
  cursor: pointer;
}
.section-title {
  font-size: 11px;
  color: var(--text-tertiary);
  padding-left: 4px;
}
</style>
```

- [ ] **Step 3: 创建 SettingsSidebar.vue**

Create `src/renderer/src/components/SettingsSidebar.vue`:

```vue
<template>
  <div class="settings-sidebar">
    <div class="section-title">设置</div>
    <!-- Future: settings categories -->
  </div>
</template>

<style scoped>
.settings-sidebar {
  padding: 16px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
```

- [ ] **Step 4: 调整 WelcomeView / SettingsView**

If `WelcomeView.vue` currently calls `router.push('/home')` after creating/opening session, update it to emit events that HomeView handles via tabs store.

Modify `src/renderer/src/views/WelcomeView.vue` to emit `@create` and `@open-recent` instead of router navigation.

`SettingsView.vue` likely doesn't need changes if it's already a self-contained view.

- [ ] **Step 5: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

---

## Task 5: 调整路由与导航

**Files:**
- Modify: `src/renderer/src/router/index.ts`
- Modify: `src/renderer/src/components/TitleBar.vue`

- [ ] **Step 1: 简化路由表**

Modify `src/renderer/src/router/index.ts`:

```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', name: 'home', component: HomeView },
    // Settings and welcome are now tabs inside HomeView
  ],
})

export default router
```

- [ ] **Step 2: 修改 TitleBar 设置按钮**

Modify `src/renderer/src/components/TitleBar.vue`:

Replace `@click="$emit('settings')"` with the existing emit; HomeView will handle it by calling `tabsStore.openSettings()`.

If TitleBar currently does `router.push('/settings')` directly, change to emit `settings` event.

- [ ] **Step 3: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

---

## Task 6: 移除旧代码与清理

**Files:**
- Delete: `src/renderer/src/components/SessionTabs.vue`
- Optionally delete: `src/renderer/src/components/ToolBar.vue` if no longer used anywhere

- [ ] **Step 1: 删除 SessionTabs.vue**

Run: `rm src/renderer/src/components/SessionTabs.vue`

- [ ] **Step 2: 检查 ToolBar.vue 是否还有其他引用**

Run: `rg "ToolBar" src/renderer/src`
If only HomeView imported it, delete `src/renderer/src/components/ToolBar.vue`.

- [ ] **Step 3: 运行 renderer 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

---

## Task 7: 验证与测试

- [ ] **Step 1: 运行前端类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 运行主进程测试**

Run: `npm run test:main`
Expected: 21/21 PASS

- [ ] **Step 3: 启动开发模式进行人工验证**

Run: `npm run dev`
Verify:
- 启动后默认显示 welcome Tab
- 点击「打开 Session」新建 session 会打开新 Tab
- Tab 有圆角和 active 顶色条
- 点击设置按钮打开 settings Tab，不跳转页面
- 中键/点击 × 可关闭 Tab
- 关闭运行中 session 有确认弹窗
- hover session Tab 显示详情 Tooltip

---

## Self-Review Checklist

- [ ] Spec coverage: 全局 Tab、session/settings/welcome、左侧边栏切换、Tab 样式、关闭行为均已覆盖。
- [ ] Placeholder scan: 无 TBD/TODO，所有步骤含具体代码或命令。
- [ ] Type consistency: `TabType`、`Tab`、payload 字段在 store、GlobalTabs、HomeView 中一致使用。
