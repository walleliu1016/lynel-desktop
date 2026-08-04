# Trace 摘要索引 + 分页懒加载 设计文档

**日期：** 2026-08-02
**状态：** 待审批

---

## 1. 问题

Trace 侧边栏长时间累积数百上千条请求后，session 重新打开耗时很久甚至失败。

### 根因

1. **全量 IO**：`trace:listRequests` 每次 session 切换都 `readdirSync` + 对每个 `<seq>.json` 做 `readFileSync` + `JSON.parse` 读取完整 exchange（MB 级），只为提取 ~200 字节摘要
2. **无分页**：前端一次性加载全部请求到 Pinia + 渲染全部 DOM 节点
3. **缓存非持久**：进程内缓存重启即失效

### 性能瓶颈位置

- `src/main/trace/ipc.ts`：`trace:listRequests` handler
- `src/main/archive/rawArchive.ts`：`readRawExchange` 每次完整读取大文件
- `src/renderer/src/stores/trace.ts`：`requests` 数组无限增长，深度响应化

---

## 2. 方案

### 2.1 摘要索引文件 `_summaries.jsonl`

**位置：** `<sessionDir>/_summaries.jsonl`

**写入：** `apiproxy.finalizeExchange()` 写完 `<seq>.json` 后追加一行

**每行格式**（紧凑 JSON，~200 字节）：

```json
{"seq":1,"model":"claude-sonnet-4-20250514","status":200,"latencyMs":3420,"error":false,"cost":{"usd":0.0023,"input":500,"output":200},"trace":{"totalMs":3420,"ttftMs":800,"genMs":2620},"ts":1712345678000,"toolCount":3}
```

**字段定义**（满足侧边栏渲染 + 过滤的全部需求）：

| 字段 | 类型 | 用途 |
|------|------|------|
| seq | number | 序号，唯一标识 |
| model | string\|null | 模型名，filter 用 |
| status | number | HTTP 状态码，error 判断 |
| latencyMs | number\|null | 总延迟 |
| error | boolean | 错误标记 |
| cost.usd | number | 费用 |
| cost.input | number | 输入 tokens |
| cost.output | number | 输出 tokens |
| trace.totalMs | number | 总耗时 |
| trace.ttftMs | number | 首 token 耗时 |
| trace.genMs | number | 生成阶段耗时 |
| ts | number | 时间戳 |
| toolCount | number | 工具调用次数 |

### 2.2 分页加载

**IPC 接口变更：**

```
trace:listRequests(workDir, sessionId, opts: { limit: 50, offset: 0 })
  → { summaries: TraceSummary[], hasMore: boolean }
```

- `limit`=50：每页 50 条
- `offset`=0：最新 50 条（从文件尾部开始读）
- `hasMore`：是否还有更早的记录

**前端加载：**

- 初始：`load()` → fetch last 50
- 滚动到底部：`loadMore()` → fetch next 50 (offset += 50)
- 新请求到达：chokidar → `trace:updated` → `fetchNewSince(maxSeq)` 追加到列表末尾

**读取策略（后端）：**

- `_summaries.jsonl` 每条 ~200 字节，5000 条仅 ~1MB，全量 `readFileSync` 即可（<10ms）
- 按行 split，取最后 `offset+limit` 行，再 slice 分页
- 复杂度 O(n) 对 n=5000 完全可接受，无需反向读流
- 保持纯函数，不引入额外缓存

### 2.3 增量更新

chokidar 仍监听 `raw/` 目录变化（检测新 `<seq>.json` 写入）：

- 文件变化 → 300ms debounce → `trace:updated`
- 前端收到事件 → 调用 `trace:listNewRequests(workDir, sessionId, sinceSeq)` → 只返回 seq > sinceSeq 的摘要
- 新摘要追加到 `requests[]` 末尾

### 2.4 详情加载（不变）

`select(seq)` 仍走 `trace:request` → `readRawExchange` → 读取完整 `<seq>.json`。详细展示路径完全不受影响。

---

## 3. UI 重新设计

### 3.1 行布局

```
Row 1: ● #1  sonnet  14:32:15               ← 不变
Row 2: [↓] 5k  [↑] 1.2k  [🔧] ×3  [⏱] 3.4s  $0.023
```

### 3.2 图标映射

| 图标 | lucide 名 | size | 说明 |
|------|-----------|------|------|
| ↓ | `arrow-down` | 10px | 输入 tokens |
| ↑ | `arrow-up` | 10px | 输出 tokens |
| 🔧 | `wrench`（已有） | 10px | 工具调用次数，`toolCount > 0` 才显示 |
| ⏱ | `clock` | 10px | 总延迟 |

### 3.3 数据格式化

| 数据 | 格式 | 示例 |
|------|------|------|
| tokens | `>= 1000` 用 `k` 后缀，1 位小数 | `5k`、`1.2k`、`500` |
| 工具调用 | `×N` | `×3`，0 时隐藏 |
| 延迟 | `< 1s` → `ms`，`< 60s` → `s`（1 位小数），`>= 60s` → `m` | `800ms`、`3.4s`、`1.5m` |
| 费用 | 3 位小数 | `$0.023` |

### 3.4 过滤保留

- model 下拉 filter：基于 `requests` 中的 models
- errors only toggle：`r.error || r.status >= 400`
- 两者都兼容分页数据（filter 作用于已加载的全部请求）

---

## 4. 文件变更清单

### 4.1 主进程

| 文件 | 改动 |
|------|------|
| `src/main/archive/rawArchive.ts` | 新增 `appendSummary()` 函数 |
| `src/main/apiproxy.ts` | `finalizeExchange` 中调用 `appendSummary()` |
| `src/main/trace/ipc.ts` | 重写 `trace:listRequests`（分页 + 读摘要），新增 `trace:listNewRequests`，移除 `trace:sessionStats`/`trace:usage`/`trace:envelopes` |

### 4.2 前端

| 文件 | 改动 |
|------|------|
| `src/renderer/src/stores/trace.ts` | 分页加载逻辑、`loadMore()`、`hasMore`、移除 `stats`/`usage` |
| `src/renderer/src/components/trace/TraceSidebar.vue` | 新行布局 + 图标、滚动检测触发 `loadMore()` |
| `src/renderer/src/components/Icon.vue` | 新增 `arrow-down`、`arrow-up`、`clock` |
| `src/renderer/src/components/trace/TraceHeader.vue` | **删除**（无活跃引用） |
| `src/renderer/src/composables/useElectron.ts` | 更新 trace IPC 封装签名 |

### 4.3 测试

| 文件 | 改动 |
|------|------|
| `tests/main/archive/rawArchive.test.ts` | 新增 `appendSummary` + 读取测试 |
| `tests/main/trace/`（新增） | 分页读取 + 边界测试 |

---

## 5. 删除项

- `TraceHeader.vue`：三段式布局迁移后已无引用
- `trace:sessionStats` IPC handler：统计对象无活跃组件消费
- `trace:usage` / `trace:envelopes` IPC handler：无消费者
- trace store 中 `stats`/`usage`/`loadUsage()` 字段和方法

---

## 6. 不兼容说明

- 无 `_summaries.jsonl` 的旧 session 直接显示空状态，不做自动回填
- `_summaries.jsonl` 与 `<seq>.json` 可能不同步（旧 seq 有 json 无摘要），不影响功能
