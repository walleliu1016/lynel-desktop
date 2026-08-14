# 终端 / Trace 双 tab 与右侧 Workspace 占位 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在会话视图内新增"终端 / Trace"双 tab，把右侧 TraceSidebar 内容移入中间分栏展示，右侧改为可折叠的 Workspace 占位面板。

**Architecture:** 新建 `TracePane.vue`（复用 trace store 与 `RequestDetailPane`，左列表右详情分栏）与 `WorkspacePanel.vue`（占位+折叠）；改造 `HomeView.vue` 的 session pane（加 sub-tabs + v-show 切换终端/Trace）、移除 `TraceSidebar`/`TraceOverlay`。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia、@lucide/vue（经 `components/Icon.vue`）。

## Global Constraints

- 渲染进程**没有可运行的单元测试**（`src/renderer` 的 `test` 脚本是占位符），因此每个任务的验证门禁 = `npx vue-tsc --noEmit` 全绿 + 手动验收；主进程 `npm run test:main` 全程应保持 295 passed（本计划不触及主进程）。
- 图标统一走 `components/Icon.vue`，禁止 emoji / Unicode 符号当图标。
- 样式用 `styles/theme.css` 的 CSS 变量（`--accent`、`--border`、`--status-success` 等），不硬编码颜色。
- 颜色/文案全部简体中文；代码注释中文。
- 每次 commit 前设置 local git identity（`walleliu1016 <walleliu1016@users.noreply.github.com>` 已在仓库内配置，无需重复），commit message 遵循 `<type>: <subject>`。
- 不提交 `layout-preview.html`（临时预览文件，最终删除）。

---

### Task 1: WorkspacePanel 占位组件

**Files:**
- Create: `src/renderer/src/components/WorkspacePanel.vue`

**Interfaces:**
- Produces: 组件 `WorkspacePanel`，props `{ collapsed: boolean }`，emits `(e: 'toggle-collapse'): void`。Task 3 的 HomeView 使用它。

- [ ] **Step 1: 创建 `WorkspacePanel.vue`**

```vue
<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ collapsed: boolean }>()
defineEmits<{ (e: 'toggle-collapse'): void }>()
</script>

<template>
  <aside class="workspace-panel" :class="{ collapsed }">
    <div class="ws-head">
      <span class="ws-title">Workspace</span>
      <button class="collapse-btn" aria-label="收起 Workspace" title="收起 Workspace" @click="$emit('toggle-collapse')">
        <Icon name="panel-right-close" :size="16" />
      </button>
    </div>
    <div class="ws-placeholder">
      <span>Workspace 面板待实现</span>
    </div>
  </aside>
</template>

<style scoped>
.workspace-panel {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
  transition: width 0.2s ease;
}
.workspace-panel.collapsed { width: 0; border-left: none; }
.ws-head {
  height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border);
}
.ws-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.collapse-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: transparent; border: 1px solid var(--border); cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.collapse-btn:hover { background: var(--bg-input); border-color: var(--accent); color: var(--accent); }
.ws-placeholder {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--text-tertiary);
}
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/WorkspacePanel.vue
git commit -m "feat: 右侧 Workspace 占位面板组件（可折叠）"
```

---

### Task 2: TracePane 分栏组件

**Files:**
- Create: `src/renderer/src/components/trace/TracePane.vue`

**Interfaces:**
- Consumes: `useTraceStore()`（`filteredRequests`、`selectedSeq`、`detail`、`diffResult`、`loading`、`loadError`、`hasMore`、`load`、`loadMore`、`select(seq: number)`、`fetchNew`）、`RequestDetailPane`（props `{ detail, diffResult, loading }`）。
- Produces: 组件 `TracePane`，无 props/emits（数据全走 trace store）。Task 3 的 HomeView 在 session pane 内以 `v-show` 挂载它。

- [ ] **Step 1: 创建 `TracePane.vue`（把 `TraceSidebar.vue` 的列表逻辑迁入并加详情分栏）**

```vue
<template>
  <div class="trace-pane">
    <div class="trace-toolbar">
      <span class="head">请求({{ filteredRequests.length }})</span>
      <span class="cost">${{ totalCost }}</span>
      <button class="reload" title="重新加载" @click="reload()">
        <Icon name="refresh-cw" :size="12" />
      </button>
    </div>
    <div class="trace-split">
      <div class="trace-list">
        <!-- Loading skeleton -->
        <template v-if="trace.loading && !filteredRequests.length">
          <div v-for="i in 4" :key="i" class="skeleton-row">
            <div class="skeleton-line w-40" />
            <div class="skeleton-line w-70" />
          </div>
        </template>
        <!-- Error state -->
        <div v-else-if="trace.loadError" class="state error">
          <span>{{ trace.loadError }}</span>
          <button class="retry-btn" @click="reload()">重试</button>
        </div>
        <!-- Request list -->
        <div
          v-else-if="filteredRequests.length"
          class="thumb-list"
          ref="thumbListEl"
          @scroll="onScroll"
        >
          <div
            v-for="r in filteredRequests"
            :key="r.seq"
            class="thumb-row"
            :class="{ selected: r.seq === trace.selectedSeq }"
            @click="trace.select(r.seq)"
          >
            <div class="row-top">
              <span class="status-dot" :class="statusClass(r)" />
              <span class="seq">#{{ r.seq }}</span>
              <span class="model">{{ modelShort(r.model) }}</span>
              <span class="meta time">{{ formatTime(r.ts) }}</span>
            </div>
            <div class="row-bottom">
              <span class="metric" v-if="r.cost.input">
                <Icon name="arrow-down" :size="10" />
                {{ fmtTokens(r.cost.input) }}
              </span>
              <span class="metric" v-if="r.cost.output">
                <Icon name="arrow-up" :size="10" />
                {{ fmtTokens(r.cost.output) }}
              </span>
              <span class="metric">
                <Icon name="wrench" :size="10" />
                &times;{{ r.toolCount }}
              </span>
              <span class="metric">
                <Icon name="clock" :size="10" />
                {{ formatMs(r.latencyMs) }}
              </span>
            </div>
          </div>
          <div v-if="trace.hasMore" class="load-more-hint">
            <span v-if="trace.loading">加载中...</span>
            <span v-else>向上滚动加载更多</span>
          </div>
        </div>
        <!-- Empty state -->
        <div v-else class="state empty">
          <span>暂无 API 请求</span>
        </div>
      </div>
      <!-- 右：详情分栏 -->
      <div class="trace-detail">
        <RequestDetailPane
          :detail="trace.detail"
          :diff-result="trace.diffResult"
          :loading="trace.loading"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Icon from '../Icon.vue'
import RequestDetailPane from './RequestDetailPane.vue'
import { useTraceStore } from '../../stores/trace'
import type { TraceSummary } from '../../stores/trace'

const trace = useTraceStore()
const thumbListEl = ref<HTMLElement | null>(null)

// 过滤条件变化时重新加载首页
watch(() => [trace.modelFilter, trace.errorsOnly], () => {
  trace.load()
})

// 新请求到达时自动滚动到底部（仅当用户在底部附近时）
watch(() => trace.filteredRequests.length, () => {
  void nextTick(() => {
    const el = thumbListEl.value
    if (!el) return
    const threshold = 50
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      el.scrollTop = el.scrollHeight
    }
  })
})

function reload() {
  trace.requests = []
  trace.load()
}

// 滚动检测：接近顶部时加载更多
function onScroll() {
  const el = thumbListEl.value
  if (!el) return
  if (el.scrollTop < 50 && trace.hasMore && !trace.loading) {
    const prevHeight = el.scrollHeight
    trace.loadMore().then(() => {
      void nextTick(() => {
        if (thumbListEl.value) {
          thumbListEl.value.scrollTop = thumbListEl.value.scrollHeight - prevHeight
        }
      })
    })
  }
}

const filteredRequests = computed(() => trace.filteredRequests)

const totalCost = computed(() => {
  let sum = 0
  for (const r of filteredRequests.value) sum += r.cost.usd
  return sum.toFixed(3)
})

function statusClass(r: TraceSummary): string {
  if (r.error) return 'error'
  if (r.status >= 500) return 'error'
  if (r.status >= 400) return 'warn'
  return 'ok'
}

function modelShort(model: string | null): string {
  if (!model) return '\u2014'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('opus')) return 'opus'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-').slice(0, 2).join('-')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatMs(ms: number | null): string {
  if (ms == null) return '\u2014'
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  return (ms / 60_000).toFixed(1) + 'm'
}

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
</script>

<style scoped>
.trace-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg-panel); }
.trace-toolbar {
  height: 36px; flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.head { color: var(--text-secondary); font-weight: 700; }
.cost { margin-left: auto; color: var(--accent); font-family: var(--font-mono); font-size: 12px; }
.reload {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); color: var(--text-tertiary); background: transparent; border: none; cursor: pointer;
}
.reload:hover { background: var(--bg-input); color: var(--text-primary); }

.trace-split { flex: 1; display: flex; min-height: 0; }
.trace-list {
  width: 46%; max-width: 320px; flex-shrink: 0;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto; padding: 8px 6px;
}
.trace-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }

.state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; font-size: 12px; color: var(--text-tertiary); padding: 16px;
}
.thumb-row {
  border-radius: var(--radius-sm);
  padding: 8px 10px; margin: 0 2px 2px;
  cursor: pointer; transition: background 100ms;
}
.thumb-row:hover { background: var(--session-item-hover-bg); }
.thumb-row.selected { background: var(--accent-soft-bg); }
.row-top { display: flex; align-items: center; gap: 6px; font-size: var(--fs-body-sm); }
.row-bottom { display: flex; align-items: center; gap: 6px; margin-top: 1px; padding-left: 12px; }
.meta { font-size: var(--fs-caption); color: var(--text-tertiary); }
.metric {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
  justify-content: flex-end;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
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
.state.error { color: var(--status-error); font-size: 11px; }
.retry-btn { color: var(--accent); background: transparent; border: none; cursor: pointer; font-size: 12px; margin-top: 4px; }
.load-more-hint { padding: 10px; text-align: center; font-size: 10px; color: var(--text-tertiary); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。若 `trace.requests = []` 报只读，改为在 store 内加 `reload` 或先读 `stores/trace.ts` 确认 `requests` 是否为可写 ref。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/trace/TracePane.vue
git commit -m "feat: TracePane 分栏组件（列表 + 详情就地展示）"
```

---

### Task 3: HomeView 接入双 tab 与 Workspace

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

**Interfaces:**
- Consumes: Task 1 `WorkspacePanel`、Task 2 `TracePane`；复用现有 `SessionTabContent`、`GlobalTabs`、trace store。
- Produces: 改造后的 HomeView 布局。后续 Task 4 只删旧组件文件。

- [ ] **Step 1: 修改 import（删除 TraceSidebar/TraceOverlay，新增 TracePane/WorkspacePanel）**

在 `HomeView.vue` 的 script setup import 区：

删除：
```ts
import TraceSidebar from '../components/trace/TraceSidebar.vue'
import TraceOverlay from '../components/trace/TraceOverlay.vue'
```
新增：
```ts
import TracePane from '../components/trace/TracePane.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
```

- [ ] **Step 2: 替换右侧 `<TraceSidebar>` 为 `<WorkspacePanel>`**

删除 template 末尾的：
```vue
      <!-- Right sidebar: visible only when session is active -->
      <TraceSidebar
        v-if="activeSessionId"
        :collapsed="traceCollapsed"
        @select="onTraceSelect"
        @toggle-collapse="traceCollapsed = !traceCollapsed"
      />
```
替换为：
```vue
      <!-- 右侧 Workspace（占位，可折叠） -->
      <WorkspacePanel
        :collapsed="workspaceCollapsed"
        @toggle-collapse="workspaceCollapsed = !workspaceCollapsed"
      />
```

- [ ] **Step 3: center-top 展开按钮改用 workspaceCollapsed**

删除：
```vue
          <button
            v-if="activeSessionId && traceCollapsed"
            class="top-btn tooltip-wrap"
            aria-label="展开 Trace"
            @click="traceCollapsed = false"
          >
            <Icon name="panel-right-open" :size="16" />
            <span class="tooltip-down">展开 Trace</span>
          </button>
```
替换为：
```vue
          <button
            v-if="workspaceCollapsed"
            class="top-btn tooltip-wrap"
            aria-label="展开 Workspace"
            @click="workspaceCollapsed = false"
          >
            <Icon name="panel-right-open" :size="16" />
            <span class="tooltip-down">展开 Workspace</span>
          </button>
```

- [ ] **Step 4: session pane 加 sub-tabs 与 终端/Trace 切换**

删除现有 session pane（第 123-140 行区域）：
```vue
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
```
替换为：
```vue
          <div v-show="tabsStore.activeType === 'session'" class="content-pane session-content">
            <template v-if="sessionTabs.length > 0">
              <div class="sub-tabs">
                <button class="sub-tab" :class="{ active: activeSubTab === 'terminal' }" @click="activeSubTab = 'terminal'">
                  <span class="sub-dot" /> 终端
                </button>
                <button class="sub-tab" :class="{ active: activeSubTab === 'trace' }" @click="activeSubTab = 'trace'">Trace</button>
              </div>
              <div v-show="activeSubTab === 'terminal'" class="sub-pane">
                <SessionTabContent
                  v-for="tab in sessionTabs"
                  :key="tab.payload?.sessionId as string"
                  v-show="activeSessionId === tab.payload?.sessionId"
                  :session-id="tab.payload?.sessionId as string"
                  :workdir="tab.payload?.workdir as string"
                  :visible="activeSessionId === tab.payload?.sessionId"
                />
              </div>
              <div v-show="activeSubTab === 'trace'" class="sub-pane">
                <TracePane />
              </div>
            </template>
            <div v-else class="empty"><div class="empty-text">未选择会话</div></div>
          </div>
```

- [ ] **Step 5: 替换 refs 声明**

在 script 中删除：
```ts
const traceCollapsed = ref(false)
const showTraceOverlay = ref(false)
```
替换为：
```ts
const workspaceCollapsed = ref(false)
const activeSubTab = ref<'terminal' | 'trace'>('terminal')
```

- [ ] **Step 6: 清理 `watch(activeSessionId)` 与相关函数**

在 `watch(activeSessionId, ...)` 中删除首行：
```ts
  showTraceOverlay.value = false
```

删除整个 `onTraceSelect` 与 `closeTraceOverlay` 函数：
```ts
function closeTraceOverlay() {
  showTraceOverlay.value = false
}

function onTraceSelect(seq: number) {
  if (showTraceOverlay.value && trace.selectedSeq === seq) {
    trace.select(seq)
    showTraceOverlay.value = false
  } else {
    trace.select(seq)
    showTraceOverlay.value = true
  }
}
```

删除 `closeSessionTab` 与 `onCloseTab`（及 `tabsStore.close` 路径）中的 `showTraceOverlay.value = false` 三处（当前在第 384、395 行附近），保留其余逻辑。

- [ ] **Step 7: 添加 sub-tabs 样式（追加到 HomeView `<style scoped>`）**

```css
.sub-tabs {
  height: 34px; min-height: 34px;
  display: flex; align-items: center; gap: 4px;
  padding: 0 10px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.sub-tab {
  display: flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 14px;
  border: none; background: transparent;
  border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 500; color: var(--text-secondary);
  cursor: pointer; font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.sub-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.sub-tab.active { background: var(--accent-soft-bg); color: var(--accent); font-weight: 600; }
.sub-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--status-success); }
.sub-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
```

- [ ] **Step 8: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。若报 `trace.selectedSeq` 不再使用、未使用变量等，清理残留。

- [ ] **Step 9: 手动验收（全栈 `npm run dev`）**

1. 打开一个会话：顶部 GlobalTabs 下方出现"终端 | Trace"双 tab，终端带绿点，默认终端激活。
2. 点 Trace：切换为分栏（左请求列表 + 右详情）；点某条请求右侧详情就地更新；切换回终端，xterm 缓冲保留、尺寸正常。
3. 打开 welcome / settings：无 sub-tabs。
4. 右侧 Workspace 面板：点折叠按钮收起为 0 宽，center-top 出现展开按钮，点击恢复。
5. 切换会话（GlobalTabs）：sub-tab 保持上次选择。
6. 删除一个会话 tab：无 TraceOverlay 相关报错。

- [ ] **Step 10: 提交**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "refactor: 会话视图接入终端/Trace 双 tab 与 Workspace 占位"
```

---

### Task 4: 删除旧组件与最终验证

**Files:**
- Delete: `src/renderer/src/components/trace/TraceSidebar.vue`
- Delete: `src/renderer/src/components/trace/TraceOverlay.vue`

**Interfaces:**
- Consumes: 前序任务已完成 HomeView 不再引用这两个组件。
- Produces: 干净的组件目录，无死代码。

- [ ] **Step 1: 删除两个组件文件**

```bash
git rm src/renderer/src/components/trace/TraceSidebar.vue
git rm src/renderer/src/components/trace/TraceOverlay.vue
```

- [ ] **Step 2: 全局确认无残留引用**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 通过，且 `grep -rn "TraceSidebar\|TraceOverlay" src/renderer/src` 无命中。

- [ ] **Step 3: 全量验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）。
Run: `cd "G:/work/lynel-desktop" && npm run test:main`
Expected: 32 files / 295 tests passed（主进程未受影响）。

- [ ] **Step 4: 提交**

```bash
git add -A src/renderer/src/components/trace
git commit -m "refactor: 移除 TraceSidebar 与 TraceOverlay 死代码"
```

---

### Task 5: 清理临时预览文件

**Files:**
- Delete: `layout-preview.html`（项目根目录，会话临时 mockup）

- [ ] **Step 1: 删除临时文件**

```bash
git rm --cached layout-preview.html 2>/dev/null || true
rm -f layout-preview.html
```

（该文件从未被 git 跟踪，只需删除磁盘文件；若已被跟踪则 `git rm`。）

- [ ] **Step 2: 确认工作区干净**

Run: `cd "G:/work/lynel-desktop" && git status`
Expected: 无遗留 untracked 的 `layout-preview.html`。

- [ ] **Step 3: 最终验证**

Run: `cd src/renderer && npx vue-tsc --noEmit` 与 `cd "G:/work/lynel-desktop" && npm run test:main`
Expected: 均通过。

---

## Self-Review

**Spec 覆盖核对：**
- 双 tab 栏（终端/Trace、34px、绿点、默认终端、仅会话视图）→ Task 3 Step 4/5/7。
- Trace 内容移入中间、分栏详情、移除浮层 → Task 2（TracePane）+ Task 3 Step 4（移除 TraceOverlay）+ Task 4（删 TraceOverlay）。
- 右侧 Workspace 占位（220px、可折叠、展开按钮）→ Task 1 + Task 3 Step 2/3。
- 移除 TraceSidebar → Task 3 Step 1（改 import）+ Task 4（删文件）。
- 测试（vue-tsc + 手动验收 + test:main）→ 各任务含验证步骤。

**占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。

**类型一致性：** `workspaceCollapsed`（Task 3 Step 2/3/5）全文件一致；`activeSubTab: 'terminal' | 'trace'`（Step 4/5）一致；`trace.select(seq)` 签名与 trace store（`select(seq: number)`）一致；`WorkspacePanel` props/emits 与 Task 1 一致；`RequestDetailPane` props 与现有组件一致。
