# 性能优化：内存泄漏修复计划

> 基于 superpowers:systematic-debugging 诊断，2026-07-23
> 目标：解决"应用运行久了卡顿"问题

## 诊断背景

通过 Phase 1（Root Cause Investigation）扫描主进程 + 渲染进程所有泄漏模式，定位到以下根因。当前实测：主进程 electron PID 15560 占 **449MB**，渲染进程 PID 39380 占 **193MB**。

诊断证据见扫描报告，不在此重复。

---

## 修复项清单

按严重程度排序，每项含位置、影响分析、风险、工作量。

### #1 修复 closeSession 补全清理（高·止血）

- **位置**：`src/main/app.ts:967` + `src/main/session.ts:55`
- **现状**：`ipcMain.handle('app:closeSession')` 只调 `session.close(id)` 杀 PTY，未调 `session.remove(id)` 触发 onRemove 回调，导致 `sessions` Map / `apiProxies` 数组 / `sessionStates` Map 残留。每次开关会话泄漏一个 HTTP server + SessionAdapter + HappyJsonlWriter 文件句柄。
- **修复**：
  ```ts
  ipcMain.handle('app:closeSession', (_event, id: string) => {
    getLogger().info(`[app:closeSession] closing sid=${id}`);
    session.remove(id);  // 替代 session.close(id)，触发 onRemove 回调清理 wecom 映射
    // 手动清理 proxy + sessionStates
    const proxyIdx = this.apiProxies.findIndex(p => p.sessionId === id);
    if (proxyIdx >= 0) {
      this.apiProxies[proxyIdx].close();
      this.apiProxies.splice(proxyIdx, 1);
    }
  });
  ```
- **对显示影响**：用户侧完全无感知，tab 关闭行为一致。
- **风险**：低。wecom 映射通过 `setOnRemove` 回调清理，pending 权限卡片会变"已处理"（正确行为）。
- **工作量**：小。

---

### #2 修复 finalizeExchange 清空 buffer + 幂等保护（高）

- **位置**：`src/main/apiproxy.ts:276-352`
- **现状**：`finalizeExchange` 把 `rawChunks` 拼成 raw 字符串落盘后，不清空 `s.rawChunks` / `s.sseCarry` / `s.reqBody` / `s.reqHeaders` / `s.resHeaders`，依赖下次请求 `req.on('end')`（行 145-146）重置。session 闲置时最后一次整段 raw 响应 buffer 永久驻留；叠加 #1 后永久累积。
- **修复**：
  ```ts
  // finalizeExchange 末尾
  if (s.finalized) return;  // 幂等保护
  s.finalized = true;
  // ... 原逻辑（writeRawExchange）...
  s.rawChunks = [];
  s.sseCarry = '';
  s.reqBody = null;
  s.reqHeaders = {};
  s.resHeaders = {};
  ```
- **对显示影响**：无感知，数据已落盘。
- **风险**：低。`proxyRes.on('end')` 和 `proxyReq.on('error')` 都会调用 `finalizeExchange`，必须加 `finalized` 标志防止清空后第二次调用写空 manifest。
- **工作量**：小。

---

### #3 修复 trace store setSession 清空所有字段（高）

- **位置**：`src/renderer/src/stores/trace.ts:82-96`
- **现状**：`setSession` 只清 `selectedSeq/detail/picks`，未清 `requests/envelopes/stats/diffResult/usage`。用户从 session A 切到 B 时，TraceSidebar 短暂显示 A 的请求数和费用；`detail`（含 `reassembled.content` 大数组）在 TraceOverlay 关闭后仍驻留。
- **修复**：
  ```ts
  function setSession(wd: string, sid: string) {
    if (workDir.value && sessionId.value) {
      UnwatchTraceSession(workDir.value, sessionId.value).catch(() => {})
    }
    workDir.value = wd
    sessionId.value = sid
    selectedSeq.value = null
    detail.value = null
    picks.value = []
    diffResult.value = null      // 新增
    requests.value = []          // 新增
    envelopes.value = []         // 新增
    stats.value = null           // 新增
    usage.value = null           // 新增
    if (wd && sid) {
      WatchTraceSession(wd, sid).catch(() => {})
      load()  // 主动加载，避免短暂空白
    }
  }
  ```
- **对显示影响**：切 session 瞬间 TraceSidebar 会闪"暂无 API 请求"，然后立即触发 `load()` 填充。不再出现误导性的旧数据。
- **风险**：低。diff 模式下切 session 会关掉 diff 视图（正确行为）。
- **工作量**：小。

---

### #4 修复 trace watcher 切 session 时清理（中）

- **位置**：`src/main/trace/ipc.ts:235` watchers Map + `src/renderer/src/stores/trace.ts:82`
- **现状**：`trace:watch` IPC 缓存 chokidar watcher，`trace:unwatch` 才清理。`setSession` 已调 `UnwatchTraceSession` 清旧的，但用户**直接关 tab（不切新 session）**时 `UnwatchTraceSession` 不会被调用，watcher 残留。
- **修复**：前端 `onCloseTab` 关闭 session tab 时调 `trace.setSession('', '')` 或新增 `trace.clearSession()`，触发 `UnwatchTraceSession`。后端无需改动。
- **对显示影响**：无感知，watcher 是后台 chokidar。
- **风险**：极低。快速切 tab（A->B->A）有微小 watcher 重建开销，可忽略。
- **工作量**：小。

---

### #5 HomeView welcome/settings/guide v-show 改 v-if（低·零风险）

- **位置**：`src/renderer/src/views/HomeView.vue:24/49/52`
- **现状**：welcome / settings / guide 三个 pane 用 `v-show`，每个常驻 DOM。这些组件无重连代价（不像 session tab 有 PTY 状态），改 `v-if` 零风险。
- **修复**：三个 pane 的 `v-show` 改为 `v-if`。
- **对显示影响**：无感知，切 pane 时组件重建（本就无状态可保）。
- **风险**：极低。
- **工作量**：小（5分钟）。

注：这是 #7 LRU 活跃池方案的零风险替代。session tab 的 `v-show->v-if` 需要单独设计，见 #7。

---

### #6 envelopes.jsonl 按大小轮转 + 流式读取（中·单独做）

- **位置**：`src/main/archive/happyJsonl.ts`
- **现状**：单文件无限追加，`readAll` 全文件 `readFileSync + JSON.parse`。长 session 文件可达几 MB，trace 面板拉取时主进程卡顿。
- **修复方案**：
  - 按 size 轮转：`envelopes.jsonl` > 5MB 时切到 `envelopes.001.jsonl`
  - `readAll` 改为按文件名顺序合并多个分片
  - 或改为流式读取（`readline.createInterface`）
  - 兼容老的单文件格式（无轮转分片）
- **对显示影响**：长 session 的 trace 面板加载速度可能略变慢（多文件读取），但主进程不卡顿。短 session 无影响。
- **风险**：中。需保证分片合并按 ts 升序，兼容老格式。
- **工作量**：中。建议单独做。

---

### #7 HomeView session tab LRU 活跃池（中·需设计）

- **位置**：`src/renderer/src/views/HomeView.vue:33-40`
- **现状**：每个打开过的 session tab 用 `v-show` 常驻 DOM + xterm 实例 + ResizeObserver + MutationObserver + EventsOn 监听 + 1000 行 scrollback。10 个 tab = 10 份资源。
- **修复方案**：
  - `tabsStore` 加 `activePool`（最近活跃 sessionId 列表，最多 N=3 个）
  - `onSelectTab` 时推到头部超出弹尾
  - HomeView 中 `v-show` 改为 `v-if: activePool.includes(sid)` + `v-show` 双重判断
  - 不在 pool 的 tab 显示"会话已归档，点击恢复"占位组件
  - **归档前检查 `isRunningState`**，运行中（thinking/streaming/running_tool/awaiting_permission）的 session 不归档，避免输出丢失
- **对显示影响**：
  - 最近 3 个 tab 切换零成本
  - 切回被归档的 tab 时 xterm 重建，loading 菊花 1~2 秒，PTY 复用但 **xterm buffer 清空，历史输出丢失**
  - 若 Claude 正在长输出时被归档，归档期间数据会丢（已通过运行状态检查缓解）
- **风险**：中。需要归档 UI 组件 + 运行状态检查。
- **工作量**：中（约 80 行代码）。
- **建议**：先做 #5 零风险版本，再单独设计本方案。

---

## 推荐执行顺序

按投入产出比：

1. **止血阶段**（零感知、小改动、高收益）：#1 + #2 + #3 + #4
2. **低风险优化**：#5
3. **单独设计**：#6（envelopes 轮转）+ #7（LRU 活跃池）

---

## 验收方式

- `npm run test:main` 全绿（除已知的 pty.test.ts 超时）
- `cd src/renderer && npx vue-tsc --noEmit` 全绿
- 手动验收：
  - 开 10 个 session tab 再全部关闭，主进程内存应回落到接近初始值
  - 切换不同 session，TraceSidebar 不再显示旧数据
  - 闲置 session 5 分钟后主进程内存不增长
  - 关闭 tab 后 `lsof` 或资源管理器查看文件句柄数下降

---

## 诊断证据来源

- 主进程扫描：sessionStates / apiProxies / HappyJsonlWriter / hookserver lastSeenMap / trace watchers / wecom-channel Maps
- 渲染进程扫描：trace store / HomeView v-show / xterm 实例 / EventsOn 监听 / ProviderTab setTimeout
- 实测内存：主进程 PID 15560 = 449MB，渲染进程 PID 39380 = 193MB（2026-07-23 15:30）

完整扫描报告见对话历史，不在此重复。
