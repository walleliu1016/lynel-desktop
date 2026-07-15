# VS Code 风格主页与会话列表改造 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话列表从"扫描所有 projects 目录"改为 VS Code 风格：欢迎页 + 按项目隔离 + 最近会话记录

**Architecture:** 新增 WelcomeView 作为默认启动页；改造 HomeView 接收 project 参数过滤会话；SessionList 去掉状态 Tab 仅显示打开中的会话；SessionItem 增加运行时长和状态标签；新增 RecentSessionList 复用组件供欢迎页和项目切换下拉使用；主进程新增 recent-sessions.json 存储和 IPC handler

**Tech Stack:** Vue 3 + Pinia + Vue Router (hash) + TypeScript + Electron IPC + Lucide icons

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/main/recent-sessions.ts` | **新建** | 读写 `~/.lynel-desktop/recent-sessions.json` |
| `src/main/preload.ts` | 修改 | 暴露 `getRecentSessions` / `recordRecentSession` IPC |
| `src/main/app.ts` | 修改 | 注册 IPC handler + 启动时反向生成最近记录 |
| `src/renderer/src/stores/recent.ts` | **新建** | 最近会话 Pinia store |
| `src/renderer/src/views/WelcomeView.vue` | **新建** | 欢迎页 |
| `src/renderer/src/components/RecentSessionList.vue` | **新建** | 最近会话列表（复用） |
| `src/renderer/src/components/ProjectSwitcher.vue` | **新建** | 项目切换下拉 |
| `src/renderer/src/router/index.ts` | 修改 | 新增 `/welcome`；`/home` 加 query 参数 |
| `src/renderer/src/views/HomeView.vue` | 修改 | 接收 project 参数，按项目过滤 |
| `src/renderer/src/components/SessionList.vue` | 修改 | 去掉 Tab，仅显示打开中 + 搜索 |
| `src/renderer/src/components/SessionItem.vue` | 修改 | 运行时长 + 状态标签 + Hover 详情 |
| `src/renderer/src/composables/useElectron.ts` | 修改 | 新增 `GetRecentSessions` / `RecordRecentSession` |
| `src/renderer/src/stores/sessions.ts` | 修改 | `list` 按 project 过滤、新增 `openedAt` 跟踪 |

---

### Task 1: 主进程 — 最近会话数据层

**Files:**
- Create: `src/main/recent-sessions.ts`
- Modify: `src/main/preload.ts:10` (add after listSessions line)
- Modify: `src/main/app.ts:500` (add IPC handlers)
- Modify: `src/renderer/src/composables/useElectron.ts` (add exports)

- [ ] **Step 1: 创建 recent-sessions.ts**

```typescript
// src/main/recent-sessions.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface RecentSessionEntry {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle: string;
  firstPrompt: string;
  lastOpenedAt: number;
  startedAt: number;
  state: string;
  msgCount: number;
}

const DATA_DIR = path.join(os.homedir(), '.lynel-desktop');
const FILE_PATH = path.join(DATA_DIR, 'recent-sessions.json');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function getRecentSessions(): Promise<RecentSessionEntry[]> {
  try {
    await ensureDir();
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function recordRecentSession(entry: Omit<RecentSessionEntry, 'lastOpenedAt'> & { lastOpenedAt?: number }): Promise<RecentSessionEntry[]> {
  const list = await getRecentSessions();
  const idx = list.findIndex((e) => e.sessionId === entry.sessionId);
  const now = Math.floor(Date.now() / 1000);
  const record: RecentSessionEntry = {
    ...entry,
    lastOpenedAt: entry.lastOpenedAt ?? now,
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record, lastOpenedAt: now };
  } else {
    list.unshift(record);
  }
  list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  await ensureDir();
  await fs.writeFile(FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  return list;
}

/** 首次启动：从现有 projects 目录反向生成 */
export async function bootstrapRecentFromProjects(
  scanAll: () => Promise<Array<{ id: string; workdir: string; project: string; mtime: number; msg_count: number; first_prompt: string; ai_title: string }>>
): Promise<void> {
  try {
    await fs.access(FILE_PATH);
    return; // already exists
  } catch {
    // file doesn't exist, bootstrap
  }
  const sessions = await scanAll();
  if (sessions.length === 0) return;
  const entries: RecentSessionEntry[] = sessions.map((s) => ({
    sessionId: s.id,
    workdir: s.workdir,
    project: s.project,
    aiTitle: s.ai_title,
    firstPrompt: s.first_prompt,
    lastOpenedAt: s.mtime,
    startedAt: s.mtime,
    state: 'idle',
    msgCount: s.msg_count,
  }));
  entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  await ensureDir();
  await fs.writeFile(FILE_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}
```

- [ ] **Step 2: 注册 preload IPC**

在 `src/main/preload.ts` 第 10 行后添加：

```typescript
getRecentSessions: () => ipcRenderer.invoke('app:getRecentSessions'),
recordRecentSession: (entry: any) => ipcRenderer.invoke('app:recordRecentSession', entry),
```

- [ ] **Step 3: 注册 app.ts 中的 IPC handler**

在 `src/main/app.ts` 中找到 `ipcMain.handle('app:listSessions', ...)` 行（约第500行），在其后添加：

```typescript
ipcMain.handle('app:getRecentSessions', () => recentSessions.getRecentSessions());
ipcMain.handle('app:recordRecentSession', (_e, entry) => recentSessions.recordRecentSession(entry));
```

同时在文件顶部添加 import：

```typescript
import * as recentSessions from './recent-sessions.js';
```

并在 app 初始化时（找到 `jsonl.scanAll()` 调用附近，约第181行），添加 bootstrap 调用：

```typescript
await recentSessions.bootstrapRecentFromProjects(() => jsonl.scanAll());
```

- [ ] **Step 4: 更新前端 useElectron.ts**

在 `src/renderer/src/composables/useElectron.ts` 的 `ListSessions` 导出后添加：

```typescript
export const GetRecentSessions = () => api().getRecentSessions();
export const RecordRecentSession = (entry: Record<string, unknown>) => api().recordRecentSession(entry);
```

- [ ] **Step 5: 更新 preload.ts 的 ElectronAPI 类型**

确保 `src/main/preload.ts` 底部的 `export type ElectronAPI = typeof api;` 自动包含新方法（无需手动改类型，TypeScript 会从 `api` 对象推断）。

- [ ] **Step 6: 验证**

```bash
npm run test:main
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/main/recent-sessions.ts src/main/preload.ts src/main/app.ts src/renderer/src/composables/useElectron.ts
git commit -m "feat: 新增最近会话数据层，支持 recent-sessions.json 读写"
```

---

### Task 2: 前端 — 最近会话 Store

**Files:**
- Create: `src/renderer/src/stores/recent.ts`

- [ ] **Step 1: 创建 store**

```typescript
// src/renderer/src/stores/recent.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { GetRecentSessions, RecordRecentSession } from '../composables/useElectron'

export interface RecentSession {
  sessionId: string
  workdir: string
  project: string
  aiTitle: string
  firstPrompt: string
  lastOpenedAt: number
  startedAt: number
  state: string
  msgCount: number
}

export const useRecentStore = defineStore('recent', () => {
  const list = ref<RecentSession[]>([])
  const loading = ref(false)
  const showAll = ref(false)

  const displayed = computed(() => showAll.value ? list.value : list.value.slice(0, 5))
  const hasMore = computed(() => list.value.length > 5)

  async function refresh() {
    loading.value = true
    try {
      list.value = await GetRecentSessions()
    } catch (e: any) {
      console.error('[recent] refresh failed:', e?.message)
    } finally {
      loading.value = false
    }
  }

  async function record(entry: {
    sessionId: string
    workdir: string
    project: string
    aiTitle: string
    firstPrompt: string
    startedAt: number
    state: string
    msgCount: number
  }) {
    try {
      const updated = await RecordRecentSession(entry)
      list.value = updated
    } catch (e: any) {
      console.error('[recent] record failed:', e?.message)
    }
  }

  function toggleShowAll() {
    showAll.value = !showAll.value
  }

  return { list, loading, displayed, hasMore, showAll, refresh, record, toggleShowAll }
})
```

- [ ] **Step 2: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/recent.ts
git commit -m "feat: 新增最近会话 Pinia store"
```

---

### Task 3: 前端 — RecentSessionList 复用组件

**Files:**
- Create: `src/renderer/src/components/RecentSessionList.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <div class="recent-list">
    <div class="section-label">Recent Sessions</div>
    <div
      v-for="s in recent.displayed"
      :key="s.sessionId"
      class="recent-item"
      @click="$emit('select', s)"
    >
      <div class="status-dot" :class="s.state"></div>
      <span class="title">{{ s.aiTitle || s.firstPrompt || s.sessionId.slice(0, 8) }}</span>
      <span class="meta">
        <span class="workdir">{{ s.project || s.workdir }}</span>
        <span class="sid">{{ s.sessionId.slice(0, 8) }}</span>
        <span class="duration">· {{ formatDuration(s) }}</span>
      </span>
    </div>
    <div v-if="recent.hasMore" class="more-btn" @click="recent.toggleShowAll()">
      {{ recent.showAll ? 'Show less' : `Show ${recent.list.length - 5} more sessions...` }}
    </div>
    <div v-if="!recent.loading && recent.list.length === 0" class="empty">
      暂无最近会话，点击上方打开文件夹开始使用
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRecentStore } from '../stores/recent'

defineEmits<{ (e: 'select', entry: RecentSession): void }>()
import type { RecentSession } from '../stores/recent'

const recent = useRecentStore()

onMounted(() => { recent.refresh() })

function formatDuration(s: RecentSession): string {
  const now = Math.floor(Date.now() / 1000)
  const running = s.state === 'running' || s.state === 'waiting' || s.state === 'thinking' || s.state === 'streaming' || s.state === 'running_tool' || s.state === 'awaiting_permission'
  const end = running ? now : s.lastOpenedAt
  const sec = Math.max(0, end - s.startedAt)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h`
}
</script>

<style scoped>
.recent-list { }
.section-label {
  font-size: 10px; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 1px;
  margin-bottom: 8px;
}
.recent-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: var(--radius-md);
  cursor: pointer; margin-bottom: 2px;
}
.recent-item:hover { background: var(--bg-input); }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0;
}
.status-dot.running,
.status-dot.waiting,
.status-dot.thinking,
.status-dot.streaming,
.status-dot.running_tool { background: var(--status-success); }
.status-dot.awaiting_permission { background: var(--status-warn); }
.title {
  font-size: 12px; color: var(--text-primary); flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.meta {
  font-size: 10px; color: var(--text-tertiary); flex-shrink: 0;
  text-align: right; line-height: 1.4;
}
.workdir { color: var(--text-secondary); }
.sid { color: var(--accent-light); font-family: var(--font-mono); }
.duration { }
.more-btn {
  padding: 5px 10px; color: var(--accent-light); font-size: 11px;
  cursor: pointer; text-align: center; border-radius: var(--radius-md);
}
.more-btn:hover { background: var(--bg-input); }
.empty { color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 12px; }
</style>
```

- [ ] **Step 2: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/RecentSessionList.vue
git commit -m "feat: 新增 RecentSessionList 复用组件"
```

---

### Task 4: 前端 — 重写 SessionItem

**Files:**
- Modify: `src/renderer/src/components/SessionItem.vue`
- Modify: `src/renderer/src/components/SessionTooltip.vue`

- [ ] **Step 1: 重写 SessionItem.vue**

```vue
<template>
  <div
    class="session-item"
    :class="{ active: isActive }"
    @click="$emit('select')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    ref="itemEl"
  >
    <div class="status-dot" :class="stateClass"></div>
    <div class="body">
      <div class="row1">
        <span class="title">{{ displayTitle }}</span>
        <span class="state-label" :class="stateClass">{{ stateLabel }}</span>
      </div>
      <div class="row2">
        <span class="duration">⏱ {{ runningDuration }}</span>
        <span class="msg-count">· 💬 {{ meta.msg_count }}</span>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <SessionTooltip
      v-if="showTip"
      :meta="meta"
      :state="currentState"
      :duration="runningDuration"
      :anchor="tipAnchor"
      @mouseenter="cancelHide"
      @mouseleave="onLeave"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import SessionTooltip from './SessionTooltip.vue'
import { useSessionsStore } from '../stores/sessions'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; isActive: boolean }>()
defineEmits<{ (e: 'select'): void }>()

const sessions = useSessionsStore()
const showTip = ref(false)
const itemEl = ref<HTMLElement | null>(null)
const tipAnchor = ref({ x: 0, y: 0 })
let hideTimer: ReturnType<typeof setTimeout> | null = null
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 30000) })
onBeforeUnmount(() => { if (tick) clearInterval(tick) })

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTip.value = true
  if (itemEl.value) {
    const r = itemEl.value.getBoundingClientRect()
    tipAnchor.value = { x: r.right + 8, y: r.top }
  }
}
function onLeave() {
  hideTimer = setTimeout(() => { showTip.value = false }, 150)
}
function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
}

const currentState = computed(() => sessions.state[props.meta.id] || 'idle')

const stateClass = computed(() => {
  const s = currentState.value
  if (s === 'running' || s === 'waiting' || s === 'thinking' || s === 'streaming' || s === 'running_tool') return 'running'
  if (s === 'awaiting_permission') return 'awaiting_permission'
  if (s === 'ended') return 'ended'
  return 'idle'
})

const stateLabel = computed(() => {
  const s = currentState.value
  if (s === 'awaiting_permission') return '权限待批'
  if (s === 'running' || s === 'waiting' || s === 'thinking' || s === 'streaming' || s === 'running_tool') return 'running'
  if (s === 'ended') return '已结束'
  if (s === 'done') return '已完成'
  return '空闲'
})

const displayTitle = computed(() => props.meta.ai_title || props.meta.first_prompt || props.meta.id?.slice(0, 8) || '新会话')

const runningDuration = computed(() => {
  const openedAt = sessions.openedAt[props.meta.id]
  const startMs = openedAt ? openedAt * 1000 : props.meta.mtime * 1000
  const endMs = (currentState.value === 'done' || currentState.value === 'ended') ? props.meta.mtime * 1000 : now.value
  const sec = Math.max(0, Math.floor((endMs - startMs) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h`
})
</script>

<style scoped>
.session-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-md);
  cursor: pointer; position: relative;
  background: var(--session-item-bg);
  border: 1px solid transparent;
  margin: 4px 0;
  transition: background 0.15s, border-color 0.15s;
}
.session-item:hover { background: var(--session-item-hover-bg); }
.session-item.active { background: var(--session-item-active-bg); border-color: var(--accent-soft-border); }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0; margin-top: 4px;
}
.status-dot.running { background: var(--status-success); }
.status-dot.awaiting_permission { background: var(--status-warn); }
.status-dot.ended {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-tertiary);
}
.body { flex: 1; min-width: 0; }
.row1 {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px;
}
.title {
  font-size: 12px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.state-label {
  font-size: 9px; flex-shrink: 0; color: var(--text-tertiary);
}
.state-label.running { color: var(--status-success); }
.state-label.awaiting_permission { color: var(--status-warn); }
.row2 {
  font-size: 10px; color: var(--text-tertiary); margin-top: 1px;
  display: flex; gap: 10px;
}
</style>
```

- [ ] **Step 2: 更新 SessionTooltip.vue**

```vue
<template>
  <div class="tip" :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }" @mouseenter="$emit('mouseenter')" @mouseleave="$emit('mouseleave')">
    <div class="section" v-if="meta.ai_title">
      <div class="label">AI 标题</div>
      <div class="value">{{ meta.ai_title }}</div>
    </div>
    <div class="section">
      <div class="label">状态</div>
      <div class="value">{{ stateText }}</div>
    </div>
    <div class="section">
      <div class="label">运行时长</div>
      <div class="value">{{ duration }}</div>
    </div>
    <div class="divider" />
    <div class="section">
      <div class="label">工作目录</div>
      <div class="value">{{ meta.workdir }}</div>
    </div>
    <div class="section">
      <div class="label">Session ID</div>
      <div class="mono-value">{{ meta.id }}</div>
    </div>
    <div class="section">
      <div class="label">开始时间</div>
      <div class="value">{{ startTime }}</div>
    </div>
    <div class="divider" />
    <div class="stats">
      <div class="stat">
        <span class="stat-v">{{ meta.msg_count }}</span>
        <span class="stat-k">消息</span>
      </div>
      <div class="stat">
        <span class="stat-v">{{ formatSize }}</span>
        <span class="stat-k">大小</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionMeta } from '../types/session'
import type { SessionState } from '../types/session'

const props = defineProps<{
  meta: SessionMeta
  state: SessionState
  duration: string
  anchor: { x: number; y: number }
}>()
defineEmits<{ (e: 'mouseenter'): void; (e: 'mouseleave'): void }>()

const stateText = computed(() => {
  const m: Record<string, string> = {
    idle: '空闲', waiting: '等待中', thinking: '思考中',
    streaming: '输出中', running_tool: '执行工具',
    awaiting_permission: '等待权限', done: '已完成', ended: '已结束',
  }
  return m[props.state] || props.state
})

const startTime = computed(() => {
  const d = new Date(props.meta.mtime * 1000)
  return d.toLocaleString('zh-CN')
})

const formatSize = computed(() => {
  const s = props.meta.size
  if (s < 1024) return `${s} B`
  if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`
  return `${(s / 1024 / 1024).toFixed(2)} MB`
})
</script>

<style scoped>
.tip {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  min-width: 280px;
  max-width: 380px;
  z-index: 1000;
  box-shadow: var(--shadow-window);
}
.section { margin-bottom: 6px; }
.label { font-size: 9px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px; }
.value { font-size: 11px; color: var(--text-primary); line-height: 1.4; word-break: break-all; }
.mono-value { font-size: 10px; font-family: var(--font-mono); color: var(--accent-light); word-break: break-all; line-height: 1.4; }
.divider { border-top: 1px solid var(--border); margin: 8px 0; }
.stats { display: flex; gap: 14px; }
.stat { display: flex; flex-direction: column; gap: 1px; }
.stat-v { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.stat-k { font-size: 9px; color: var(--text-tertiary); }
</style>
```

在 `<script setup>` 的 props 定义中新增 `state` 和 `duration` 两个 prop（已在上述代码中）。

- [ ] **Step 3: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SessionItem.vue src/renderer/src/components/SessionTooltip.vue
git commit -m "feat: 重写 SessionItem，支持运行时长、状态标签、Hover 详情卡片"
```

---

### Task 5: 前端 — 重写 SessionList

**Files:**
- Modify: `src/renderer/src/components/SessionList.vue`

- [ ] **Step 1: 重写组件**

```vue
<template>
  <div class="session-list">
    <div class="header">
      <div class="project-title">
        <span class="project-name">{{ project }}</span>
        <button class="icon-btn" title="新建会话" @click="$emit('create')">
          <Icon name="plus" :size="14" />
        </button>
        <button class="icon-btn" title="切换项目" @click="showSwitcher = !showSwitcher">
          <Icon name="chevron-down" :size="14" />
        </button>
      </div>
    </div>
    <div class="search-bar">
      <input
        v-model="search"
        class="search-input"
        placeholder="筛选会话…"
        @keydown.escape="search = ''"
      />
      <button v-if="search" class="search-clear" @click="search = ''">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <div class="items">
      <template v-if="sessions.loading && !hasItems">
        <div v-for="i in 3" :key="i" class="skeleton-item">
          <div class="skeleton-dot" />
          <div class="skeleton-lines">
            <div class="skeleton-line short" />
            <div class="skeleton-line" />
          </div>
        </div>
      </template>
      <template v-else>
        <SessionItem
          v-for="s in filteredList"
          :key="s.id"
          :meta="s"
          :is-active="s.id === activeId"
          @select="$emit('select', s.id)"
        />
        <div v-if="!filteredList.length && hasItems" class="empty">
          {{ search ? '无匹配结果' : '暂无打开中的会话' }}
        </div>
        <div v-if="!hasItems && !sessions.loading" class="empty">
          点击 + 创建新会话
        </div>
      </template>
    </div>
    <!-- ProjectSwitcher overlay -->
    <Teleport to="body">
      <ProjectSwitcher
        v-if="showSwitcher"
        @close="showSwitcher = false"
        @select="onProjectSelect"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import SessionItem from './SessionItem.vue'
import Icon from './Icon.vue'
import ProjectSwitcher from './ProjectSwitcher.vue'
import { useSessionsStore } from '../stores/sessions'
import type { SessionMeta, RecentSession } from '../types/session'
// Note: RecentSession imported from stores/recent

const props = defineProps<{ list: SessionMeta[]; activeId: string | null; project: string }>()
const emit = defineEmits<{
  (e: 'create'): void
  (e: 'select', id: string): void
  (e: 'switchProject', entry: { workdir: string; sessionId?: string }): void
}>()

const sessions = useSessionsStore()
const search = ref('')
const showSwitcher = ref(false)

const hasItems = computed(() => props.list.length > 0)

const filteredList = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list.filter((s) => !!sessions.opened[s.id])
  return props.list.filter((s) => {
    if (!sessions.opened[s.id]) return false
    const title = (s.ai_title || s.first_prompt || '').toLowerCase()
    const sid = s.id.toLowerCase()
    return title.includes(q) || sid.includes(q)
  })
})

function onProjectSelect(entry: RecentSession) {
  showSwitcher.value = false
  emit('switchProject', { workdir: entry.workdir, sessionId: entry.sessionId })
}
</script>

<style scoped>
.session-list { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.header {
  display: flex; align-items: center;
  padding: 0 8px 0 12px; border-bottom: 1px solid var(--border);
  flex-shrink: 0; height: 38px;
}
.project-title {
  display: flex; align-items: center; gap: 4px; width: 100%;
}
.project-name {
  font-size: 11px; font-weight: 600; color: var(--text-primary);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.icon-btn {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: var(--radius-sm); flex-shrink: 0;
}
.icon-btn:hover { background: var(--bg-input); color: var(--text-primary); }
.search-bar { position: relative; margin: 6px 6px 0; flex-shrink: 0; }
.search-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 5px 28px 5px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-tertiary); }
.search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%;
}
.search-clear:hover { background: var(--border); color: var(--text-primary); }
.items { flex: 1; overflow-y: auto; padding: 4px 6px; min-height: 0; }
.empty { color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 20px; }

.skeleton-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius-md); margin-bottom: 4px;
}
.skeleton-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border); flex-shrink: 0;
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.skeleton-line {
  height: 10px; border-radius: var(--radius-sm);
  background: var(--border); animation: pulse 1.4s ease-in-out infinite;
}
.skeleton-line.short { width: 40%; }
@keyframes pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.75; } }
</style>
```

由于 `SessionList` 现在需要 `project` prop 且内部使用了 `ProjectSwitcher`，原来的 `SessionList` 的 `filter/dupProjects` 逻辑全部移除。

- [ ] **Step 2: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SessionList.vue
git commit -m "feat: 重写 SessionList，去掉状态 Tab，仅显示打开中的会话"
```

---

### Task 6: 前端 — ProjectSwitcher 下拉组件

**Files:**
- Create: `src/renderer/src/components/ProjectSwitcher.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <div class="switcher-overlay" @click.self="$emit('close')">
    <div class="switcher-dropdown">
      <div class="section-label">打开新的</div>
      <div class="action-item" @click="onOpenFolder">
        <Icon name="plus" :size="14" />
        <span>选择目录打开...</span>
      </div>
      <div class="divider" />
      <RecentSessionList @select="onSelectRecent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import RecentSessionList from './RecentSessionList.vue'
import { PickDirectory } from '../composables/useElectron'
import type { RecentSession } from '../stores/recent'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', entry: RecentSession): void
  (e: 'openFolder', workdir: string): void
}>()

async function onOpenFolder() {
  try {
    const dir = await PickDirectory()
    if (dir) emit('openFolder', dir)
  } catch {}
}

function onSelectRecent(entry: RecentSession) {
  emit('select', entry)
}
</script>

<style scoped>
.switcher-overlay {
  position: fixed; inset: 0; z-index: 500;
}
.switcher-dropdown {
  position: absolute; left: 290px; top: 46px;
  width: 320px; max-height: 400px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-window);
  padding: 12px;
}
.section-label {
  font-size: 9px; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 1px;
  margin-bottom: 4px;
}
.action-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: var(--radius-md);
  cursor: pointer; font-size: 12px; color: var(--text-primary);
}
.action-item:hover { background: var(--bg-input); }
.divider { border-top: 1px solid var(--border); margin: 8px 0; }
</style>
```

- [ ] **Step 2: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ProjectSwitcher.vue
git commit -m "feat: 新增 ProjectSwitcher 项目切换下拉组件"
```

---

### Task 7: 前端 — WelcomeView 欢迎页

**Files:**
- Create: `src/renderer/src/views/WelcomeView.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <div class="welcome">
    <TitleBar />
    <div class="welcome-body">
      <div class="welcome-content">
        <h1 class="app-name">Lynel Desktop</h1>
        <p class="app-subtitle">Start</p>

        <div class="start-section">
          <div class="section-label">Start</div>
          <div class="action-btn" @click="onOpenFolder">
            <Icon name="plus" :size="16" />
            <span>Open Folder...</span>
          </div>
        </div>

        <div class="recent-section">
          <RecentSessionList @select="onSelectRecent" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import Icon from '../components/Icon.vue'
import RecentSessionList from '../components/RecentSessionList.vue'
import { PickDirectory } from '../composables/useElectron'
import { useRecentStore, type RecentSession } from '../stores/recent'

const router = useRouter()
const recent = useRecentStore()

async function onOpenFolder() {
  try {
    const dir = await PickDirectory()
    if (dir) {
      const encoded = encodeURIComponent(dir)
      router.push(`/home?project=${encoded}`)
    }
  } catch {}
}

function onSelectRecent(entry: RecentSession) {
  const encoded = encodeURIComponent(entry.workdir)
  router.push(`/home?project=${encoded}&session=${entry.sessionId}`)
}
</script>

<style scoped>
.welcome { display: flex; flex-direction: column; height: 100vh; }
.welcome-body {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: var(--bg-primary);
}
.welcome-content { width: 100%; max-width: 500px; padding: 32px; }
.app-name { font-size: 22px; font-weight: 300; color: var(--text-primary); margin-bottom: 2px; }
.app-subtitle { font-size: 12px; color: var(--text-secondary); margin-bottom: 28px; }
.start-section { margin-bottom: 20px; }
.section-label {
  font-size: 10px; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;
}
.action-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  cursor: pointer; font-size: 13px; color: var(--text-primary);
}
.action-btn:hover { background: var(--bg-input); border-color: var(--accent); }
</style>
```

- [ ] **Step 2: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/WelcomeView.vue
git commit -m "feat: 新增 WelcomeView 欢迎页"
```

---

### Task 8: 路由改造

**Files:**
- Modify: `src/renderer/src/router/index.ts`

- [ ] **Step 1: 更新路由**

```typescript
// src/renderer/src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import WelcomeView from '../views/WelcomeView.vue'
import HomeView from '../views/HomeView.vue'
import SettingsView from '../views/SettingsView.vue'
import NotchView from '../views/NotchView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: LoginView },
    { path: '/welcome', component: WelcomeView, meta: { requiresAuth: true } },
    { path: '/home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/settings', component: SettingsView },
    { path: '/notch', component: NotchView },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.loggedIn) {
    return '/login'
  }
  return true
})

export default router
```

关键变化：
1. 新增 WelcomeView 导入和 `/welcome` 路由（`requiresAuth: true`）
2. 将 `LoginView` 中登录成功后的跳转目标从 `/home` 改为 `/welcome`

- [ ] **Step 2: 更新 LoginView 跳转目标**

在 `src/renderer/src/views/LoginView.vue` 中找到 `router.push('/home')` 改为 `router.push('/welcome')`。

- [ ] **Step 3: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/router/index.ts src/renderer/src/views/LoginView.vue
git commit -m "feat: 新增 /welcome 路由，登录后跳转欢迎页"
```

---

### Task 9: HomeView 改造 — 接收 project 参数

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

- [ ] **Step 1: 更新 HomeView**

主要修改点（在现有代码基础上改动）：

1. 顶部 `<script setup>` 中新增 route 导入和 project 解析：

```typescript
import { useRoute } from 'vue-router'
// ... existing imports

const route = useRoute()
const currentProject = computed(() => {
  const p = route.query.project
  return p ? decodeURIComponent(String(p)) : ''
})
const targetSessionId = computed(() => {
  const s = route.query.session
  return s ? String(s) : null
})
```

2. 修改 `onMounted`，根据 project 参数过滤会话列表：

```typescript
onMounted(async () => {
  await sessions.refresh()
  // 如果有 project 参数，过滤到当前项目的会话
  if (currentProject.value) {
    sessions.setProjectFilter(currentProject.value)
  }
  // 如果有 session 参数，自动选中并打开
  if (targetSessionId.value) {
    const meta = sessions.list.find((s) => s.id === targetSessionId.value)
    if (meta) {
      await selectSession(targetSessionId.value)
    }
  }
  try {
    const info = await GetAppInfo()
    username.value = info.username
    version.value = info.version
  } catch {}
})
```

3. 修改 SessionList 的调用，传入 project prop 并处理 switchProject 事件：

```html
<SessionList
  :list="sessions.list"
  :active-id="sessions.activeId"
  :project="currentProject"
  @create="showNew = true"
  @select="selectSession"
  @switch-project="onSwitchProject"
/>
```

4. 新增 `onSwitchProject` 方法：

```typescript
async function onSwitchProject(entry: { workdir: string; sessionId?: string }) {
  const encoded = encodeURIComponent(entry.workdir)
  if (entry.sessionId) {
    router.push(`/home?project=${encoded}&session=${entry.sessionId}`)
  } else {
    router.push(`/home?project=${encoded}`)
  }
}
```

5. 记录最近会话：在 `selectSession` 和 `onCreate` 成功后调用 `recent.record()`。

在 `<script setup>` 中引入 recent store：

```typescript
import { useRecentStore } from '../stores/recent'
const recent = useRecentStore()
```

在 `selectSession` 函数末尾添加：

```typescript
// 记录到最近会话
const m = sessions.list.find((s) => s.id === id)
if (m) {
  recent.record({
    sessionId: m.id,
    workdir: m.workdir,
    project: m.project,
    aiTitle: m.ai_title,
    firstPrompt: m.first_prompt,
    startedAt: Math.floor(Date.now() / 1000),
    state: sessions.state[id] || 'idle',
    msgCount: m.msg_count,
  })
}
```

在 `onCreate` 函数返回 id 后添加类似逻辑。

- [ ] **Step 2: 更新 sessions store — 添加 projectFilter 和 openedAt**

在 `src/renderer/src/stores/sessions.ts` 中添加：

```typescript
const projectFilter = ref<string>('')
const openedAt = ref<Record<string, number>>({})

function setProjectFilter(workdir: string) {
  projectFilter.value = workdir
}

// 在 select 函数中记录打开时间
// 在 opened.value 赋值后添加：
openedAt.value = { ...openedAt.value, [id]: Math.floor(Date.now() / 1000) }
```

在 return 中导出 `projectFilter`、`openedAt`、`setProjectFilter`。

- [ ] **Step 3: 类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/HomeView.vue src/renderer/src/stores/sessions.ts
git commit -m "feat: HomeView 支持 project 参数过滤，自动记录最近会话"
```

---

### Task 10: 集成验证与端到端测试

- [ ] **Step 1: 运行全部类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

修复任何类型错误。

- [ ] **Step 2: 运行主进程测试**

```bash
npm run test:main
```

- [ ] **Step 3: 手动验证清单**

1. 启动应用 → 看到 `/welcome` 欢迎页
2. 点击 "Open Folder" → 系统目录选择器 → 选择目录 → 跳转 `/home?project=...`
3. 侧边栏显示项目名 + 搜索框 + 空会话列表
4. 点击 + 创建新会话 → 会话出现在列表中
5. 会话条目显示：状态圆点 + AI 标题 + 状态标签 + 运行时长 + 消息数
6. Hover 会话条目 → 详情卡片弹出
7. 点击 ↕ 切换项目 → 下拉显示 Open Folder + 最近会话
8. 关闭会话 → 从列表中移除
9. 回到欢迎页 → 最近会话列表显示刚才打开的会话
10. Recent Sessions 默认显示 5 条，点击 Show more 展开

- [ ] **Step 4: Commit final changes**

```bash
git add -A
git commit -m "chore: 集成验证修复"
```
