# 三段式布局实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Lynel Desktop 从两栏布局改为左中右三栏，Trace 从独立标签页变为右侧常驻缩略图 + 覆盖层展开

**Architecture:** 新增 TraceSidebar 和 TraceOverlay 两个组件；修改 HomeView 为三栏 flex 布局；清理旧 trace tab 相关代码。trace store (Pinia) 和主进程 IPC 不动。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia、CSS flex / `clamp()`、`@lucide/vue` (via `Icon.vue`)

## Global Constraints

- 所有响应/注释用简体中文
- 样式用 `styles/theme.css` 的 CSS 变量，不要硬编码颜色
- 图标统一用 `@lucide/vue`，通过 `components/Icon.vue` 引用
- 提交前必须 `cd src/renderer && npx vue-tsc --noEmit` 全绿
- 每次 commit 前在仓库设置 local git identity
- trace store（`stores/trace.ts`）和主进程 IPC handler 不修改

---

### Task 1: 创建 TraceSidebar.vue — 右侧缩略图列

**Files:**
- Create: `src/renderer/src/components/trace/TraceSidebar.vue`

**Interfaces:**
- Consumes: `useTraceStore()` from `../../stores/trace` — `filteredRequests`, `stats`, `selectedSeq`, `loading`, `select(seq)`, `load()`
- Produces: `@select(seq: number)` event — 点击缩略图时触发，由 HomeView 控制 overlay 开关

- [ ] **Step 1: 编写 TraceSidebar.vue 完整组件**

```vue
<template>
  <aside class="trace-sidebar">
    <!-- StatsBar -->
    <div class="stats-bar">
      <span class="stat-count">{{ filteredRequests.length }} calls</span>
      <span class="stat-cost">${{ totalCost }}</span>
      <button class="stat-reload" title="重新加载" @click="trace.load()">
        <Icon name="refresh-cw" :size="12" />
      </button>
    </div>

    <!-- Error state -->
    <div v-if="error" class="state error">
      <span>加载失败</span>
      <button @click="trace.load()">重试</button>
    </div>

    <!-- Loading skeleton -->
    <template v-else-if="trace.loading && !filteredRequests.length">
      <div v-for="i in 4" :key="i" class="skeleton-row">
        <div class="skeleton-line w-40" />
        <div class="skeleton-line w-70" />
      </div>
    </template>

    <!-- Request list -->
    <template v-else-if="filteredRequests.length">
      <div
        v-for="r in filteredRequests"
        :key="r.seq"
        class="thumb-row"
        :class="{ selected: r.seq === trace.selectedSeq }"
        @click="$emit('select', r.seq)"
      >
        <div class="row-top">
          <span class="status-dot" :class="statusClass(r)" />
          <span class="seq">#{{ r.seq }}</span>
          <span class="model">{{ modelShort(r.model) }}</span>
        </div>
        <div class="row-bottom">
          <span class="meta">{{ formatMs(r.latencyMs) }}</span>
          <span class="meta cost">${{ r.cost.usd.toFixed(5) }}</span>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="state empty">
      <span>暂无 API 请求</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import { useTraceStore } from '../../stores/trace'
import type { TraceSummary } from '../../stores/trace'

defineEmits<{ (e: 'select', seq: number): void }>()

const trace = useTraceStore()

const filteredRequests = computed(() => trace.filteredRequests)

const error = computed(() => false) // 暂由 trace store 内部处理

const totalCost = computed(() => {
  let sum = 0
  for (const r of filteredRequests.value) sum += r.cost.usd
  return sum.toFixed(4)
})

function statusClass(r: TraceSummary): string {
  if (r.error) return 'error'
  if (r.status >= 500) return 'error'
  if (r.status >= 400) return 'warn'
  return 'ok'
}

function modelShort(model: string | null): string {
  if (!model) return '—'
  // claude-sonnet-4-20250514 → sonnet
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('opus')) return 'opus'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-').slice(0, 2).join('-')
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}
</script>

<style scoped>
.trace-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
}
.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  flex-shrink: 0;
}
.stat-count { color: var(--text-secondary); font-weight: 600; }
.stat-cost { color: var(--accent); font-family: var(--font-mono); font-size: 10px; margin-left: auto; }
.stat-reload {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); color: var(--text-tertiary); background: transparent; border: none; cursor: pointer;
}
.stat-reload:hover { background: var(--bg-input); color: var(--text-primary); }

.state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; font-size: 12px; color: var(--text-tertiary); padding: 16px;
}
.state.error { color: var(--status-error); }
.state.error button { color: var(--accent); background: transparent; border: none; cursor: pointer; font-size: 12px; }

.thumb-row {
  padding: 6px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 100ms, border-color 100ms;
}
.thumb-row:hover { background: var(--session-item-hover-bg); }
.thumb-row.selected {
  background: var(--accent-soft-bg);
  border-left-color: var(--accent);
}
.row-top { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.row-bottom { display: flex; align-items: center; gap: 8px; margin-top: 1px; padding-left: 14px; }
.meta { font-size: 10px; color: var(--text-tertiary); }
.meta.cost { font-family: var(--font-mono); }

.status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.status-dot.ok { background: var(--status-success); }
.status-dot.warn { background: var(--status-warn); }
.status-dot.error { background: var(--status-error); }

.seq { color: var(--accent); font-family: var(--font-mono); font-weight: 600; }
.model { color: var(--text-secondary); font-size: 11px; }

.skeleton-row { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.skeleton-line { height: 10px; border-radius: 3px; background: var(--border); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-70 { width: 70%; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
</style>
```

- [ ] **Step 2: 验证类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/trace/TraceSidebar.vue
git -c user.name=walleliu1016 -c user.email=walleliu1016@users.noreply.github.com commit -m "feat: 新增 TraceSidebar 右侧缩略图列组件"
```

---

### Task 2: 创建 TraceOverlay.vue — 覆盖层

**Files:**
- Create: `src/renderer/src/components/trace/TraceOverlay.vue`

**Interfaces:**
- Consumes: `detail` / `diffResult` / `loading` from `useTraceStore()`
- Consumes: `@close` event from parent (HomeView)
- Produces: `RequestDetailPane` 复用（已存在，无需修改）

- [ ] **Step 1: 编写 TraceOverlay.vue 完整组件**

```vue
<template>
  <Teleport to=".center">
    <div class="trace-overlay" @click.self="$emit('close')">
      <!-- Backdrop -->
      <div class="backdrop" @click="$emit('close')" />
      <!-- Panel -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title" v-if="trace.detail">
            #{{ trace.detail.seq }} · {{ trace.detail.model || '—' }}
          </span>
          <span class="panel-title" v-else>Trace 详情</span>
          <button class="panel-close" @click="$emit('close')" title="关闭 (Esc)">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <div class="panel-body">
          <RequestDetailPane
            :detail="trace.detail"
            :diff-result="trace.diffResult"
            :loading="trace.loading"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useTraceStore } from '../../stores/trace'
import RequestDetailPane from './RequestDetailPane.vue'
import Icon from '../Icon.vue'

defineEmits<{ (e: 'close'): void }>()

const trace = useTraceStore()
</script>

<style scoped>
.trace-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}
.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  animation: fadeIn 150ms ease;
}
.panel {
  position: relative;
  z-index: 1;
  width: clamp(360px, 35%, 45%);
  max-width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-strong);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12);
  animation: slideIn 200ms ease;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.panel-close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.panel-close:hover { background: var(--status-error-soft); color: var(--status-error); }
.panel-body { flex: 1; min-height: 0; overflow: hidden; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
</style>
```

- [ ] **Step 2: 验证类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/trace/TraceOverlay.vue
git -c user.name=walleliu1016 -c user.email=walleliu1016@users.noreply.github.com commit -m "feat: 新增 TraceOverlay 覆盖层组件"
```

---

### Task 3: 修改 HomeView.vue — 三栏布局 + 集成 TraceSidebar/TraceOverlay

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

- [ ] **Step 1: 修改 template 为三栏布局**

将 template 从两栏改为三栏，添加 TraceSidebar 和 TraceOverlay（移除 TraceTab 相关渲染）：

```vue
<div class="home">
    <TitleBar :username="username" show-guide @settings="openSettingsTab" @guide="openGuideTab" />
    <div class="layout">
      <aside class="left" :class="{ collapsed: sidebarCollapsed }">
        <SessionList ... />
      </aside>
      <div class="center">
        <GlobalTabs ... />
        <div class="content">
          <!-- welcome -->
          <div v-show="tabsStore.activeType === 'welcome'" class="content-pane">
            <WelcomeTab ... />
          </div>
          <!-- session -->
          <div v-show="tabsStore.activeType === 'session'" class="content-pane session-content">
            <template v-if="sessionTabs.length > 0">
              <SessionTabContent
                v-for="tab in sessionTabs"
                :key="tab.payload?.sessionId as string"
                v-show="activeSessionId === tab.payload?.sessionId"
                :session-id="tab.payload?.sessionId as string"
                :workdir="tab.payload?.workdir as string"
                :visible="activeSessionId === tab.payload?.sessionId"
              />
            </template>
            <div v-else class="empty"><div class="empty-text">未选择会话</div></div>
            <!-- Trace overlay (only when session active and overlay open) -->
            <TraceOverlay
              v-if="activeSessionId && showTraceOverlay"
              @close="closeTraceOverlay"
            />
          </div>
          <!-- settings -->
          <div v-show="tabsStore.activeType === 'settings'" class="content-pane">
            <SettingsTab />
          </div>
          <!-- guide -->
          <div v-show="tabsStore.activeType === 'guide'" class="content-pane">
            <GuideTab />
          </div>
        </div>
      </div>
      <!-- Right sidebar: visible only when session is active -->
      <TraceSidebar
        v-if="activeSessionId"
        @select="onTraceSelect"
      />
    </div>
    <!-- Dialogs -->
    ...
  </div>
```

完整 template 替换现有 HomeView 的 template。注意：
- 保留所有 dialog（OpenFolderDialog、NewSessionDialog）
- 保留 GlobalTabs，但移除 trace 类型的处理（它不会再有 trace tab）
- `.layout` 改为三栏 flex

- [ ] **Step 2: 修改 script 部分**

更新 imports 和 setup 逻辑：

```vue
<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import GlobalTabs from '../components/GlobalTabs.vue'
import SessionList from '../components/SessionList.vue'
// 不再导入 TraceTab
import TraceSidebar from '../components/trace/TraceSidebar.vue'
import TraceOverlay from '../components/trace/TraceOverlay.vue'
import WelcomeTab from '../components/WelcomeTab.vue'
import SessionTabContent from '../components/SessionTabContent.vue'
import SettingsTab from '../components/SettingsTab.vue'
import GuideTab from '../components/GuideTab.vue'
import OpenFolderDialog from '../components/OpenFolderDialog.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import { useTraceStore } from '../stores/trace'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import { GetAppInfo, AdoptSession, OpenSessionTerminal, CloseSession } from '../composables/useElectron'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
const tabsStore = useTabsStore()
const trace = useTraceStore()
useEventStream()

const showOpenFolder = ref(false)
const showNewSession = ref(false)
const username = ref('')
const sidebarCollapsed = ref(false)
const showTraceOverlay = ref(false)

const activeTab = computed(() => tabsStore.activeTab)
const activeSessionId = computed(() => {
  if (activeTab.value?.type !== 'session') return null
  return (activeTab.value.payload?.sessionId as string) ?? null
})
const activeSessionWorkdir = computed(() => {
  if (activeTab.value?.type !== 'session') return ''
  return (activeTab.value.payload?.workdir as string) ?? ''
})
const sessionTabs = computed(() => tabsStore.tabs.filter((t) => t.type === 'session'))
// 移除 traceTabs、activeTraceId

// 切 session 时关闭 overlay
watch(activeSessionId, () => {
  showTraceOverlay.value = false
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
    state === 'running_tool'
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
    sessions.remove(sid)
  }

  tabsStore.close(id)
  // 如果关闭的是活跃 session，关闭 overlay
  showTraceOverlay.value = false
}

async function onSelectSession(id: string) {
  const meta = sessions.list.find((s) => s.id === id)
  if (!meta) return
  tabsStore.openSession(id, meta.workdir, sessionDisplayTitle(meta))
  void sessions.select(id)
  // trace store 由 TraceSidebar 内部自动加载（通过 setup 中的 onMounted）
  trace.setSession(meta.workdir, id)
  trace.load()
  showTraceOverlay.value = false
}

function onTraceSelect(seq: number) {
  if (showTraceOverlay.value && trace.selectedSeq === seq) {
    // 点击已选中的行 → 关闭
    showTraceOverlay.value = false
  } else {
    trace.select(seq)
    showTraceOverlay.value = true
  }
}

function closeTraceOverlay() {
  showTraceOverlay.value = false
}

/* 保留 onCreateFromFolder, onCreateFromSession, onOpenRecent, openSettingsTab, openGuideTab 不变 */
/* 保留 session title watch 不变 */
</script>
```

- [ ] **Step 3: 修改 style 部分**

添加 `.center` 容器样式，调整 `.layout`：

```css
.home { display: flex; flex-direction: column; height: 100vh; }
.layout { flex: 1; display: flex; min-height: 0; gap: 1px; background: var(--border); }
.left {
  width: 280px; display: flex; flex-direction: column;
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  min-height: 0; overflow: hidden;
  z-index: 1;
  transition: width 0.2s ease;
}
.left.collapsed { width: 44px; }

/* 中间面板 — 新容器 */
.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.content-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
/* session content 需要 position: relative 给 overlay 定位 */
.session-content { position: relative; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-text { color: var(--text-tertiary); font-size: 12px; }
```

- [ ] **Step 4: 验证类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/views/HomeView.vue
git -c user.name=walleliu1016 -c user.email=walleliu1016@users.noreply.github.com commit -m "refactor: HomeView 改为三栏布局，集成 TraceSidebar/TraceOverlay"
```

---

### Task 4: 清理旧 Trace Tab 代码

**Files:**
- Modify: `src/renderer/src/types/tab.ts`
- Modify: `src/renderer/src/stores/tabs.ts`
- Modify: `src/renderer/src/components/SessionItem.vue`
- Modify: `src/renderer/src/components/SessionList.vue`

- [ ] **Step 1: 修改 types/tab.ts — 移除 trace 类型**

```typescript
export type TabType = 'welcome' | 'session' | 'settings' | 'guide'

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

// 移除 TraceTabPayload
```

- [ ] **Step 2: 修改 stores/tabs.ts — 移除 openTrace**

移除 `openTrace` 方法和 `generateTabId` 中的 trace 分支：

```typescript
function generateTabId(type: TabType, payload?: Record<string, unknown>): string {
  if (type === 'session' && payload?.sessionId) {
    return `session-${payload.sessionId}`
  }
  return type
}

// 移除 openTrace 方法：
// function openTrace(...) { ... }  ← 整块删除
```

- [ ] **Step 3: 修改 SessionItem.vue — 移除右键菜单中的 "打开 Trace"**

从 template 中移除：
```vue
<button class="menu-item" @click="openTrace">打开 Trace</button>
```

从 script 中移除 `openTrace` 函数和 `emit('open-trace')`。

同时移除 emit 声明中的 `'open-trace'`：
```typescript
const emit = defineEmits<{ (e: 'select'): void }>()
// 从: defineEmits<{ (e: 'select'): void; (e: 'open-trace'): void }>()
```

- [ ] **Step 4: 修改 SessionList.vue — 移除 open-trace**

移除 `@open-trace` emit 及相关处理：
- template 中 `@open-trace="emit('open-trace', s)"` → 删除
- emit 声明中移除 `'open-trace'`
- props 中移除 `'open-trace'` 相关类型

```typescript
const emit = defineEmits<{
  (e: 'create'): void
  (e: 'select', id: string): void
  (e: 'toggle-collapse'): void
}>()
```

- [ ] **Step 5: 验证类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/types/tab.ts src/renderer/src/stores/tabs.ts src/renderer/src/components/SessionItem.vue src/renderer/src/components/SessionList.vue
git -c user.name=walleliu1016 -c user.email=walleliu1016@users.noreply.github.com commit -m "refactor: 移除 Trace 独立标签页相关代码"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 完整构建检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
cd ../.. && npm run dev
```
Expected: 构建无错误，应用正常启动

- [ ] **Step 2: 手动验收清单**

按以下步骤验证每个场景：

- [ ] 启动应用，确认登录/首页正常
- [ ] 打开一个 session，确认三栏布局：
  - 左侧会话列表正常
  - 中间终端正常
  - 右侧出现 Trace 侧栏（显示 "暂无 API 请求"）
- [ ] Session 产生 API 请求后，右侧缩略图正常展示（序号、状态点、模型、耗时、花费）
- [ ] 点击缩略图行 → TraceOverlay 从右滑出，内容区域显示覆盖层
- [ ] 覆盖层宽度随窗口缩放自动变化（clamp 生效）
- [ ] 覆盖层内 tab 切换正常（Overview / Messages / Tools 等）
- [ ] 点击遮罩层 / Escape / × 按钮 → 覆盖层关闭
- [ ] 再次点击同一缩略图 → 覆盖层关闭（toggle）
- [ ] 切换到另一个 session → 覆盖层自动关闭，新 session 的 trace 加载
- [ ] 关闭 session → 右侧栏隐藏
- [ ] 重启应用 → 选中之前 session → trace 数据从磁盘正常加载

- [ ] **Step 3: 提交最终修复（如有）**

如果验收发现问题，修复后提交：
```bash
git add -A
git -c user.name=walleliu1016 -c user.email=walleliu1016@users.noreply.github.com commit -m "fix: 三段式布局验收问题修复"
```
