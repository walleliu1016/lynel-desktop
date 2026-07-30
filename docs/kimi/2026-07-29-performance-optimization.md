# 性能优化：UI 卡顿排查与修复（2026-07-29）

## 背景

用户反馈 UI 卡顿。经排查，卡顿主因不在 xterm 渲染本身，而是**流式输出期间的全链路放大效应**：PTY 每个 chunk 一条 IPC、jsonl 每次变化触发全量重扫、每个 SSE delta 同步写盘，三件事叠加在主进程同一事件循环上，且与渲染进程的高频小消息互相争抢。

## 问题清单与优化方式

### P0-1 PTY 输出逐 chunk 直推 IPC，无合帧

- **现象**：node-pty `onData` 每个 chunk 触发一次 `bus.emit('session:<id>')`，而 `App.setWindow` 把 bus 所有事件 monkey-patch 成 `webContents.send`，终端刷屏时每秒数百条跨进程消息。
- **位置**：`src/main/app.ts` `wirePty` 的 `onData`；`setWindow` 的 bus emit patch。
- **优化**：新增 `src/main/output-batcher.ts`，按 ~16ms 窗口把同一 session 的 chunk 拼接成一条再 emit。`session.appendBuffer` 本地缓冲仍逐 chunk 追加，不受影响。

### P0-2 jsonl 文件变化 → 全量重扫所有历史会话

- **现象**：chokidar 监听整个 `~/.claude/projects`，500ms debounce 后只发无路径的 `sessions:list:changed`；前端随即 `refreshList()` → `scanAll()` **逐行读完所有项目的所有 jsonl**（无任何缓存）。活跃会话期间 Claude 持续写 jsonl，等于每 500ms 一次几十 MB 读盘 + 逐行 JSON.parse。
- **位置**：`src/main/jsonl.ts` `scanAll` / `scanFileMeta` / `watchProjects`。
- **优化**：`scanFileMeta` 加 (mtimeMs, size) 为键的 LRU 缓存（上限 1024），文件未变直接命中，全量重扫变成 stat-only。`setRoot` 与文件 `unlink` 时正确失效。watch 带路径的方案被缓存覆盖，未改 IPC 协议。

### P0-3 死数据链路：`sessions.messages` 全量拉了但没有任何组件消费

- **现象**：每次 `sessions:list:changed` 前端都 `reloadFromJsonl(activeId)` 全量拉取活跃会话所有消息（含 base64 图片），深度响应化存入 Pinia，但全前端无组件消费。
- **位置**：`src/renderer/src/composables/useEventStream.ts`、`src/renderer/src/stores/sessions.ts`。
- **优化**：整条链路删除（含 `loadHistory`/`loadMore`/`parseBlocks` 及 `useElectron.ts` 的 `GetSessionMessages` 封装）。

### P0-4 SSE delta 热路径上的同步 IO 与重复 IPC

- **现象**：① `HappyJsonlWriter.append` 每个 envelope `fs.appendFileSync` 同步写盘；② `writeRawExchange` 对大 record 做 `JSON.stringify(record, null, 2)` + `writeFileSync`；③ `sessions:activity` 每个 text envelope 发一条 IPC，phase 几乎总是重复的 `streaming`。
- **位置**：`src/main/archive/happyJsonl.ts`、`src/main/archive/rawArchive.ts`、`src/main/channels/state-channel.ts`。
- **优化**：① 改 Promise 串行队列异步写（保证行序，失败只打日志）；② 去 pretty-print、改 `fs.promises` 异步写 + rename，调用点 fire-and-forget + catch；③ activity 按 `(phase, tool, toolInput)` 去重，与上次相同则跳过。

### P1 electron-store 状态写全量同步落盘

- **现象**：每次 activity persist 都 `instanceStore.set(...)`，触发整个 store JSON 序列化 + 原子写盘，且 `sessions.*` key 只增不减。
- **位置**：`src/main/app.ts` `setSessionState`。
- **优化**：1s 防抖合并（per-key 只留最新值），`shutdown()` 时 flush；`getSessionStates` 读取侧对待写值做穿透，避免读到旧值。

### P2 trace 面板死数据与大对象深度响应化

- **现象**：`doLoad()` 每次刷新同步 `readFileSync` 整个 envelopes.jsonl 到前端，无组件消费；`trace.detail` 是 MB 级 raw exchange，深度响应化导致点详情卡顿。
- **位置**：`src/renderer/src/stores/trace.ts`。
- **优化**：删除 `ListHappyEnvelopes` 拉取及 `envelopes` ref（含 `useElectron.ts` 封装）；`detail` 改 `shallowRef`。

### P2 SessionItem 每实例重复拉 bot 列表

- **现象**：每个 `SessionItem` mount 都调 `botsStore.load()`，N 个会话 = N 次重复 IPC。
- **优化**：`stores/bots.ts` 的 `load()` 加"已加载/加载中"去重；`save()`/`remove()` 改 `load(true)` 强制刷新。

## 修改内容

### 前端 `src/renderer/`

| 文件 | 改动 |
|---|---|
| `composables/useEventStream.ts` | 删除 `reloadFromJsonl` 调用，保留 `refreshList` |
| `stores/sessions.ts` | 删除 messages 死链路（`messages`/`historyOffset`/`hasMore` ref、`loadHistory`/`loadMore`/`reloadFromJsonl`、`parseBlocks` 等） |
| `composables/useElectron.ts` | 删除 `GetSessionMessages`、`ListHappyEnvelopes` 封装（preload/主进程侧未动） |
| `stores/trace.ts` | `doLoad` 去掉 `ListHappyEnvelopes`；`detail` 改 `shallowRef` |
| `stores/bots.ts` | `load()` 去重 + `force` 参数 |

### 主进程 `src/main/`

| 文件 | 改动 |
|---|---|
| `output-batcher.ts`（新增） | PTY 输出 16ms 合帧器：push/flush/clear，flush 保序（exit/回放前强制 flush），clear 防 timer 持有已销毁 session |
| `app.ts` | 接线 OutputBatcher；electron-store 写 1s 防抖 + shutdown flush + 读穿透；`setOnRemove` 清理 batcher |
| `jsonl.ts` | `scanFileMeta` LRU 缓存（导出 `clearFileMetaCache`、`scanFileMeta` 供测试） |
| `archive/happyJsonl.ts` | append 改 Promise 串行队列异步写，`close()` 等队列排空 |
| `archive/rawArchive.ts` | `writeRawExchange` 改 async：紧凑 JSON + `fs.promises` 写盘/rename |
| `apiproxy.ts` | `finalizeExchange` 落盘改 fire-and-forget + catch 打日志 |
| `channels/state-channel.ts` | `emitActivity` 按 (phase, tool, toolInput) 去重 |

### 测试 `tests/main/`

| 文件 | 改动 |
|---|---|
| `output-batcher.test.ts`（新增） | 合帧、独立 session、flush 保序、clear 丢弃等 6 例 |
| `channels/state-channel.test.ts`（新增） | 去重、phase 变化、A→B→A、跨 session 隔离等 6 例 |
| `jsonl.test.ts` | 新增缓存命中/失效测试（构造固定 stat，避开文件系统 mtime 精度问题） |
| `archive/rawArchive.test.ts` | 适配异步签名（`await writeRawExchange`） |
| `screenshot-dump.test.ts` | PNG 产物写完即删，不留测试垃圾（`.gitignore` 同步 `scripts/dump-*.png`） |

## 验证

- `npm run test:main`：27 个文件 225 个测试全绿
- `cd src/renderer && npx vue-tsc --noEmit`：通过
- 主进程 `npx tsc --noEmit`：通过

## 排查中确认无需改动的点

- xterm 的 fit/主题切换已有 rAF 节流，tab 切换用 v-show 复用终端实例，scrollback 默认 1000 合理
- `trace/ipc.ts` 的 listRequests/sessionStats 有按 seq 的增量缓存
- 主进程无本地消费者依赖逐 chunk 的 `session:<id>` 事件，合帧安全
- 事件监听器清理完整，未发现泄漏；CSS 无大面积滤镜/阴影问题

## 遗留（未做，收益有限或需更大改动）

- `apiproxy` 每次 roundtrip 仍会对全部历史 message 做 `JSON.stringify` 计算 blob hash（跨请求去重的固有成本），如需进一步优化可做 hash 记忆化
- chokidar `ignored` 回调初始爬目录时同步 `statSync` 风暴（仅启动时一次）
- `withRecentLock` 忙等自旋锁是隐患（当前锁内无 await，暂无实际开销）
- electron-store `sessions.*` 陈旧条目清理（无对应 jsonl 的条目）
