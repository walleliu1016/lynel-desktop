# 侧栏会话列表启动时加载最近 30 条 设计文档

**日期：** 2026-08-05
**状态：** 待审批

---

## 1. 问题

侧栏「会话列表」（SessionList）在应用启动时是**空**的，用户必须通过「新建会话」或从「最近会话」面板打开后，条目才会进入列表。重启应用后列表又变空，体验断裂。

### 根因

`stores/sessions.ts` 的 `refreshList()` 设计为**只更新已有条目的 msg_count/mtime，不追加新条目**（sessions.ts:199-207）——列表条目仅由 `open()`（从最近会话打开）和 `create()`（新建会话）控制。而初始化时 `setTimeout(() => refreshList(), 0)` 拉到的 `app:listSessions` 全量数据不会被写入空列表，因此启动后列表为空。

「最近会话」面板（`recent-sessions.json`）则已经持久化最近 30 条、按 `lastOpenedAt` 降序、启动时若为空从 jsonl 惰性重建（app.ts:238-254），行为完整。

### 目标

- 侧栏「会话列表」启动时自动填充最近 30 条会话
- 数据持久化（复用已有的 `recent-sessions.json`，不新增存储文件）
- 列表始终保持最近 30 条

---

## 2. 方案

**核心思路：** sessions store 启动时用 `GetRecentSessions()` 的数据填充侧栏列表，并在所有 list 变更入口统一裁剪到 30 条。主进程零改动（`app:getRecentSessions` 已返回按 lastOpenedAt 降序的 30 条）。

### 2.1 数据流

```
启动
 └─ sessions store 初始化
     ├─ initFromRecent(): GetRecentSessions() → 映射为 SessionMeta → list
     └─ refreshList(): 更新各条目的 msg_count / mtime
之后
 └─ 新建/打开会话 → open()/create() 插头部 → trimList() 裁到 30 条
```

### 2.2 排序

沿用 recent 的 `lastOpenedAt` 降序（「最近打开」优先）。后续 `open()`/`create()` 都是插入头部（最新在前），与排序一致。

---

## 3. 改动点（全部在前端 `src/renderer/src/stores/sessions.ts`）

### 3.1 抽取公共映射函数（DRY）

`open()`（sessions.ts:154-182）内嵌的 `RecentSession → SessionMeta` 映射逻辑抽出为模块级函数：

```ts
function recentToMeta(record: RecentSession): SessionMeta {
  const source = record.userTitle ? 'user' : (record.aiTitle ? 'ai' : 'first_prompt')
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
```

`open()` 改用该函数；`initFromRecent()` 复用。

### 3.2 新增 `initFromRecent()`

```ts
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

- 失败时列表保持空，回退现状，不阻塞启动
- 不覆盖已存在条目（启动时空列表，`map` 后直接赋值）

### 3.3 新增 `trimList()`（30 条上限）

```ts
function trimList(items: SessionMeta[]): SessionMeta[] {
  return items.length > MAX_SIDEBAR_SESSIONS ? items.slice(0, MAX_SIDEBAR_SESSIONS) : items
}
```

`MAX_SIDEBAR_SESSIONS = 30`。因为插入都是头部最新，末尾即最旧，`slice(0, 30)` 即「保持最近 30 条」。

在 `initFromRecent` / `open` / `create` / `applyRebind` 的 list 赋值处统一调用 `trimList`。

### 3.4 初始化时序

将现有 `setTimeout(() => refreshList(), 0)`（sessions.ts:347）改为：

```ts
setTimeout(async () => {
  await initFromRecent()
  await refreshList()
}, 0)
```

`refreshList()` 保持现状（只更新已有条目的 msg_count/mtime），确保填充后的条目显示真实消息数与活动时间。

---

## 4. 边界情况

| 场景 | 行为 |
|------|------|
| `GetRecentSessions()` 失败 | 列表保持空，回退现状，不阻塞启动 |
| recent 文件为空 | 主进程 `getRecentSessions` 会从 jsonl 重建最近 30 条 |
| 打开第 31 个不同会话 | `open()` 插头部后 `trimList` 裁掉最旧 1 条 |
| `/clear` 迁移（`applyRebind`） | 旧 id 原地换成新 id，条数不变，`trimList` 为幂等 |
| 关闭会话（`remove`） | 删除条目，条数减少，不受 30 条影响 |
| 搜索过滤 | 前端 `filteredList` 在 list 基础上过滤，不受影响 |

---

## 5. 测试

- 主进程 `npm run test:main` 必须全绿（本次主进程零改动，验证回归）
- 前端类型检查 `cd src/renderer && npx vue-tsc --noEmit`
- 手动验证：
  1. 首次启动（recent 文件为空）→ 侧栏自动出现最近 30 条（从 jsonl 重建）
  2. 启动后侧栏条目数量 ≤ 30
  3. 打开新会话 → 插入头部，列表仍 ≤ 30 条
  4. 重启应用 → 侧栏列表仍填充最近 30 条（持久化生效）
