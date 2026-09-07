# 打开会话弹窗与收藏功能 设计文档

日期：2026-09-07
状态：已评审（待实施计划）

## 背景与目标

用户回到旧会话继续工作的入口分散且薄弱：

- 左侧栏 `folder-open`「打开 Session」按钮弹出的其实是**新建会话对话框**（`NewSessionDialog`，含「历史会话 / 打开新目录」双 tab），历史会话只是附属（recent 前 10 条）。
- 侧栏会话列表只展示手动打开过的最近 30 条（`MAX_SIDEBAR_SESSIONS = 30`）。
- 首页历史会话区只展示前 5 条。
- 顶部搜索只搜侧栏 30 条，覆盖不到更早的会话。
- **收藏概念完全不存在**。

本次目标：

1. 让 `folder-open` 按钮专注「打开已有会话」：新增独立弹窗，突出收藏 + 全量历史 + 搜索。
2. 新增**会话收藏**能力：悬停加星、固定顺序、快速打开。
3. 收藏会话在**多个入口**一致展示（弹窗 / 侧栏 / 首页 / 搜索结果），状态全局同步。
4. 顶部搜索升级为**全部历史会话**搜索，收藏项置顶。

## 关键决策（与用户逐条确认）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 弹窗定位 | **拆独立**：`folder-open` → 新的「打开会话」弹窗（收藏+历史+搜索）；新建能力收敛（NewSessionDialog 只留「打开新目录/新建」）。 |
| D2 | 收藏粒度 | **会话级**收藏（星标某次对话，点开即 resume）。 |
| D3 | 收藏展示位置 | **四处**：① 打开会话弹窗顶部 ② 侧栏会话列表顶部收藏分组 ③ 首页历史会话置顶高亮 ④ 搜索结果收藏置顶+星标。 |
| D4 | 加星交互 | **悬停星标**：鼠标悬停列表项时右侧浮现星标图标，点击切换收藏。 |
| D5 | 收藏排序 | **固定顺序**：按加星先后排列，新增追加末尾，取消即移除，不随时间跳动。 |
| D6 | 搜索范围 | **全量历史搜索**（主进程 `ListSessions`/`jsonl.scanAll` 已具备），懒加载 + 缓存 + 内存过滤，收藏置顶。 |
| D7 | 收藏存储 | **独立 `favorite-sessions.json`**，生命周期独立于 recents 30 条滚动淘汰；**不参与 cloud 上行**。 |
| D8 | 点收藏项行为 | 复用现「打开最近会话」链路（AdoptSession + OpenSessionTerminal + 开 tab）。 |

## 现状关键事实

- 侧栏 `folder-open`（`HomeView.vue`）目前 `@click="showNewSession = true"` → `NewSessionDialog`。
- recents 持久化 `~/.lynel-desktop/recent-sessions.json`（`RecentSessionRecord`，上限 30，按 `lastOpenedAt` 降序），IPC：`app:getRecentSessions / addRecentSession / removeRecentSession`，实现于 `app.ts` 顶部模块函数。
- Cloud 会话同步上行集合 = `readRecentSessions()`（30 条）+ 运行中进程（`app.ts sendCloudSessionSnapshot`），**不使用** `jsonl.scanAll()`；全量扫描仅用于 `app:listSessions` 等本地返回接口。
- 渲染端 `stores/sessions.ts`：`sessions.list` = 手动 open/create 过的最近 30 条；`loadAllSessions()` 已能把全量 `ListSessions` 结果建索引到 `allSessions`（现仅用于绑定会话反查）。
- `HomeView.onOpenRecent(item: RecentSession)` 已实现"Adopt + OpenTerminal + 开 tab + 云 bot 绑定"完整打开链路，可直接复用。
- `RecentSessionList.vue` 被 `NewSessionDialog`（历史 tab）与 `WelcomeTab`（首页历史区）复用，`limit` 分别 10 / 5。

## 架构与组件

### 主进程

新增 `src/main/favorites.ts`（函数式，风格仿 `recent-sessions` 逻辑，不引入类）：

```ts
interface FavoriteSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle?: string;
  firstPrompt?: string;
  userTitle?: string;
  agent?: AgentKind;
  favoritedAt: number; // 收藏顺序依据（升序 = 先收藏在前，追加末尾）
}
```

- 落盘路径 `~/.lynel-desktop/favorite-sessions.json`。
- 导出 `readFavoriteSessions / writeFavoriteSessions / addFavorite / removeFavorite`。
- 文件读写失败只记日志不抛异常（与 recents 一致，保证不阻塞主进程）。

`app.ts` 注册 IPC（与 recent handler 并列，不触发 cloud 快照）：

- `app:getFavorites`：按 `favoritedAt` 升序返回；对仍在 recents 里的收藏项，用 recents 的最新标题/agent 字段覆盖快照（参照 `mergeRecentAgentField` 思路），保证展示标题不过期。
- `app:addFavorite(record)`：已存在则忽略（幂等），否则 `favoritedAt = Date.now()` push。
- `app:removeFavorite(sessionId)`：过滤后写盘。

> MVP 不做「删除会话时自动清收藏」。若收藏会话的 jsonl 已不存在，点开走现有错误 toast，用户悬停实心星取消即可（自然移除入口）。

### 渲染端

**新增 store** `src/renderer/src/stores/favorites.ts`（Pinia setup 风格）：

- state：`favorites: FavoriteSession[]`（有序）、`loading`。
- 前端收藏元素与 `RecentSession` 字段对齐并追加 `favoritedAt`（便于直接喂 `onOpenRecent`）：
  ```ts
  interface FavoriteSession extends RecentSession { favoritedAt: number }
  ```
- actions：`loadFavorites / addFavorite(meta) / removeFavorite(id) / toggle(meta)`；辅助 `isFavorite(id)`。
- add/remove 失败回滚本地 + toast，界面不致错乱。
- **所有列表读同一 store** → 一处加星，四处（弹窗/侧栏/首页/搜索）实时同步。

**新增组件**：

- `OpenSessionDialog.vue`：Teleport 到 body（层级对齐 `CloseSessionDialog`）。结构见下方「UI 布局」。
- `FavoriteStar.vue`：props `{ meta }`（收藏所需快照）；内部调 favorites store，读 `isFavorite` 显示实心/空心星（lucide `star`），点击 `@click.stop` 切换，不冒泡触发选中打开。hover 态样式按组件父级展示。

**改动组件**：

- `views/HomeView.vue`
  - `folder-open` 按钮 `showNewSession` → 改为 `showOpenSession`（打开 `OpenSessionDialog`）。
  - 挂载时 `loadFavorites()`。
  - 顶部搜索：有查询时结果集改为"全量历史（`allSessions` 内存过滤）且收藏置顶"，无查询仍显示 `sessions.list`；首次进搜索触发 `loadAllSessions()` 懒加载。收藏项打开走 `onOpenRecent`。
  - `OpenSessionDialog` 内「新建＋」次级入口仍复用 `NewSessionDialog`；新建成功沿用现有 `onCreateFromSession` 逻辑。
- `components/SessionList.vue`
  - 列表上方新增**收藏分组**（可折叠 `★ 收藏 (n)`）：无收藏整块隐藏；每项 hover 星标可取消、点击该项触发 `openRecent` 打开（该分组数据源为 favorites store，独立于 `sessions.list` 的 30 条）。
- `components/SessionItem.vue`：右侧 hover 浮现 `FavoriteStar`；收藏态实心星始终显示。
- `components/RecentSessionList.vue`：每项右侧 hover 星标；渲染时对「收藏项」实心高亮（供首页使用）。
- `components/WelcomeTab.vue`：历史会话区把收藏项排到最前并高亮。
- `components/NewSessionDialog.vue`：移除「历史会话」tab，收敛为纯「打开新目录 / 新建」。
- `composables/useElectron.ts`：新增 `GetFavorites / AddFavorite / RemoveFavorite` 三个 IPC 包装（该文件是唯一接触 `window.electronAPI` 的文件）。

## UI 布局

**folder-open 打开的 OpenSessionDialog**

```
┌ 打开会话 ──────────────────────────── [新建＋] [×]
│ ★ 收藏                        (n)
│   ┌──────────────────────────────────┐
│   │ ● 收藏会话A标题 · proj      [★]   │
│   │ ● 收藏会话B标题 · proj      [★]   │
│   └──────────────────────────────────┘
│ ─ 全部历史 ──────────────────────────
│   🔍 搜索（项目/标题/目录） 共 xx 个
│   ├ ● 会话1标题 · proj/yyy            ← 点击=打开（resume）
│   ├ ● 会话2标题 · proj/xxx      [☆]  ← hover 出现空星=可加收藏
│   └ …（滚动）
```

**侧栏会话列表（收藏分组在会话列表上方，可折叠）**

```
▾ ★ 收藏 (2)                    ← 无收藏隐藏
   ● 收藏A · proj        [★]
▾ 会话列表 (30)
   ● 最近会话1 …
```

**首页历史会话**：收藏项置顶 + 实心星；**搜索结果**：收藏项置顶 + 实心星。

交互组件统一：悬停 `FavoriteStar`（空心→点击收藏→实心；实心 hover 点击→取消）。

## 数据流

- **加星**：悬停点星 → `favorites.addFavorite(meta)` → `AddFavorite` IPC → 主进程写盘 → 本地 store 追加末尾；所有入口读同一 store 即时反映。
- **取消收藏**：点实心星 → `removeFavorite` → IPC 过滤写盘 → store 移除。
- **打开收藏项**：点击收藏项本体 → 构造 `RecentSession` → `HomeView.onOpenRecent` → Adopt + OpenTerminal + 开 tab + 云 bot 绑定（全复用现链路）。
- **展示标题保鲜**：主进程 `getFavorites` 时对仍处 recents 的收藏项用 recents 最新标题覆盖；首页/侧栏/搜索优先用各列表已有 meta。

## 错误处理

- 打开收藏会话失败（jsonl 缺失/已 terminate）：沿用 `onOpenRecent` catch → toast「打开最近会话失败…」；用户悬停实心星取消。
- 收藏区/分组为空：整块隐藏，不占位。
- add/remove 写盘失败：本地回滚 + toast。
- 全量搜索：`loadAllSessions` 懒加载 + 缓存，内存过滤；避免每次击键触发主进程 `scanAll`，不拖累 PTY/cloud 关键路径。

## 测试

- 主进程（`tests/main/`）：`favorites.ts` 读写（add 幂等 / remove / 顺序保持 / 快照字段 / recents 标题合并），临时目录。
- 渲染（vitest）：favorites store toggle 状态切换。
- 门禁：commit 前 `npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit` 全绿。

## 影响文件清单

主进程：
- 新增 `src/main/favorites.ts`
- 改 `src/main/app.ts`（IPC 注册 + 顶部 helpers 组装）

渲染端：
- 新增 `src/renderer/src/stores/favorites.ts`
- 新增 `src/renderer/src/components/OpenSessionDialog.vue`
- 新增 `src/renderer/src/components/FavoriteStar.vue`
- 改 `src/renderer/src/views/HomeView.vue`
- 改 `src/renderer/src/components/SessionList.vue`
- 改 `src/renderer/src/components/SessionItem.vue`
- 改 `src/renderer/src/components/RecentSessionList.vue`
- 改 `src/renderer/src/components/WelcomeTab.vue`
- 改 `src/renderer/src/components/NewSessionDialog.vue`
- 改 `src/renderer/src/composables/useElectron.ts`

## 非目标（YAGNI）

- 不做收藏项手动拖拽排序（后续迭代）。
- 不做目录/项目级收藏（D2 已定为会话级）。
- 收藏不同步云端（保持本地功能）。
- 不做删除会话自动清理收藏的复杂联动（MVP 用打开失败 toast + 悬停取消兜底）。
- 不设收藏硬上限（展示区可滚动）。
