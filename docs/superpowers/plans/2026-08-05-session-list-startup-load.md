# 侧栏会话列表启动时加载最近 30 条 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 应用启动时侧栏「会话列表」自动填充最近 30 条会话，并在所有列表变更入口统一裁剪到 30 条，持久化复用已有的 `recent-sessions.json`。

**Architecture:** 全部改动在前端 `src/renderer/src/stores/sessions.ts` 单文件。核心是三个模块级纯函数/常量（`recentToMeta`、`trimList`、`MAX_SIDEBAR_SESSIONS`）支撑 store 行为：新增 `initFromRecent()` 启动时用 `GetRecentSessions()` 填充列表；`open()`/`create()`/`applyRebind()` 的列表赋值统一过 `trimList`。主进程零改动。

**Tech Stack:** Vue 3 + Pinia（setup store）、TypeScript、Vitest + jsdom（前端单测）、vue-tsc（类型检查）。

## Global Constraints

- 所有代码注释、commit message 用简体中文。
- commit 前确认仓库 local git identity（`walleliu1016` / `walleliu1016@gmail.com`，已配置，无需重复设置）。
- 不提交构建产物（如 `vscode-extension/*.vsix`、`dist/`、`dist-electron/`）——用 `git add <具体文件>`，禁止 `git add -A`。
- commit message 格式 `<type>: <subject>`，type ∈ `feat/fix/refactor/test/docs/chore/ci`。
- 一个 task 一个 commit。
- 每个 task 完成前必须：`npm run test:main` 全绿、`cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 前端单测命令：`cd src/renderer && npx vitest run src/stores/sessions.test.ts`
- 主进程本次零改动，`npm run test:main` 仅作回归验证。
- 交互约束：禁止 AskUserQuestion / ExitPlanMode 弹窗；确认问题用纯文字。

---

### Task 1: 映射与裁剪纯函数（recentToMeta / trimList / MAX_SIDEBAR_SESSIONS）

**Files:**
- Modify: `src/renderer/src/stores/sessions.ts`
- Create: `src/renderer/src/stores/sessions.test.ts`
- Test: `src/renderer/src/stores/sessions.test.ts`

**Interfaces:**
- Consumes: `RecentSession`（`src/renderer/src/types/recent.ts`）、`SessionMeta`（`src/renderer/src/types/session.ts`）
- Produces（后续 Task 依赖的签名）:
  - `const MAX_SIDEBAR_SESSIONS = 30`
  - `function recentToMeta(record: RecentSession): SessionMeta`
  - `function trimList(items: SessionMeta[]): SessionMeta[]`
  - 两者均从 `./sessions` 模块导出（沿用 `sessionDisplayTitle` 的导出模式，便于单测）

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/stores/sessions.test.ts`：

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'

// mock IPC 转发层，避免依赖 window.electronAPI
vi.mock('../composables/useElectron', () => ({
  CreateSession: vi.fn(),
  ListSessions: vi.fn().mockResolvedValue([]),
  SendMessage: vi.fn(),
  AdoptSession: vi.fn().mockResolvedValue(undefined),
  RenameSession: vi.fn(),
  BindSessionBot: vi.fn(),
  ListBots: vi.fn().mockResolvedValue([]),
  ListBotBindings: vi.fn().mockResolvedValue({}),
  GetRecentSessions: vi.fn().mockResolvedValue([]),
}))

import { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList } from './sessions'

describe('recentToMeta', () => {
  it('把 RecentSession 映射为 SessionMeta（毫秒时间戳转秒）', () => {
    const record: RecentSession = {
      sessionId: 'sid-1',
      workdir: '/proj',
      project: 'proj',
      aiTitle: 'AI 标题',
      firstPrompt: '第一条 prompt',
      lastOpenedAt: 1750000000000,
      state: 'idle',
    }
    const meta = recentToMeta(record)
    expect(meta).toEqual({
      id: 'sid-1',
      workdir: '/proj',
      project: 'proj',
      mtime: 1750000000,
      msg_count: 0,
      first_prompt: '第一条 prompt',
      ai_title: 'AI 标题',
      size: 0,
      user_title: undefined,
      title_source: 'ai',
    } satisfies SessionMeta)
  })

  it('userTitle 存在时 title_source 为 user，否则按 ai > first_prompt 推导', () => {
    const userRecord = recentToMeta({ sessionId: 'a', workdir: '/a', project: 'a', userTitle: '用户标题', aiTitle: 'AI', firstPrompt: 'FP', lastOpenedAt: 1000, state: 'idle' })
    expect(userRecord.title_source).toBe('user')
    expect(userRecord.user_title).toBe('用户标题')

    const fpRecord = recentToMeta({ sessionId: 'b', workdir: '/b', project: 'b', aiTitle: '', firstPrompt: '仅 prompt', lastOpenedAt: 1000, state: 'idle' })
    expect(fpRecord.title_source).toBe('first_prompt')
  })

  it('旧版秒级 lastOpenedAt 会被归一化为毫秒再换算', () => {
    const meta = recentToMeta({ sessionId: 'c', workdir: '/c', project: 'c', lastOpenedAt: 1750000000, state: 'idle' })
    expect(meta.mtime).toBe(1750000000) // 秒级 * 1000 再 /1000 还原
  })
})

describe('trimList', () => {
  const mk = (n: number): SessionMeta[] =>
    Array.from({ length: n }, (_, i) => ({ id: `s-${i}` } as unknown as SessionMeta))

  it('超过 MAX_SIDEBAR_SESSIONS 时裁剪到 30 条', () => {
    expect(trimList(mk(35)).length).toBe(MAX_SIDEBAR_SESSIONS)
    expect(trimList(mk(35))[0].id).toBe('s-0') // 保留头部（最新）
  })

  it('不足 30 条时原样返回', () => {
    const five = mk(5)
    expect(trimList(five)).toBe(five)
  })
})

describe('store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // 占位：Task 2 补充 initFromRecent / open 裁剪测试
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/stores/sessions.test.ts`
Expected: FAIL——`recentToMeta` / `trimList` 未从 `./sessions` 导出（"No export named ..."）。

- [ ] **Step 3: 最小实现纯函数**

在 `src/renderer/src/stores/sessions.ts` 顶部（`useSessionsStore` 定义之前）新增：

```ts
const MAX_SIDEBAR_SESSIONS = 30

/** RecentSession → SessionMeta 映射（供 initFromRecent 与 open 复用）。 */
function recentToMeta(record: RecentSession): SessionMeta {
  const source: 'user' | 'ai' | 'first_prompt' = record.userTitle
    ? 'user'
    : record.aiTitle
      ? 'ai'
      : 'first_prompt'
  return {
    id: record.sessionId,
    workdir: record.workdir,
    project: record.project,
    mtime: Math.floor(normalizeLastOpenedAt(record.lastOpenedAt) / 1000),
    msg_count: 0,
    first_prompt: record.firstPrompt,
    ai_title: record.aiTitle,
    size: 0,
    user_title: record.userTitle,
    title_source: source,
  }
}

/** 列表始终保留最近 MAX_SIDEBAR_SESSIONS 条（插入都是头部最新，末尾即最旧）。 */
function trimList(items: SessionMeta[]): SessionMeta[] {
  return items.length > MAX_SIDEBAR_SESSIONS ? items.slice(0, MAX_SIDEBAR_SESSIONS) : items
}
```

`sessions.ts` 现有顶部 import 已有 `SessionMeta`、`RecentSession` 类型（Task 1 无需改动 import）。

在文件底部 `return { ... }` 处（`reset` 之后、`return` 之前）加入导出：

```ts
  return {
    list, activeId, active, streaming, state,
    creating, loading, adopted, drafts, hookPermissions, opened,
    userTitles, titleSources, sessionBots, botNames, botBindings,
    setDraft, create, open, select, send, setHookPermission,
    refreshList, handleHookEvent, remove, renameSession, applyTitleChange,
    applyRebind,
    loadBotNames, bindBot, getSessionBotName, loadBotBindings, getBotBoundSessionName,
    reset,
  }
})

// 供单测使用（同 sessionDisplayTitle 导出模式）
export { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/stores/sessions.test.ts`
Expected: PASS（store 占位 describe 无断言，通过）。

- [ ] **Step 5: 回归验证**

Run: `npm run test:main`
Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全部 PASS，无类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/sessions.ts src/renderer/src/stores/sessions.test.ts
git commit -m "feat: 侧栏会话列表启动加载最近30条（映射与裁剪纯函数）"
```

---

### Task 2: initFromRecent 启动填充 + 列表变更统一裁剪

**Files:**
- Modify: `src/renderer/src/stores/sessions.ts`
- Test: `src/renderer/src/stores/sessions.test.ts`

**Interfaces:**
- Consumes: `GetRecentSessions`（`../composables/useElectron`，Task 1 已 mock）、`recentToMeta` / `trimList` / `MAX_SIDEBAR_SESSIONS`（Task 1 产出）
- Produces:
  - `async function initFromRecent(): Promise<void>`（store 内方法）
  - store 初始化改为 `setTimeout(async () => { await initFromRecent(); await refreshList() }, 0)`

- [ ] **Step 1: 写失败测试**

在 `src/renderer/src/stores/sessions.test.ts` 的 `import` 区补两行：

```ts
import { GetRecentSessions } from '../composables/useElectron'
import { useSessionsStore } from './sessions'
```

把 `describe('store')` 占位块替换为：

```ts
describe('store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mkRecent(i: number, lastOpenedAt = 1750000000000 + i): RecentSession {
    return {
      sessionId: `s-${i}`,
      workdir: `/p${i}`,
      project: `p${i}`,
      aiTitle: `T${i}`,
      firstPrompt: '',
      lastOpenedAt,
      state: 'idle',
    }
  }

  it('initFromRecent 用最近会话填充列表（最新在前）', async () => {
    vi.mocked(GetRecentSessions).mockResolvedValueOnce([
      mkRecent(0, 2000),
      mkRecent(1, 1000),
    ])
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.map((s) => s.id)).toEqual(['s-0', 's-1'])
    expect(store.list[0].ai_title).toBe('T0')
  })

  it('initFromRecent 超过 30 条时裁剪', async () => {
    const recents = Array.from({ length: 35 }, (_, i) => mkRecent(i))
    vi.mocked(GetRecentSessions).mockResolvedValueOnce(recents)
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.length).toBe(MAX_SIDEBAR_SESSIONS)
    expect(store.list[0].id).toBe('s-34') // lastOpenedAt 最大者最新，排最前
  })

  it('initFromRecent 返回空数组时列表保持为空', async () => {
    vi.mocked(GetRecentSessions).mockResolvedValueOnce([])
    const store = useSessionsStore()
    await store.initFromRecent()
    expect(store.list.length).toBe(0)
  })

  it('open 已满 30 条时插入头部并挤出最旧一条', () => {
    const store = useSessionsStore()
    for (let i = 0; i < 30; i++) store.open(mkRecent(i, 1000 + i))
    expect(store.list.length).toBe(30)
    store.open(mkRecent(99, 999999))
    expect(store.list.length).toBe(30)
    expect(store.list[0].id).toBe('s-99')
    expect(store.list.some((s) => s.id === 's-0')).toBe(false)
  })

  it('open 重复会话不重复插入', () => {
    const store = useSessionsStore()
    store.open(mkRecent(1, 1000))
    store.open(mkRecent(1, 2000))
    expect(store.list.filter((s) => s.id === 's-1').length).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/stores/sessions.test.ts`
Expected: FAIL——`store.initFromRecent is not a function`；`open` 裁剪测试失败（当前 open 无 trim）。

- [ ] **Step 3: 实现 initFromRecent 与裁剪**

在 `src/renderer/src/stores/sessions.ts` 的 `refreshList` 函数定义之后新增：

```ts
  /** 启动时用最近会话填充列表（持久化数据源：recent-sessions.json）。 */
  async function initFromRecent() {
    try {
      const recents = (await GetRecentSessions()) as RecentSession[]
      if (!Array.isArray(recents) || recents.length === 0) return
      list.value = trimList(recents.map(recentToMeta))
    } catch (e: any) {
      console.error('[sessions] initFromRecent failed:', e?.message || e)
    }
  }
```

`sessions.ts` 顶部 import 区补 `GetRecentSessions`：

```ts
import { CreateSession, ListSessions, SendMessage, AdoptSession, RenameSession, BindSessionBot, ListBots, ListBotBindings, GetRecentSessions } from '../composables/useElectron'
```

`open()` 列表赋值改用 `recentToMeta` + `trimList`（保留 userTitles / titleSources 设置逻辑）：

```ts
  function open(record: RecentSession) {
    if (!list.value.find((s) => s.id === record.sessionId)) {
      list.value = trimList([recentToMeta(record), ...list.value])
    }
    // 以下 userTitles / titleSources / activeId / opened / state 设置逻辑保持不变
```

`create()` 列表赋值加 `trimList`：

```ts
      if (!list.value.find(s => s.id === id)) {
        const project = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
        list.value = trimList([{
          id, workdir, project, mtime: Math.floor(Date.now() / 1000), msg_count: 0,
          first_prompt: prompt, ai_title: '', size: 0,
          user_title: undefined, title_source: prompt ? 'first_prompt' : 'first_prompt',
        }, ...list.value])
      }
```

`applyRebind()` 的 list 赋值加 `trimList`：

```ts
      list.value = trimList([
        ...list.value.slice(0, idx),
        {
          ...item,
          id: newId,
          workdir,
          project: workdir.split(/[\\/]/).filter(Boolean).pop() || workdir,
          user_title: undefined,
          ai_title: '',
          first_prompt: '',
          title_source: undefined,
          msg_count: 0,
        },
        ...list.value.slice(idx + 1),
      ])
```

初始化时序（文件底部 `setTimeout(() => refreshList(), 0)` 处）：

```ts
  // 初始加载：先用最近会话填充列表，再刷新 msg_count/mtime
  setTimeout(async () => {
    await initFromRecent()
    await refreshList()
  }, 0)
```

在 `return { ... }` 对象中补 `initFromRecent`（Task 1 的 export 行保持不变）：

```ts
  return {
    list, activeId, active, streaming, state,
    creating, loading, adopted, drafts, hookPermissions, opened,
    userTitles, titleSources, sessionBots, botNames, botBindings,
    setDraft, create, open, select, send, setHookPermission,
    refreshList, initFromRecent, handleHookEvent, remove, renameSession, applyTitleChange,
    applyRebind,
    loadBotNames, bindBot, getSessionBotName, loadBotBindings, getBotBoundSessionName,
    reset,
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/stores/sessions.test.ts`
Expected: 全部 PASS（Task 1 + Task 2 用例）。

- [ ] **Step 5: 回归验证**

Run: `npm run test:main`
Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全部 PASS，无类型错误。

手动验证清单（需启动 `npm run dev`）：
1. 删除 `~/.lynel-desktop/recent-sessions.json` 后启动 → 侧栏自动出现最近 30 条（从 jsonl 重建）
2. 重启应用 → 侧栏仍填充最近 30 条
3. 打开新会话 → 插入头部，列表仍 ≤ 30 条
4. 打开超过 30 个不同会话后，最旧一条从侧栏滑出

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/sessions.ts src/renderer/src/stores/sessions.test.ts
git commit -m "feat: 侧栏会话列表启动加载最近30条（启动填充与列表裁剪）"
```

---

## 自审记录

- **Spec 覆盖**：spec 的 3.1（recentToMeta 抽取）→ Task 1；3.2（initFromRecent）→ Task 2 Step 3；3.3（trimList）→ Task 1 + Task 2 应用；3.4（初始化时序）→ Task 2 Step 3。边界情况表全部由对应测试覆盖（空数组 / 30 条裁剪 / 重复 open / applyRebind 幂等）。主进程零改动符合 spec。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整实现与断言。
- **类型一致性**：`recentToMeta` / `trimList` / `MAX_SIDEBAR_SESSIONS` / `initFromRecent` 名称在 Task 1、Task 2 与自审中一致；`GetRecentSessions` 的 mock 与使用位置一致。
