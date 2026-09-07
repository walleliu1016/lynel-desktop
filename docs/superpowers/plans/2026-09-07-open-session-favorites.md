# 打开会话弹窗与收藏功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立「打开会话」弹窗（收藏 + 历史 + 搜索），并实现会话级收藏（悬停加星、四处一致展示、快速打开）。

**Architecture:** 主进程新增纯 fs 收藏模块 `src/main/favorites.ts`（落盘 `favorite-sessions.json`，生命周期独立于 recents 的 30 条滚动），经 `app:*` IPC 暴露；渲染端以 `stores/favorites.ts` 统一收藏状态供四处（弹窗/侧栏/首页/搜索）同步读取。点收藏项复用 `HomeView.onOpenRecent()` 现成打开链路（Adopt + OpenTerminal + 开 tab）。

**Tech Stack:** Electron IPC（`ipcRenderer.invoke` / `ipcMain.handle`）、Vue 3 `<script setup>` + Pinia setup store、`@lucide/vue`（`star` 图标经 `Icon.vue`）、vitest（主进程单测）、vue-tsc 类型门禁。

## Global Constraints

- 全部回复与注释用简体中文。
- `useElectron.ts` 是渲染端唯一接触 `window.electronAPI` 的文件；preload 用 `contextBridge` 暴露，`ElectronAPI = typeof api` 自动推导类型。
- 主进程 ESM import 须带 `.js` 后缀（如 `import { X } from './favorites.js'`）；渲染端 import 不带后缀。
- 渲染端不使用 emoji 当图标；图标统一经 `components/Icon.vue`（lucide `star`）。
- 样式一律用 `styles/theme.css` 的 CSS 变量，不硬编码颜色。
- Pinia 用 setup style；Vue 组件用 `<script setup lang="ts">`。
- Pinia `ref<Record<K, V>>` 更新整体 spread；`favorites`/`allSessions` 数组更新用数组替换而非原地 push。
- 收藏**不触发** cloud 会话快照上行；不修改 `recent-sessions.json` 的淘汰逻辑。
- 门禁：主进程改动后 `npm run test:main` 全绿；渲染改动后 `cd src/renderer && npx vue-tsc --noEmit` 通过。
- **提交授权**：本仓库默认不在未经明确要求时自动 commit。执行开始前先与用户确认「是否允许每个 task 收尾 commit」。获准后遵守 CLAUDE.md：一个 task 一个 commit、commit 前测试门禁全绿。
- 会话展示标题优先级统一用 `sessionDisplayTitle(meta)`（user_title > ai_title > first_prompt > project > id[:8]）。

---

### Task 1: 主进程收藏模块 `src/main/favorites.ts`

**Files:**
- Create: `src/main/favorites.ts`
- Test: `tests/main/favorites.test.ts`

**Interfaces:**
- Produces（本 task 导出的精确签名，供 Task 2 消费）：
  ```ts
  import type { AgentKind } from './agents/index.js';
  export interface FavoriteSessionRecord {
    sessionId: string;
    workdir: string;
    project: string;
    userTitle?: string;
    aiTitle?: string;
    firstPrompt?: string;
    agent?: AgentKind;
    favoritedAt: number; // 收藏顺序：升序=先收藏在前，新收藏追加末尾
  }
  export const FAVORITES_PATH: string; // os.homedir()/.lynel-desktop/favorite-sessions.json
  export function readFavoriteSessions(filePath?: string): FavoriteSessionRecord[];
  export function writeFavoriteSessions(list: FavoriteSessionRecord[], filePath?: string): void;
  /** 幂等新增：存在同 sessionId 返回 false 不写盘；否则 favoritedAt=Date.now() 追加末尾后写盘，返回 true */
  export function addFavorite(record: Omit<FavoriteSessionRecord, 'favoritedAt'>, filePath?: string): boolean;
  export function removeFavorite(sessionId: string, filePath?: string): void;
  /** 纯函数：收藏项若同时存在于 recents，用 recents 最新标题/agent 字段覆盖；保持 favorites 顺序 */
  export function mergeFavoriteTitles(
    favorites: FavoriteSessionRecord[],
    recents: Array<{ sessionId: string; userTitle?: string; aiTitle?: string; firstPrompt?: string; agent?: AgentKind }>,
  ): FavoriteSessionRecord[];
  ```

- [ ] **Step 1: 写失败测试**

写入 `tests/main/favorites.test.ts`（临时目录注入，风格对齐 `tests/main/auth-persistence.test.ts`）：

```ts
// tests/main/favorites.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readFavoriteSessions,
  writeFavoriteSessions,
  addFavorite,
  removeFavorite,
  mergeFavoriteTitles,
  type FavoriteSessionRecord,
} from '../../src/main/favorites.js';

// 隔离 electron 相关 import（favorites.ts 若引入 AgentKind 仅类型 import，无运行时依赖）
vi.mock('electron', () => ({ safeStorage: {} }));

function tmpPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-fav-'));
  return path.join(dir, 'favorites.json');
}

const base = { sessionId: 's1', workdir: '/p', project: 'p', firstPrompt: 'hi' } as const;

describe('favorites', () => {
  let f: string;
  beforeEach(() => { f = tmpPath(); });

  it('读取不存在文件返回空数组', () => {
    expect(readFavoriteSessions(f)).toEqual([]);
  });

  it('addFavorite 幂等追加末尾，带 favoritedAt', () => {
    expect(addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f)).toBe(true);
    expect(addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f)).toBe(false);
    expect(addFavorite({ sessionId: 's2', workdir: '/p', project: 'p' }, f)).toBe(true);
    const list = readFavoriteSessions(f);
    expect(list.map((r) => r.sessionId)).toEqual(['s1', 's2']);
    expect(list[0].favoritedAt).toBeGreaterThan(0);
    expect(list[0].favoritedAt).toBeLessThanOrEqual(list[1].favoritedAt);
  });

  it('removeFavorite 过滤并保持顺序', () => {
    addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f);
    addFavorite({ sessionId: 's2', workdir: '/p', project: 'p' }, f);
    removeFavorite('s1', f);
    expect(readFavoriteSessions(f).map((r) => r.sessionId)).toEqual(['s2']);
  });

  it('写损坏 JSON 读取返回空数组不抛异常', () => {
    fs.writeFileSync(f, 'not-json', 'utf8');
    expect(readFavoriteSessions(f)).toEqual([]);
  });

  it('mergeFavoriteTitles 用 recents 最新标题覆盖并保持顺序', () => {
    const favs: FavoriteSessionRecord[] = [
      { ...base, sessionId: 'a', firstPrompt: 'old' },
      { ...base, sessionId: 'b', firstPrompt: 'keep', favoritedAt: 2 },
    ] as FavoriteSessionRecord[];
    const recents = [{ sessionId: 'a', userTitle: 'new-title', agent: 'codex' as any }];
    const merged = mergeFavoriteTitles(favs, recents);
    expect(merged.map((r) => r.sessionId)).toEqual(['a', 'b']);
    expect(merged[0].userTitle).toBe('new-title');
    expect(merged[0].agent).toBe('codex');
    expect(merged[0].firstPrompt).toBe('old'); // recents 无该字段时不覆盖
    expect(merged[1].firstPrompt).toBe('keep');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/favorites.test.ts`
Expected: FAIL —— `Cannot find module '../../src/main/favorites.js'` 等。

- [ ] **Step 3: 实现 `src/main/favorites.ts`**

```ts
// src/main/favorites.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentKind } from './agents/index.js';

export interface FavoriteSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  userTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  agent?: AgentKind;
  favoritedAt: number;
}

export const FAVORITES_PATH = path.join(os.homedir(), '.lynel-desktop', 'favorite-sessions.json');

export function readFavoriteSessions(filePath: string = FAVORITES_PATH): FavoriteSessionRecord[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FavoriteSessionRecord[];
  } catch {
    return []; // 不存在 / 损坏 / 无权限一律空数组，不阻塞主进程
  }
}

export function writeFavoriteSessions(list: FavoriteSessionRecord[], filePath: string = FAVORITES_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
  } catch {
    /* 收藏写入失败仅影响收藏持久化，不阻断主流程 */
  }
}

export function addFavorite(record: Omit<FavoriteSessionRecord, 'favoritedAt'>, filePath: string = FAVORITES_PATH): boolean {
  const list = readFavoriteSessions(filePath);
  if (list.some((r) => r.sessionId === record.sessionId)) return false;
  list.push({ ...record, favoritedAt: Date.now() });
  writeFavoriteSessions(list, filePath);
  return true;
}

export function removeFavorite(sessionId: string, filePath: string = FAVORITES_PATH): void {
  const list = readFavoriteSessions(filePath).filter((r) => r.sessionId !== sessionId);
  writeFavoriteSessions(list, filePath);
}

export function mergeFavoriteTitles(
  favorites: FavoriteSessionRecord[],
  recents: Array<{ sessionId: string; userTitle?: string; aiTitle?: string; firstPrompt?: string; agent?: AgentKind }>,
): FavoriteSessionRecord[] {
  const map = new Map(recents.map((r) => [r.sessionId, r]));
  return favorites.map((fav) => {
    const rec = map.get(fav.sessionId);
    if (!rec) return fav;
    const merged: FavoriteSessionRecord = { ...fav };
    if (rec.userTitle) merged.userTitle = rec.userTitle;
    if (rec.aiTitle) merged.aiTitle = rec.aiTitle;
    if (rec.firstPrompt) merged.firstPrompt = rec.firstPrompt;
    if (rec.agent) merged.agent = rec.agent;
    return merged;
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/favorites.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 全量主进程测试**

Run: `npm run test:main`
Expected: 全绿

- [ ] **Step 6: Commit（需已获用户授权提交）**

```bash
git add src/main/favorites.ts tests/main/favorites.test.ts
git commit -m "feat: 新增会话收藏持久化模块 favorite-sessions.json"
```

---

### Task 2: 主进程 IPC handler + preload 暴露

**Files:**
- Modify: `src/main/app.ts`（顶部 import + 在 `app:removeRecentSession` handler 附近追加 3 个 handler）
- Modify: `src/main/preload.ts`（`api` 对象内追加 3 个方法）
- Test: 主进程无单测覆盖 app.ts，门禁为 `npm run test:main` + `npm run build:electron`（tsc）

**Interfaces:**
- Consumes: Task 1 的 `readFavoriteSessions / addFavorite / removeFavorite / mergeFavoriteTitles`。
- Produces:
  - IPC `app:getFavorites` → `FavoriteSessionRecord[]`（先读收藏，再 `mergeFavoriteTitles` 用 recents 覆盖标题/agent，返回）
  - IPC `app:addFavorite(record)` → boolean（`addFavorite` 幂等结果）
  - IPC `app:removeFavorite(sessionId)` → void
  - preload 方法 `getFavorites() / addFavorite(record) / removeFavorite(sessionId)`（`ElectronAPI` 由 `typeof api` 自动推导）

- [ ] **Step 1: 在 `src/main/app.ts` 顶部 import**

在 `src/main/app.ts` 现有 import 区（约 `import { mergeRecentAgentField, type RecentSessionRecord } from './session-meta.js';` 附近）追加：

```ts
import { readFavoriteSessions, addFavorite as writeFavorite, removeFavorite as dropFavorite, mergeFavoriteTitles } from './favorites.js';
```

- [ ] **Step 2: 追加 3 个 IPC handler**

在 `app.ts` 的 `ipcMain.handle('app:removeRecentSession', ...)`（约 1792-1795 行）之后插入：

```ts
    // 会话收藏（独立于 recents 30 条窗口，不进 cloud 上行）
    ipcMain.handle('app:getFavorites', () => {
      const favs = this.withRecentLock(() => readFavoriteSessions());
      const recents = this.withRecentLock(() => readRecentSessions());
      return mergeFavoriteTitles(favs, recents);
    });
    ipcMain.handle('app:addFavorite', (_event, record: Parameters<typeof writeFavorite>[0]) =>
      this.withRecentLock(() => writeFavorite(record)),
    );
    ipcMain.handle('app:removeFavorite', (_event, sessionId: string) => {
      this.withRecentLock(() => dropFavorite(sessionId));
    });
```

> 说明：复用现有 `withRecentLock` 避免与 recents 文件并发交错；收藏本身不触发 `debouncedSendCloudSessionSnapshot()`（保持云上行集合不变）。

- [ ] **Step 3: `src/main/preload.ts` 追加 3 个方法**

在 `api` 对象里 `removeRecentSession`（37-38 行）之后追加：

```ts
  getFavorites: () => ipcRenderer.invoke('app:getFavorites'),
  addFavorite: (record: any) => ipcRenderer.invoke('app:addFavorite', record),
  removeFavorite: (sessionId: string) => ipcRenderer.invoke('app:removeFavorite', sessionId),
```

- [ ] **Step 4: 类型与测试门禁**

Run: `npm run build:electron`
Expected: tsc 无错误（preload 类型 `typeof api` 自动带上新方法）

Run: `npm run test:main`
Expected: 全绿

- [ ] **Step 5: Commit（需授权）**

```bash
git add src/main/app.ts src/main/preload.ts
git commit -m "feat: 注册收藏 IPC 并在 preload 暴露 getFavorites/addFavorite/removeFavorite"
```

---

### Task 3: 渲染端 IPC 包装 + favorites store + 星标组件

**Files:**
- Modify: `src/renderer/src/composables/useElectron.ts`
- Modify: `src/renderer/src/components/Icon.vue`（注册 star 图标 + fill prop）
- Create: `src/renderer/src/stores/favorites.ts`
- Create: `src/renderer/src/components/FavoriteStar.vue`
- Test: 渲染无 runnable 门禁脚本，验证为 `npx vue-tsc --noEmit`

**Interfaces:**
- Consumes: `app:getFavorites / app:addFavorite / app:removeFavorite`。
- Produces（供 Task 5-8 使用）：
  ```ts
  // stores/favorites.ts
  export interface FavoriteSession extends RecentSession { favoritedAt: number }
  export function toFavorite(meta: SessionMeta): RecentSession;
  export function useFavoritesStore(): {
    favorites: Ref<FavoriteSession[]>;  // 有序：先收藏在前
    loading: Ref<boolean>;
    loadFavorites(): Promise<void>;
    addFavorite(meta: RecentSession): Promise<void>;   // 已收藏时 no-op
    removeFavorite(sessionId: string): Promise<void>;
    isFavorite(sessionId: string): boolean;
    toRecent(sessionId: string): RecentSession | null; // 供打开：lastOpenedAt=favoritedAt
  }
  // components/FavoriteStar.vue
  props: { sessionId: string; size?: number };
  emits: { (e: 'toggle'): void };  // 不处理业务，父组件决定 add/remove
  ```

- [ ] **Step 1: `useElectron.ts` 追加 3 个包装**

在 `useElectron.ts` 的 `RemoveRecentSession`（39 行）之后追加：

```ts
export const GetFavorites = () => api().getFavorites();
export const AddFavorite = (record: any) => api().addFavorite(record);
export const RemoveFavorite = (sessionId: string) => api().removeFavorite(sessionId);
```

- [ ] **Step 2: 创建 `src/renderer/src/stores/favorites.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'
import { GetFavorites, AddFavorite, RemoveFavorite } from '../composables/useElectron'

export interface FavoriteSession extends RecentSession {
  favoritedAt: number
}

/** SessionMeta → RecentSession（加星/打开复用；字段名对齐 recent） */
export function toFavorite(meta: SessionMeta): RecentSession {
  return {
    sessionId: meta.id,
    workdir: meta.workdir,
    project: meta.project,
    aiTitle: meta.ai_title || '',
    firstPrompt: meta.first_prompt || '',
    lastOpenedAt: (meta.mtime || 0) * 1000,
    state: 'idle',
    userTitle: meta.user_title,
    agent: meta.agent,
  }
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<FavoriteSession[]>([])
  const loading = ref(false)

  async function loadFavorites() {
    loading.value = true
    try {
      const list = (await GetFavorites()) as FavoriteSessionRecordLike[]
      favorites.value = Array.isArray(list) ? list.map((r) => toFavoriteSession(r)) : []
    } catch (e: any) {
      console.error('[favorites] load failed:', e?.message || e)
      favorites.value = []
    } finally {
      loading.value = false
    }
  }

  async function addFavorite(meta: RecentSession) {
    if (isFavorite(meta.sessionId)) return
    const record: FavoriteSession = { ...meta, favoritedAt: Date.now() }
    try {
      await AddFavorite(record)
      favorites.value = [...favorites.value, record]
    } catch (e: any) {
      console.error('[favorites] add failed:', e?.message || e)
      throw e
    }
  }

  async function removeFavorite(sessionId: string) {
    try {
      await RemoveFavorite(sessionId)
      favorites.value = favorites.value.filter((r) => r.sessionId !== sessionId)
    } catch (e: any) {
      console.error('[favorites] remove failed:', e?.message || e)
      throw e
    }
  }

  function isFavorite(sessionId: string): boolean {
    return favorites.value.some((r) => r.sessionId === sessionId)
  }

  function toRecent(sessionId: string): RecentSession | null {
    const r = favorites.value.find((f) => f.sessionId === sessionId)
    if (!r) return null
    return { ...r, lastOpenedAt: r.favoritedAt, state: 'idle' }
  }

  return { favorites, loading, loadFavorites, addFavorite, removeFavorite, isFavorite, toRecent }
})

// 与主进程 FavoriteSessionRecord 结构对齐；标题/顺序已由主进程合并 recents
interface FavoriteSessionRecordLike {
  sessionId: string
  workdir: string
  project: string
  userTitle?: string
  aiTitle?: string
  firstPrompt?: string
  agent?: string
  favoritedAt: number
}

function toFavoriteSession(r: FavoriteSessionRecordLike): FavoriteSession {
  return {
    sessionId: r.sessionId,
    workdir: r.workdir,
    project: r.project,
    aiTitle: r.aiTitle || '',
    firstPrompt: r.firstPrompt || '',
    lastOpenedAt: r.favoritedAt,
    state: 'idle',
    userTitle: r.userTitle,
    agent: r.agent,
  }
}
```

> 注：toFavoriteSession 里 lastOpenedAt 用 favoritedAt 仅为占位，展示与打开路径都以 toRecent 为准。

- [ ] **Step 3: 扩展 `Icon.vue` 支持 star 与 fill**

`Icon.vue` 目前不透传 `fill` 且未注册 star。做两处小改（不属临时诊断代码，正常提交）：
1. `@lucide/vue` import 列表加入 `Star`；`icons` map 加 `star: Star`。
2. props 增加 `fill?: boolean`；模板 `<component>` 透传 `:fill="fill ? 'currentColor' : 'none'"`（保持既有 size/stroke-width 透传不变）。

- [ ] **Step 4: 创建 `src/renderer/src/components/FavoriteStar.vue`**

```vue
<template>
  <button
    class="fav-star"
    :class="{ active }"
    :aria-label="active ? '取消收藏' : '收藏会话'"
    :title="active ? '取消收藏' : '收藏会话'"
    @click.stop="$emit('toggle')"
  >
    <Icon name="star" :size="size" :fill="active" />
  </button>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import { computed } from 'vue'
import { useFavoritesStore } from '../stores/favorites'

const props = withDefaults(defineProps<{ sessionId: string; size?: number }>(), { size: 13 })
const emit = defineEmits<{ (e: 'toggle'): void }>()

const favorites = useFavoritesStore()
const active = computed(() => favorites.isFavorite(props.sessionId))
</script>

<style scoped>
.fav-star {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: 6px;
  color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
  padding: 0;
}
.fav-star:hover { background: var(--bg-input); color: var(--text-primary); }
.fav-star.active { color: var(--accent); }
</style>
```

> 空心态：`fill="none"` + 灰色描边；实心态（已收藏）：`fill="currentColor"` + `--accent`。语义清晰无需额外图标。

- [ ] **Step 5: vue-tsc 门禁**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: Commit（需授权）**

```bash
git add src/renderer/src/composables/useElectron.ts src/renderer/src/components/Icon.vue src/renderer/src/stores/favorites.ts src/renderer/src/components/FavoriteStar.vue
git commit -m "feat: 新增 favorites store 与 FavoriteStar 星标组件"
```

---

### Task 4: sessions store 提供有序全量历史列表（供弹窗/搜索）

**Files:**
- Modify: `src/renderer/src/stores/sessions.ts`
- Test: vue-tsc 门禁

**Interfaces:**
- Consumes: 现有 `ListSessions` IPC、`loadAllSessions()`。
- Produces:
  ```ts
  // stores/sessions.ts 追加返回项
  allOrdered: Ref<SessionMeta[]>; // ListSessions 全量，按 mtime 降序（最近活跃优先）
  async loadAllSessions(): Promise<void>; // 扩展：同时更新 allSessions map + allOrdered 数组
  ```
- [ ] **Step 1: 扩展 `loadAllSessions` 并新增 `allOrdered`**

在 `stores/sessions.ts` 中：

1. 在 `allSessions` ref 声明（约 72-73 行）旁追加 `const allOrdered = ref<SessionMeta[]>([])`。
2. 把 `loadAllSessions()`（78-87 行）改为同时维护有序数组（按 mtime 降序；`sort` 用 `b.mtime - a.mtime`）：
```ts
  async function loadAllSessions() {
    try {
      const all = (await ListSessions()) as SessionMeta[]
      const idx: Record<string, SessionMeta> = {}
      for (const s of all) idx[s.id] = s
      allSessions.value = idx
      allOrdered.value = [...all].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    } catch (e: any) {
      console.error('[sessions] loadAllSessions failed:', e?.message || e)
    }
  }
```
3. 在 return（约 458-467 行）中加入 `allOrdered`。

- [ ] **Step 2: vue-tsc 门禁**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit（需授权）**

```bash
git add src/renderer/src/stores/sessions.ts
git commit -m "feat: sessions store 增加按最近活跃排序的全量会话列表 allOrdered"
```

---

### Task 5: 打开会话弹窗 OpenSessionDialog + HomeView 接线

**Files:**
- Create: `src/renderer/src/components/OpenSessionDialog.vue`
- Modify: `src/renderer/src/views/HomeView.vue`
- Modify: `src/renderer/src/components/RecentSessionList.vue`（本 task 仅保证接收 list 并 emit；hover 星在 Task 7 加）
- Test: vue-tsc 门禁 + `npm run dev` 手动验证

**Interfaces:**
- Consumes:
  - `stores/favorites.ts`（收藏区数据）；`stores/sessions.ts`（`allOrdered`）；`useRecentStore`（历史搜索 composable 可选）。
  - `HomeView.onOpenRecent(item: RecentSession)`、`onCreateFromSession(...)`、现有 `NewSessionDialog`。
- Produces:
  - `OpenSessionDialog.vue` props `{ open: boolean }`；emits `close` / `create(...)`（复用 HomeView 新建链路）→ 顶层需 `recent.loadRecentSessions()` + `favorites.loadFavorites()` 由 HomeView 或 dialog 打开时触发。
  - HomeView：`showOpenSession` ref；`folder-open` 按钮改绑；`onOpenFavorite(sid)`；新建弹窗联动。

- [ ] **Step 1: 前置确认（已完成，无需动作）**

Task 3 已让 `Icon.vue` 注册 `star` 图标并支持 `fill` prop；本任务直接使用 `Icon name="star" :fill="..."` 与 `FavoriteStar` 即可。

- [ ] **Step 2: 创建 `OpenSessionDialog.vue`（骨架 + 收藏区 + 历史 + 新建跳转）**

关键结构（Teleport 层级对齐 `NewSessionDialog` / `CloseSessionDialog`；样式沿用其 CSS 变量）：

```vue
<template>
  <Teleport to="body">
    <div class="overlay" :class="{ open }" @click.self="open && $emit('close')">
      <div v-if="open" class="dialog">
        <div class="head">
          <h2>打开会话</h2>
          <div class="head-actions">
            <button class="new-btn" @click="$emit('create')">＋ 打开新目录 / 新建会话</button>
            <button class="close" aria-label="关闭" title="关闭" @click="$emit('close')"><Icon name="close" :size="14" /></button>
          </div>
        </div>
        <!-- 收藏区：无收藏整块隐藏 -->
        <template v-if="favList.length">
          <div class="fav-title">★ 收藏 ({{ favList.length }})</div>
          <div class="fav-items">
            <div v-for="item in favList" :key="item.sessionId" class="fav-item" @click="openFav(item.sessionId)">
              <span class="status-dot" :class="item.state" />
              <AgentBadge :agent="item.agent" size="sm" class="row-agent" />
              <span class="row-title" :title="display(item)">{{ display(item) }}</span>
              <FavoriteStar :session-id="item.sessionId" @toggle="removeFav(item.sessionId)" />
            </div>
          </div>
        </template>
        <!-- 最近历史（数据源 allOrdered 全量） -->
        <div class="hist-title">历史会话 · 共 {{ list.length }} 个</div>
        <div class="hist-search">…（与 NewSessionDialog 历史 tab 同款搜索框）</div>
        <div v-if="filtered.length" class="hist-scroll">
          <div v-for="s in filtered" :key="s.id" class="hist-item" @click="openSession(s)">
            <span class="status-dot" :class="stateClass(s.id)" />
            <AgentBadge :agent="s.agent" size="sm" class="row-agent" />
            <span class="row-title" :title="sessionDisplayTitle(s)">{{ sessionDisplayTitle(s) }}</span>
            <span class="row-meta">{{ s.project }}</span>
          </div>
        </div>
        <div v-else class="empty">{{ q ? '无匹配结果' : '暂无历史会话' }}</div>
      </div>
    </div>
  </Teleport>
</template>
```

逻辑要点（script setup）：
- props `{ open: boolean }`；emits `close`、`create`（打开新建）、`open`（由父级在 @open-recent 时复用）。
- `watch(() => props.open, ...)` 打开时：`favorites.loadFavorites()`；若 `sessions.allOrdered.length === 0` 则 `sessions.loadAllSessions()` 懒加载。
- `list` = `computed(() => sessions.allOrdered)`；`q`/`filtered` 本地 computed（对 project/title/workdir 子串过滤；无 q 返回全量）。
- `openSession(s: SessionMeta)`：`emit('open', toFavorite(s))`（复用 RecentSession）→ HomeView 收 `onOpenRecent`。
- `openFav(sid)`：`emit('open-fav', sid)`。
- `removeFav(sid)`：`favorites.removeFavorite(sid).catch(...)` + toast。
- 展示标题统一 `sessionDisplayTitle(s)`（SessionMeta 用 id 字段）；收藏项 `item` 是 FavoriteSession，构造 `{ id, user_title… }` 适配 `sessionDisplayTitle`。
- 样式：复制 `NewSessionDialog.vue` 的 `.overlay/.dialog/.head/.close`、历史 tab 的 `.history-search/.search-input`、`RecentSessionList.vue` 的 `.recent-item` 关键 class，改用主题变量，纵向滚动用 `.hist-scroll { overflow-y: auto }`。

- [ ] **Step 3: `HomeView.vue` 接线**

1. `const showNewSession = ref(false)` 旁加 `const showOpenSession = ref(false)`。
2. SessionList actions 的 `folder-open` 按钮 `@click="showNewSession = true"` 改为 `@click="showOpenSession = true"`。
3. 挂载处（onMounted）`void recent.loadRecentSessions()`（已有欢迎页触发）+ 追加 `void favorites.loadFavorites()`（引入 `useFavoritesStore`）。
4. 在 `<NewSessionDialog>` 标签旁渲染：
```vue
<OpenSessionDialog
  :open="showOpenSession"
  @close="showOpenSession = false"
  @create="showNewSession = true; showOpenSession = false"
  @open="onOpenRecent"
  @open-fav="onOpenFavorite"
/>
```
5. 新增 `onOpenFavorite`：
```ts
async function onOpenFavorite(sid: string) {
  const item = favorites.toRecent(sid)
  if (!item) return
  showOpenSession.value = false
  try {
    const wasActive = activeSessionId.value === sid
    sessions.open(item)
    tabsStore.openSession(sid, item.workdir, sessionDisplayTitle({ id: sid, user_title: item.userTitle, ai_title: item.aiTitle, first_prompt: item.firstPrompt }))
    await AdoptSession(sid, item.workdir)
    await OpenSessionTerminal(sid, item.workdir)
    await sessions.loadBotNames()
    if (item.botId) sessions.sessionBots = { ...sessions.sessionBots, [sid]: item.botId }
    if (wasActive && item.workdir) { trace.setSession(item.workdir, sid); trace.load() }
  } catch (e: any) {
    pushToast({ level: 'error', source: 'session', message: '打开收藏会话失败：' + (e?.message || e) })
  }
}
```
> 与 `onOpenRecent` 逻辑几乎一致；若差异小可直接内联复用，实现时以不重复为原则。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

（可选手测）Run: `npm run dev` → 点侧栏 `folder-open` 出现新弹窗；收藏区为空不显示；历史列表可滚动；「新建」跳转旧新建弹窗；关闭/打开收藏区行为正常。

- [ ] **Step 5: Commit（需授权）**

```bash
git add src/renderer/src/components/OpenSessionDialog.vue src/renderer/src/views/HomeView.vue
git commit -m "feat: 新增打开会话弹窗，folder-open 改为打开已有会话"
```

---

### Task 6: 侧栏会话列表顶部收藏分组

**Files:**
- Modify: `src/renderer/src/components/SessionList.vue`
- Modify: `src/renderer/src/components/SessionItem.vue`（仅补右上 hover 星标挂点，星标行为在 Task 7 一并完成时可合并）
- Modify: `src/renderer/src/views/HomeView.vue`（处理收藏分组点击 → onOpenRecent）
- Test: vue-tsc 门禁

**Interfaces:**
- Consumes: `stores/favorites.ts`。
- Produces:
  - `SessionList` 新增 props `{ favoritesOpen?: boolean }`（默认 true）与内部可折叠分组；新增 emits `open-fav(sessionId)`（供收藏分组点击）。
  - HomeView 在 `<SessionList>` 上接 `@open-fav="onOpenFavorite"`。

- [ ] **Step 1: SessionList 顶部渲染收藏分组**

在 `SessionList.vue` 的 `.content` 内、`.sidehead`（会话列表标题）**之前**插入收藏分组：

```vue
<template v-if="favorites.favorites.length">
  <div class="sidehead">
    <button class="sidehead-toggle" :title="favOpen ? '收起收藏' : '展开收藏'" @click="favOpen = !favOpen">
      <Icon :name="favOpen ? 'chevron-down' : 'chevron-right'" :size="12" />
      <span>收藏({{ favorites.favorites.length }})</span>
    </button>
  </div>
  <div v-show="favOpen" class="fav-items">
    <div
      v-for="item in favorites.favorites"
      :key="item.sessionId"
      class="fav-item"
      :class="{ active: item.sessionId === activeId }"
      @click="$emit('open-fav', item.sessionId)"
    >
      <AgentBadge :agent="item.agent" size="sm" class="row-agent" />
      <span class="fav-title" :title="favDisplay(item)">{{ favDisplay(item) }}</span>
      <FavoriteStar :session-id="item.sessionId" @toggle="onRemoveFav(item.sessionId)" />
    </div>
  </div>
</template>
```

script 增补：`const favOpen = ref(true)`、`const favorites = useFavoritesStore()`、`onRemoveFav(sid)`（`removeFavorite` + 失败 toast）、`favDisplay(item)` 用 `sessionDisplayTitle({ id: item.sessionId, user_title: item.userTitle, ai_title: item.aiTitle, first_prompt: item.firstPrompt, project: item.project })`。样式沿用 `SessionItem` 的行间距与主题变量。

- [ ] **Step 2: HomeView 传入 `@open-fav`**

`HomeView.vue` 中 `<SessionList …>` 加 `@open-fav="onOpenFavorite"`（Task 5 已实现 `onOpenFavorite`）。

- [ ] **Step 3: 验证 + Commit（需授权）**

Run: `cd src/renderer && npx vue-tsc --noEmit` 无错误。
```bash
git add src/renderer/src/components/SessionList.vue src/renderer/src/views/HomeView.vue
git commit -m "feat: 侧栏会话列表顶部增加收藏分组"
```

---

### Task 7: 列表项悬停星标 + 首页收藏置顶高亮

**Files:**
- Modify: `src/renderer/src/components/SessionItem.vue`
- Modify: `src/renderer/src/components/RecentSessionList.vue`
- Modify: `src/renderer/src/components/WelcomeTab.vue`
- Test: vue-tsc 门禁

**Interfaces:**
- Consumes: `stores/favorites.ts`（`isFavorite`）、`FavoriteStar.vue`、`toFavorite`（SessionMeta→RecentSession）。
- Produces:
  - `RecentSessionList`：每项右侧 hover 显示 FavoriteStar（点击收藏/取消，meta 由该项 RecentSession 提供）。
  - `WelcomeTab`：历史列表把收藏项排到最前；RecentSessionList 对收藏项实心高亮（isFavorite 决定星态，父级排序负责置顶）。

- [ ] **Step 1: SessionItem 补 hover 星标**

`SessionItem.vue` 模板末尾（`.dot` 状态点之后）加：

```vue
<FavoriteStar
  :session-id="props.meta.id"
  class="item-star"
  @toggle="onToggleFav"
/>
```

script 增补：
```ts
import FavoriteStar from './FavoriteStar.vue'
import { useFavoritesStore, toFavorite } from '../stores/favorites'
const favorites = useFavoritesStore()
async function onToggleFav() {
  if (favorites.isFavorite(props.meta.id)) {
    await favorites.removeFavorite(props.meta.id).catch((e: any) => pushToast({ level: 'error', source: 'session', message: '取消收藏失败：' + (e?.message || e) }))
  } else {
    await favorites.addFavorite(toFavorite(props.meta)).catch((e: any) => pushToast({ level: 'error', source: 'session', message: '收藏失败：' + (e?.message || e) }))
  }
}
```
样式：`.item-star { opacity: 0; transition: opacity .12s; }` + `.session-item:hover .item-star { opacity: 1; }` + `.item-star.active { opacity: 1; }`。

- [ ] **Step 2: RecentSessionList 每项 hover 星标 + 收藏实心态**

模板 `.recent-item` 内 `.meta` 后追加：

```vue
<FavoriteStar :session-id="item.sessionId" class="recent-star" @toggle="onToggle(item)" />
```

script：
```ts
import FavoriteStar from './FavoriteStar.vue'
import { useFavoritesStore } from '../stores/favorites'
const favorites = useFavoritesStore()
async function onToggle(item: RecentSession) {
  if (favorites.isFavorite(item.sessionId)) {
    await favorites.removeFavorite(item.sessionId).catch(() => {})
  } else {
    await favorites.addFavorite(item).catch(() => {})
  }
}
```
样式同 SessionItem：hover 浮现；`.active` 恒显示（已收藏项实心）。

- [ ] **Step 3: WelcomeTab 收藏项置顶**

`WelcomeTab.vue` 中给 RecentSessionList 传的重排列表（替换直接 `:list="filteredRecent"`）：

```ts
import { useFavoritesStore } from '../stores/favorites'
const favorites = useFavoritesStore()
const orderedRecent = computed(() => {
  const favIds = new Set(favorites.favorites.map((f) => f.sessionId))
  const favs = filteredRecent.value.filter((r) => favIds.has(r.sessionId))
  const rest = filteredRecent.value.filter((r) => !favIds.has(r.sessionId))
  return [...favs, ...rest]
})
```
模板改 `:list="orderedRecent"`；onMounted 里 `void favorites.loadFavorites()`。

- [ ] **Step 4: 验证 + Commit（需授权）**

Run: `cd src/renderer && npx vue-tsc --noEmit` 无错误。
```bash
git add src/renderer/src/components/SessionItem.vue src/renderer/src/components/RecentSessionList.vue src/renderer/src/components/WelcomeTab.vue
git commit -m "feat: 会话列表项悬停收藏星标，首页历史收藏置顶"
```

---

### Task 8: 顶部搜索升级为全量历史（收藏置顶）

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`
- Test: vue-tsc 门禁

**Interfaces:**
- Consumes: `stores/sessions.ts` 的 `allOrdered` / `loadAllSessions()`、`stores/favorites.ts`。
- Produces: 无新导出；HomeView 内 `searchQuery` 有值时 SessionList 接收"全量历史 + 收藏置顶"的过滤结果；首次进搜索懒加载 `loadAllSessions`。

- [ ] **Step 1: HomeView 搜索数据源切换 + 收藏置顶**

在 `HomeView.vue`：
1. `SessionList` 的 `:list` 从 `sessions.list` 改为 `searchResults`：
```ts
const searchResults = computed(() => {
  const q = (searchQuery.value || '').trim().toLowerCase()
  if (!q) return sessions.list
  const pool = sessions.allOrdered
  const matched = pool.filter((s) => {
    const pn = s.project.toLowerCase()
    const wd = s.workdir.toLowerCase()
    const title = (s.user_title || s.first_prompt || s.ai_title || '').toLowerCase()
    return pn.includes(q) || wd.includes(q) || title.includes(q) || s.id.toLowerCase().includes(q)
  })
  const favIds = new Set(favorites.favorites.map((f) => f.sessionId))
  const favs = matched.filter((s) => favIds.has(s.id))
  const rest = matched.filter((s) => !favIds.has(s.id))
  return [...favs, ...rest]
})
```
2. `openSearch()` 里触发懒加载：`if (sessions.allOrdered.length === 0) void sessions.loadAllSessions()`。
3. 确认 `searchQuery` 清空后回落 `sessions.list`（不改变原无搜索行为）。

- [ ] **Step 2: 验证 + Commit（需授权）**

Run: `cd src/renderer && npx vue-tsc --noEmit` 无错误。
```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "feat: 顶部搜索改为全量历史并收藏置顶"
```

---

### Task 9: NewSessionDialog 收敛为纯新建

**Files:**
- Modify: `src/renderer/src/components/NewSessionDialog.vue`
- Test: vue-tsc 门禁 + `npm run dev` 手测

**Interfaces:**
- Consumes: 无新接口。
- Produces: 移除「历史会话」tab 及相关引用（RecentSessionList / recent store / search composable / onRecent / recent 加载逻辑），默认直接展示"打开新目录"表单；文件仍作为新建入口（由 OpenSessionDialog「＋ 新建」按钮打开）。

- [ ] **Step 1: 精简 NewSessionDialog**

- 删除 `.tabs` 双 tab 区块、`tab` ref、`history` 相关分支（RecentSessionList / historySearch / useRecentSessionSearch / RecentSession import / `onRecent` / recent.loadRecentSessions）。
- watch props.open 时移除历史加载，仅保留表单复位 + 默认 home 目录。
- 标题保留「打开新目录」（此前弹窗由 folder-open 打开，现在由 OpenSessionDialog「＋ 新建」打开，标题改为更能表达新建语义；提交信息里体现该语义收敛）。

- [ ] **Step 2: 验证 + Commit（需授权）**

Run: `cd src/renderer && npx vue-tsc --noEmit` 无错误。
```bash
git add src/renderer/src/components/NewSessionDialog.vue
git commit -m "refactor: NewSessionDialog 收敛为纯新建会话入口"
```

---

## 交叉引用自查（自审清单）

| Spec 要求 | 对应 Task |
|---|---|
| D1 独立弹窗 + NewSessionDialog 收敛 | Task 5、9 |
| D2 会话级收藏 | Task 1（记录为会话）、Task 3、7 |
| D3① 弹窗顶部收藏区 | Task 5 |
| D3② 侧栏顶部收藏分组 | Task 6 |
| D3③ 首页历史收藏置顶高亮 | Task 7 |
| D3④ 搜索结果收藏置顶 | Task 8 |
| D4 悬停星标 | Task 3（组件）、7（集成） |
| D5 固定顺序（追加末尾） | Task 1（addFavorite push 末尾）、3 |
| D6 全量历史搜索（顶部） | Task 4（allOrdered）、8 |
| D7 独立 favorite-sessions.json、不进 cloud | Task 1、2 |
| D8 点收藏=复用 onOpenRecent | Task 5（onOpenFavorite） |
| 收藏不参与 cloud 上行 | Task 2（不触发 snapshot） |

## 交付后收尾

- 全量回归：`npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 手动验收清单：① folder-open 弹收藏区/历史/新建 ② 侧栏列表项 hover 加星→弹窗/首页/搜索结果同步 ③ 取消收藏同步消失 ④ 顶部搜索能搜到 30 条窗口外的老会话且收藏项置顶 ⑤ 点收藏项能 resume 打开 ⑥ 重启应用收藏仍在。
- 若期间未逐 task 提交：收尾一次性汇总 commit（需用户明确授权）。
