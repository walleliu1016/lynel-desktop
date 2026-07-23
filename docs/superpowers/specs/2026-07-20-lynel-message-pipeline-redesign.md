# Lynel Desktop 消息管道重设计

> **版本**: 1.1  
> **日期**: 2026-07-20  
> **用途**: 全面替换 `src/main/apiproxy.ts` 与 `src/main/channels/*` 的现有 ProxyStageEvent 模型，引入 happy Session Protocol 作为统一实时协议，同时移植 ccglass 的解析/成本/trace 能力作为归档与审计层。  

---

## 1. 背景与目标

### 1.1 现状问题

- `ProxyStageEvent` 是面向"阶段"的事件模型（`prompt/text/tool_use/tool_result/response_complete`），`turn` 字段文档上说是"用户可见交互轮次"，但代码里恒为 1，模型与实现不符。
- `apiproxy.ts` 只提取必要片段：最后一项 message 的 text prompt、截断到 500 字符的 tool_result，不保存完整 request/response raw，无法做成本、trace、重放。
- 企业微信、App 等消费方需要更清晰的"对话视图"：user message、agent message、tool-call-start/end、turn 边界。

### 1.2 目标

1. 实时消息统一使用 happy Session Protocol（envelope + 9 种事件）。
2. 一个 session 一个 jsonl 文件，每行一个 envelope，拉平存储。
3. 同时保存 ccglass 风格的完整 request/response raw，用于成本、trace、审计、重放。
4. 保留 hook 审批通道，完全不动。
5. 企业微信按混合粒度推送：tool-call-start 实时，文本按 turn 聚合。
6. 预留云服务推送通道，未来把消息推到独立移动 App。
7. 前端提供完整 ccglass 式分析面板，以 GlobalTabs 新类型 tab 打开。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| 一次到位 | 不兼容旧 `ProxyStageEvent`，相关代码直接替换。 |
| 双轨存储 | 实时 happy jsonl（对话视图）+ ccglass raw archive（网络证据）。 |
| 实时优先 | tool-call-start 等关键事件立即 emit，不等待响应结束。 |
| 审批独立 | hook 审批仍由 `hookserver → permission-broker` 处理，不走新通道。 |
| 消费方可扩展 | 所有 envelope 都经过 ChannelDispatcher，新增消费方只需加 channel。 |
| 数据不出错 | raw archive 和 happy jsonl 同源、同 seq，可互相校验。 |

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Electron 主进程                                  │
│                                                                      │
│  Claude PTY                                                          │
│     │                                                                │
│     ▼ (ANTHROPIC_BASE_URL)                                           │
│  ┌──────────────┐    ┌────────────────────┐    ┌─────────────────┐  │
│  │  apiproxy.ts │───▶│ SessionAdapter     │───▶│ ChannelDispatcher│ │
│  │  (反向代理)   │    │ SSE → happy        │    │ 按 ev.t 路由     │  │
│  └──────────────┘    │ SessionEnvelope    │    └────────┬────────┘  │
│         │            └────────────────────┘             │           │
│         │                                               │           │
│         │  实时 envelope 流                              │           │
│         │                                               ▼           │
│         │                    ┌─────────┬─────────┬─────────┐       │
│         │                    │ App SSE │ WeCom   │ Cloud   │       │
│         │                    │ Channel │ Channel │ Channel │       │
│         │                    │ (本地)  │         │ (预留)  │       │
│         │                    └─────────┴─────────┴─────────┘       │
│         │                                                           │
│         ▼  请求结束                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ RawArchiveWriter                                              │  │
│  │ - 保存完整 request body                                       │  │
│  │ - 保存完整 response raw                                       │  │
│  │ - 计算 trace / cost / usage                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ hookserver (不动)                                             │  │
│  │ PermissionRequest → permission-broker → 灵动岛 / 企业微信审批  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ IPC / SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Electron 渲染进程                                │
│                                                                      │
│  GlobalTabs:                                                         │
│  ┌─────────┬─────────┬─────────┬─────────┐                          │
│  │ welcome │ session │ trace   │ settings│ ...                      │
│  │ (欢迎页) │ (xterm) │ (ccglass│ (设置)  │                          │
│  │         │         │ 面板)   │         │                          │
│  └─────────┴─────────┴─────────┴─────────┘                          │
│                                                                      │
│  trace tab 内部:                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ session stats badge + model filter + errors/diff/summary        ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ latency trend │ request list │ detail tabs (overview/flow/     ││
│  │               │              │ system/messages/tools/response/ ││
│  │               │              │ headers)                        ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 协议层：happy Session Protocol + Lynel 扩展

### 4.1 SessionEnvelope（照搬 happy）

```typescript
type SessionEnvelope = {
  id: string;        // cuid2
  time: number;      // Unix 时间戳 ms
  role: 'user' | 'agent';
  turn?: string;     // cuid2，agent 消息必须
  subagent?: string; // cuid2，子代理（预留，暂不实现）
  claudeUuid?: string;
  claudeMsgId?: string;
  usage?: SessionUsage;
  ev: SessionEvent;
};

type SessionUsage = {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  context_window?: number;
  service_tier?: string;
};
```

### 4.2 9 种事件（Lynel 使用范围）

| 事件 | 用途 | 当前阶段 |
|---|---|---|
| `text` | user/agent 文本，thinking=true 表示推理 | ✅ |
| `service` | 服务消息：API HTTP 错误、网络错误、通知 | ✅ |
| `file` | 文件附件 | 预留 |
| `tool-call-start` | 工具调用开始 | ✅ |
| `tool-call-end` | 工具调用结束，可带 `is_error` + `error` 表示失败 | ✅ |
| `turn-start` | 一轮开始 | ✅ |
| `turn-end` | 一轮结束（completed/failed/cancelled） | ✅ |
| `start` | 子代理开始 | 预留 |
| `stop` | 子代理停止 | 预留 |

### 4.3 Lynel 扩展字段

为了排序与调试，在 happy 标准 envelope 基础上增加：

```typescript
// 会话内单调递增 seq，用于排序、重连恢复、与 raw archive 对齐
type LynelEnvelope = SessionEnvelope & { seq: number };

// tool-call-end 事件扩展：携带工具调用是否失败 + 失败摘要
type ToolCallEndEvent = {
  t: 'tool-call-end';
  call: string;
  is_error?: boolean;  // tool_result.is_error === true 时为 true
  error?: string;      // 失败摘要（取自 tool_result.content 的前若干字符）
};
```

`seq` 采用**会话内自增**：每个 session 独立从 1 开始，由该 session 的 `APIProxy` 实例维护自己的计数器。这样多 session 并发请求时不会互相干扰，每个 session 的 jsonl 内 seq 严格递增、可顺序回放。raw archive 中的 `<seq>.json` 与 jsonl 中第 `seq` 条 envelope 一一对应。

`tool-call-end` 的 `is_error` / `error` 字段让消费方（企业微信卡片更新、App UI）能直接判断工具调用的成败，而无需额外发 `service` 事件。

### 4.4 多 Agent 扩展预留

当前 Phase 只实现 Claude Code，但架构上要预留接入 Codex、pi-agent 等其他 agent 的能力。

#### 分层设计

```
协议层（agent-agnostic）
  └── protocol/ 中的 SessionEnvelope / SessionEvent / SessionUsage

适配器层（agent-specific）
  └── formats/
      ├── format.ts       # FormatAdapter 接口
      ├── anthropic.ts    # Claude Code / Anthropic Messages API
      ├── openai.ts       # Codex / OpenAI Responses + Chat Completions（预留）
      └── pi.ts           # pi-agent（预留）

编排层
  └── apiproxy.ts 按 provider + env 选择 FormatAdapter，再交给 SessionAdapter 生成 envelope
```

#### `FormatAdapter` 接口

```typescript
interface FormatAdapter {
  // 标识，用于 raw archive 的 format 字段
  readonly name: string;

  // 解析请求 body，提取 user text / tool_result 信息
  parseRequest(body: unknown): RequestParseResult;

  // 将 SSE chunk 拆成标准事件流
  parseSseChunk(chunk: Buffer, state: SseParseState): FormatEvent[];

  // 从完整 response raw 重组成最终消息（含 usage/model/content）
  reassembleResponse(raw: string): ReassembledResponse;

  // 从 HTTP 错误响应体提取可读错误
  parseHttpError(status: number, raw: string): string;

  // 根据 usage 计算成本
  costFromUsage(model: string, usage: Usage): Cost;
}
```

#### envelope 上增加 agent 标识

```typescript
type LynelEnvelope = SessionEnvelope & {
  seq: number;
  agent?: string;  // 'claude' | 'codex' | 'pi'，默认 'claude'
};
```

`agent` 字段用于前端按 agent 渲染不同视图，也用于 raw archive 的 `format` 字段联动。

#### 当前实现边界

Phase 1–7 只实现 `formats/anthropic.ts`（Claude Code），但接口和目录结构要按多 format 预留。

---

## 5. 解析层：apiproxy 改造

### 5.1 核心变化

- 每个 session 持有一个 `SessionAdapter` 实例。
- `SessionAdapter` 内部持有当前 agent 对应的 `FormatAdapter`（Phase 1 只实现 `formats/anthropic.ts`）。
- 请求到达时：调 `adapter.handleRequest(body)`，产出 user/turn-end/turn-start/tool-call-end 等 envelope。
- 响应流式过程中：`FormatAdapter` 解析 SSE chunk 为标准事件，`SessionAdapter` 将事件映射为 envelope，产出 agent text/tool-call-start/thinking 等。
- 响应结束后：调 `RawArchiveWriter.saveExchange()` 写入完整 request/response raw。
- 所有 envelope 立即送 `ChannelDispatcher`。

### 5.2 SSE → Envelope 映射

| SSE 事件 | 处理 |
|---|---|
| `message_start` | 记录 `message.id`、input_tokens；懒创建 turn-start |
| `content_block_start(text)` | 开始累积 text block |
| `content_block_start(thinking)` | 开始累积 thinking block |
| `content_block_start(tool_use)` | **立即 emit** `tool-call-start`（args 为空），开始累积 partial_json |
| `content_block_delta(text_delta)` | 追加 text |
| `content_block_delta(thinking_delta)` | 追加 thinking |
| `content_block_delta(input_json_delta)` | 累积 partial_json |
| `content_block_stop(text)` | emit `agent:text`（完整 block） |
| `content_block_stop(thinking)` | emit `agent:text`（thinking: true） |
| `content_block_stop(tool_use)` | 补全之前 `tool-call-start` 的 args |
| `message_delta` | 记录 output_tokens、stop_reason；attach usage 到最后一条可携带 envelope |
| `message_stop` | 不发 turn-end（等下一个请求判断边界） |
| `error`（SSE 内） | emit `service`（错误消息）+ `turn-end {failed}` |
| HTTP status >= 400 | `onResponseEnd` 时检查：若发生过 SSE 流可正常解析 content 则按正常流程处理；若无法解析（纯 JSON 错误体），emit `service`（错误描述）+ `turn-end {failed}` |

### 5.3 Turn 边界判断

```typescript
function isTurnBoundary(request: ApiRequest): boolean {
  const last = request.messages.at(-1);
  if (!last || last.role !== 'user') return false;
  if (typeof last.content === 'string') return true;
  if (Array.isArray(last.content)) {
    return !last.content.some(b => b.type === 'tool_result');
  }
  return false;
}
```

- 新 user 纯文本 → 关闭上一 turn（completed），开启新 turn（turn-start）。
- tool_result-only 请求 → 同一 turn 内，emit `tool-call-end`。若该 `tool_result.is_error === true`，在同一个 `tool-call-end` 上带 `is_error: true` 与 `error` 摘要（见 4.3）。
- 兜底：session 结束时若 turn 未关闭，补 `turn-end {cancelled}`。

### 5.4 apiproxy.ts 关键流程

```typescript
class APIProxy {
  private adapter = new SessionAdapter();
  private responseChunks: Buffer[] = [];
  private firstByteAt: number | null = null;
  private startedAt = 0;
  private requestBody: Buffer | null = null;

  onRequestEnd(body: Buffer) {
    this.startedAt = Date.now();
    this.requestBody = body;
    const envelopes = this.adapter.handleRequest(JSON.parse(body.toString()));
    this.dispatch(envelopes);
    this.forwardToUpstream(body);
  }

  onResponseData(chunk: Buffer) {
    if (this.firstByteAt == null) this.firstByteAt = Date.now();
    this.responseChunks.push(chunk);
    const events = this.parseSseChunk(chunk);
    for (const ev of events) {
      this.dispatch(this.adapter.handleSseEvent(ev));
    }
  }

  onResponseEnd(status: number, headers: any) {
    const finishedAt = Date.now();
    const raw = Buffer.concat(this.responseChunks).toString('utf8');

    // HTTP 错误：status >= 400 且响应无法解析出正常 content 时，
    // emit service + 关闭 turn (failed)
    if (status >= 400 && !this.adapter.streamHadContent()) {
      const errMsg = this.adapter.parseHttpError(status, raw);
      this.dispatch(this.adapter.handleHttpError(errMsg));
    }

    // 写 raw archive（含 error 字段标记本次是否失败）
    rawArchive.write({
      sessionId: this.sessionId,
      seq: this.seq,
      ts: this.startedAt,
      startedAt: this.startedAt,
      firstByteAt: this.firstByteAt ?? finishedAt,
      finishedAt,
      request: { method: 'POST', url: '/v1/messages', headers: maskHeaders(this.reqHeaders), body: this.parsedRequestBody },
      response: { status, headers, raw },
      error: status >= 400,
    });
  }

  onUpstreamError(err: Error) {
    // 网络层失败：upstream 连不上 / TLS 错误等，响应根本没收到
    this.dispatch(this.adapter.handleNetworkError(err.message));
  }
}
```

### 5.5 错误感知

系统需要区分四类错误，并在 happy jsonl 中显式表达：

| 错误类型 | 触发条件 | 输出到 happy jsonl | 是否关闭 turn |
|---|---|---|---|
| **SSE 流内错误** | SSE 中出现 `data: {"type":"error",...}` | `service`（错误描述）+ `turn-end {failed}` | ✅ 失败 |
| **API HTTP 错误** | status >= 400 且响应无法解析为正常 content | `service`（HTTP status + error message）+ `turn-end {failed}` | ✅ 失败 |
| **网络层失败** | upstream 连接失败、TLS 错误、超时等 | `service`（错误描述）+ `turn-end {failed}` | ✅ 失败 |
| **tool 调用失败** | `tool_result.is_error === true` | `tool-call-end {call, is_error: true, error: '...'}` | ❌ 由 Claude 决定下一步 |

#### 5.5.1 实现细节

```typescript
class SessionAdapter {
  private streamHadContentFlag = false;

  handleSseEvent(event: SseEvent): SessionEnvelope[] {
    if (event.type === 'content_block_stop') {
      this.streamHadContentFlag = true;
    }

    if (event.type === 'error') {
      return [
        createEnvelope('agent', { t: 'service', text: `**API Error**: ${event.error.type} - ${event.error.message}` }, { turn: this.currentTurnId }),
        createEnvelope('agent', { t: 'turn-end', status: 'failed' }, { turn: this.currentTurnId }),
      ];
    }
    // ...
  }

  handleToolResult(toolUseId: string, isError: boolean, content: string): SessionEnvelope[] {
    const env = createEnvelope('agent', {
      t: 'tool-call-end',
      call: toolUseId,
      ...(isError ? { is_error: true, error: summarizeToolError(content) } : {}),
    }, { turn: this.currentTurnId });
    return [env];
  }

  handleHttpError(status: number, raw: string): SessionEnvelope[] {
    const message = parseAnthropicError(raw) ?? `HTTP ${status}`;
    return [
      createEnvelope('agent', { t: 'service', text: `**API Error**: ${message}` }, { turn: this.currentTurnId }),
      createEnvelope('agent', { t: 'turn-end', status: 'failed' }, { turn: this.currentTurnId }),
    ];
  }

  handleNetworkError(message: string): SessionEnvelope[] {
    return [
      createEnvelope('agent', { t: 'service', text: `**Network Error**: ${message}` }, { turn: this.currentTurnId }),
      createEnvelope('agent', { t: 'turn-end', status: 'failed' }, { turn: this.currentTurnId }),
    ];
  }

  streamHadContent(): boolean {
    return this.streamHadContentFlag;
  }
}
```

#### 5.5.2 与 raw archive 的对应关系

- raw archive 中每个 `<seq>.json` 都有 `response.status` 和 `error` boolean。
- `error: true` 当且仅当 `status >= 400` 或 `response.error` 非空。
- trace 面板据此在 request 列表中高亮失败请求，并提供 errors 过滤按钮。

---

## 6. 存储层

### 6.1 happy jsonl（对话视图）

路径：`~/.lynel-desktop/projects/<encoded-project>/<sid>/envelopes.jsonl`

每行一个 `LynelEnvelope`，按 `seq` 顺序 append。`seq` 在该 session 内自增，从 1 开始。

```jsonl
{"seq":1,"id":"c1","time":1700000000000,"role":"user","ev":{"t":"text","text":"帮我查 auth 文件"}}
{"seq":2,"id":"c2","time":1700000001000,"role":"agent","turn":"t1","ev":{"t":"turn-start"}}
{"seq":3,"id":"c3","time":1700000001500,"role":"agent","turn":"t1","ev":{"t":"text","text":"我来查找"}}
{"seq":4,"id":"c4","time":1700000002000,"role":"agent","turn":"t1","ev":{"t":"tool-call-start","call":"toolu_1","name":"Bash","title":"列出 auth 目录","description":"","args":{"command":"rg auth src"}}}
{"seq":5,"id":"c5","time":1700000003000,"role":"agent","turn":"t1","ev":{"t":"tool-call-end","call":"toolu_1","is_error":true,"error":"command exited with code 1"}}
{"seq":6,"id":"c6","time":1700000003500,"role":"agent","turn":"t1","usage":{"input_tokens":1200,"output_tokens":45},"ev":{"t":"text","text":"我换个命令试试"}}
{"seq":7,"id":"c7","time":1700000004000,"role":"user","ev":{"t":"text","text":"看下 index.ts"}}
{"seq":8,"id":"c8","time":1700000004500,"role":"agent","turn":"t1","ev":{"t":"turn-end","status":"completed"}}
{"seq":9,"id":"c9","time":1700000005000,"role":"agent","turn":"t2","ev":{"t":"turn-start"}}
{"seq":10,"id":"c10","time":1700000006000,"role":"agent","turn":"t2","ev":{"t":"service","text":"**API Error**: rate_limit_error - Too many requests"}}
{"seq":11,"id":"c11","time":1700000006500,"role":"agent","turn":"t2","ev":{"t":"turn-end","status":"failed"}}
```

### 6.2 raw archive（ccglass 风格）

路径：`~/.lynel-desktop/projects/<encoded-project>/<sid>/raw/<seq>.json`

每个 session 一个目录， happy jsonl 与 raw archive 放在同一目录下（`envelopes.jsonl` 与 `raw/` 子目录并列），便于管理和归档。每个 HTTP roundtrip 一个 JSON 文件，含完整 request/response、trace、reassembled、cost，以及 `error` boolean 标记本次是否失败（`status >= 400` 或 `response.error` 非空时 `error: true`）。

```json
{
  "id": "<sid>/0001",
  "session": "<sid>",
  "seq": 1,
  "ts": 1700000000000,
  "startedAt": 1700000000050,
  "firstByteAt": 1700000003200,
  "finishedAt": 1700000003500,
  "format": "anthropic",
  "error": false,
  "request": {
    "method": "POST",
    "url": "/v1/messages",
    "headers": { "x-api-key": "***", "anthropic-version": "..." },
    "body": { "model": "...", "system": [...], "messages": [...], "tools": [...] }
  },
  "response": {
    "status": 200,
    "headers": { "content-type": "text/event-stream" },
    "raw": "data: {\"type\":\"message_start\"...}\n\n..."
  },
  "trace": {
    "totalMs": 3450,
    "ttftMs": 3150,
    "genMs": 300,
    "inTps": 380.95,
    "outTps": 150.0
  },
  "reassembled": {
    "model": "claude-sonnet-4-20250514",
    "stop_reason": "end_turn",
    "usage": { "input_tokens": 1200, "output_tokens": 45, "cache_read_input_tokens": 0 },
    "content": [{ "type": "text", "text": "我来查找..." }]
  },
  "cost": {
    "input": 1200,
    "output": 45,
    "cacheWrite": 0,
    "cacheRead": 0,
    "totalInput": 1200,
    "cacheHitRate": 0,
    "usd": 0.0043
  }
}
```

### 6.3 usage 汇总

路径：`~/.lynel-desktop/usage.json`

每次 raw archive 写入后增量更新，结构沿用 ccglass `usage.js:summarizeUsage`：

```json
{
  "sessionCount": 5,
  "requestCount": 42,
  "unmeasured": 3,
  "range": { "from": "2026-07-01T00:00:00.000Z", "to": "2026-07-20T23:59:59.999Z" },
  "totals": { "input": 120000, "output": 45000, "cacheRead": 8000, "cacheWrite": 2000, "totalInput": 130000, "cacheHitRate": 0.0615, "usd": 1.2345 },
  "byModel": [
    { "model": "claude-sonnet-4-20250514", "requests": 30, "input": 90000, "output": 30000, "usd": 0.85 }
  ],
  "bySession": [
    { "session": "...", "entries": 10, "from": "...", "to": "...", "input": 20000, "output": 5000, "usd": 0.15 }
  ]
}
```

---

## 7. 成本与 trace 计算

### 7.1 从 ccglass 移植的模块

| ccglass 源文件 | 移植目标 | 说明 |
|---|---|---|
| `src/parse.js` | `src/main/formats/anthropic.ts:reassembleResponse` | SSE raw → `{model, usage, content, stop_reason}` |
| `src/formats/anthropic.js` | `src/main/formats/anthropic.ts:view/blocks` | view/blocks 渲染 |
| `src/tokens.js` | `src/main/cost/priceTable.ts` | 模型定价表 + costFromUsage |
| `src/session-stats.js` | `src/main/trace/timing.ts` | requestTiming、latencyMs、recordModel |
| `src/usage.js` | `src/main/cost/usage.ts` | summarizeUsage、跨 session 汇总 |

### 7.2 定价表

```typescript
const PRICES = {
  opus:        { input: 5,   output: 25,  cacheWrite: 6.25,  cacheRead: 0.5 },
  opusLegacy:  { input: 15,  output: 75,  cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet:      { input: 3,   output: 15,  cacheWrite: 3.75,  cacheRead: 0.3 },
  haiku45:     { input: 1,   output: 5,   cacheWrite: 1.25,  cacheRead: 0.1 },
  haiku35:     { input: 0.8, output: 4,   cacheWrite: 1.0,   cacheRead: 0.08 },
  haiku3:      { input: 0.25, output: 1.25, cacheWrite: 0.3125, cacheRead: 0.025 },
};
```

### 7.3 trace 字段

```typescript
type Trace = {
  totalMs: number;   // finishedAt - startedAt
  ttftMs: number;    // firstByteAt - startedAt
  genMs: number;     // finishedAt - firstByteAt
  inTps: number;     // input_tokens / ttftSec
  outTps: number;    // output_tokens / genSec
};
```

---

## 8. 通道层：ChannelDispatcher

### 8.1 路由策略

`ChannelDispatcher` 消费 `LynelEnvelope`，按 `ev.t` 路由到不同 channel：

| channel | 消费的事件 | 输出目标 |
|---|---|---|
| `AppSSEChannel` | 全部 | 本地渲染进程、外部 SSE 订阅者 |
| `WeComChannel` | `text`（聚合）、`tool-call-start`、`tool-call-end`、`turn-end` | 企业微信 |
| `CloudChannel`（预留） | 全部或按策略过滤 | 未来云服务 → 移动 App |
| `LocalFileChannel` | 全部 | happy jsonl 归档 |
| `RawArchiveChannel` | 响应结束后一次性写入 | raw archive 归档 |

### 8.2 WeCom 混合推送策略

| 事件 | 推送方式 | 时机 |
|---|---|---|
| `tool-call-start` | 模板卡片 / Markdown | 实时 |
| `tool-call-end` | 更新原卡片：成功显示"已完成"，失败显示"失败：{error}" | 实时 |
| `agent:text` | 同一 turn 内多个 text/thinking block 合并成**一条 Markdown** | turn-end 时一次性发 |
| `user:text` | Markdown 引用 | 实时 |
| `turn-end` | 发送本轮汇总（文本摘要 + tool 清单 + 成本） | turn 边界 |
| `service` | Markdown 错误提示（API/网络错误） | 实时 |

> **说明**：一个 turn 内若有多段 agent text（包括普通文本和 thinking），全部按顺序拼接为一条 Markdown 消息（text 与 thinking 之间用引用块分隔，保留思考过程），避免刷屏。

### 8.3 CloudChannel 预留

**Phase 1–7 均不实现真实推送。** 当前阶段只定义接口并注册到 `ChannelDispatcher`（enabled=false），未来按需激活：

```typescript
interface CloudChannel extends OutputChannel {
  isEnabled(): boolean;  // 当前返回 false
  // 未来：调用云服务 SDK/HTTP/WebSocket，将 envelope 转发到独立移动 App
  forward(envelope: LynelEnvelope): Promise<void>;
}
```

---

## 9. hook 审批边界

**完全独立，不做任何改动。**

| 维度 | apiproxy 新通道 | hookserver 审批通道 |
|---|---|---|
| 数据源 | API 请求/响应 SSE | Claude hooks 回调 |
| 协议 | `LynelEnvelope` | `HookEvent` |
| 触发 | Claude 发 API 请求/响应 | Claude 调 permission 工具 |
| 消费 | 企业微信、App、本地归档 | 权限 broker、灵动岛、审批卡片 |
| 顺序 | 实时流 | 异步等待用户决策 |

两者可以**间接联动**：当 `WeComChannel` 收到 `tool-call-start` 且工具需要审批时，可以提示"等待权限决策"，但最终决策仍由 hookserver 完成。

---

## 10. 前端：完整 ccglass 式 trace tab

### 10.1 入口

在 `SessionList.vue` 的每个 session 上**右键**，弹出菜单。菜单中"复制 Session ID"下方新增一项"打开 Trace"。点击后 `GlobalTabs` 打开一个 `type: 'trace'` 的新 tab，绑定到当前 session。

**每个 session 有自己独立的 trace tab，不共享**：点击同一 session 的"打开 Trace"会激活已有 tab；点击不同 session 各自开新 tab；关闭 trace tab 不会影响对应 session 本身。

```typescript
type TabType = 'welcome' | 'session' | 'settings' | 'guide' | 'trace';

type TraceTabPayload = {
  sessionId: string;       // 该 tab 绑定的 session
  sessionWorkdir: string;
};
```

`GlobalTabs` 的 tab id 用 `trace-<sessionId>` 命名，保证唯一且可去重。

### 10.2 面板结构

```
TraceTab.vue
├── TraceHeader.vue
│   ├── SessionStatsBadge  (X in · Y out · Z% cache · $N.NNNN)
│   ├── ModelFilter.vue
│   └── TraceActions.vue   (errors / diff / summary)
├── TraceLayout.vue
│   ├── LatencyTrend.vue   (mini bar chart)
│   ├── RequestList.vue    (按 seq 排列的 roundtrip 列表)
│   └── RequestDetailPane.vue
│       ├── Tabs: overview / flow / system / messages / tools / response / headers
│       ├── OverviewPane.vue
│       ├── FlowPane.vue
│       ├── SystemPane.vue
│       ├── MessagesPane.vue
│       ├── ToolsPane.vue
│       ├── ResponsePane.vue
│       └── HeadersPane.vue
```

### 10.3 借鉴 ccglass 的设计细节

- **卡组布局**：overview tab 的 latency / TTFT / gen / inTps / outTps / tokens / cache / cost 卡片（`app.js:397-420`）。
- **call_id 色条**：messages / response 中 tool_use 与 tool_result 用同一色相色条配对（`app.js:439-443 idHue`）。
- **长文本折叠**：`<details>` 按行数折叠，标题显示"▸ show N lines"（`app.js:448-454 preBody`）。
- **latency 趋势条**：request 列表旁的 mini bar chart（`app.js:191-217 renderLatencyTrend`）。
- **request 列表**：每行显示 seq、model、latency、status、tool call 数、retry badge。
- **diff 视图**：选两个请求，按 added/removed/common 展示差异。
- **summary 视图**：跨 session 汇总，per-model/per-session/总计。

### 10.4 数据获取

前端通过 `useElectron.ts` 新增 IPC 方法调用主进程：

```typescript
ListTraceSessions(): Promise<string[]>;
ListTraceRequests(sessionId: string, modelFilter?: string): Promise<TraceSummary[]>;
GetSessionTraceStats(sessionId: string, modelFilter?: string): Promise<SessionStats>;
GetTraceRequest(id: string): Promise<RawExchange>;
DiffTraceRequests(a: string, b: string): Promise<DiffResult>;
GetUsageSummary(): Promise<UsageSummary>;
ExportTraceRequest(id: string, format: 'raw' | 'md' | 'json' | 'har'): Promise<string>;
```

实时流通过 `useEventStream` composable 订阅 `envelope:new` 事件。

---

## 11. 主进程文件结构

```
src/main/
├── apiproxy.ts                        # 改造：反向代理 + SessionAdapter + raw archive
├── hookserver.ts                      # 不动
├── permission-broker.ts               # 不动
├── notch-window.ts                    # 不动
│
├── protocol/                          # 新增
│   ├── envelope.ts                    # LynelEnvelope + createEnvelope
│   ├── events.ts                      # 9 种事件类型
│   └── usage.ts                       # SessionUsage 类型
│
├── adapter/                           # 新增
│   ├── sessionAdapter.ts              # 核心 SSE → envelope 状态机
│   ├── turnStateMachine.ts            # ensureTurn / closeTurn / isTurnBoundary
│   ├── toolLifecycle.ts               # ToolTracker（累积 args / start/end）
│   ├── usageAttacher.ts               # message_delta → 挂 usage
│   └── requestParser.ts               # 解析请求 body、提取 user text / tool_result
│
├── formats/                           # 从 ccglass 移植 + 多 agent 预留
│   ├── format.ts                      # FormatAdapter 接口
│   ├── anthropic.ts                   # Claude Code（Anthropic Messages API）
│   ├── openai.ts                      # Codex / OpenAI（预留）
│   └── pi.ts                          # pi-agent（预留）
│
├── trace/                             # 从 ccglass 移植
│   └── timing.ts                      # session-stats.js:requestTiming
│
├── cost/                              # 从 ccglass 移植
│   ├── priceTable.ts                  # tokens.js:PRICES + priceFor
│   └── usage.ts                       # usage.js:summarizeUsage
│
├── archive/                           # 新增
│   ├── happyJsonl.ts                  # 追加写 happy jsonl
│   ├── rawArchive.ts                  # 写 ccglass 风格 raw exchange
│   └── usageSummary.ts                # 增量更新 usage.json
│
└── channels/                          # 改造
    ├── registry.ts                    # ChannelDispatcher 消费 LynelEnvelope
    ├── channel.ts                     # OutputChannel 接口
    ├── sse-channel.ts                 # App SSE（本地 + 外部订阅）
    ├── wecom-channel.ts               # 企业微信混合推送
    ├── cloud-channel.ts               # 云服务预留
    └── localfile-channel.ts           # happy jsonl 归档

src/renderer/src/
├── views/
│   └── HomeView.vue                   # 扩展 trace tab 分支
├── components/
│   └── trace/                         # 新增
│       ├── TraceTab.vue
│       ├── TraceHeader.vue
│       ├── SessionStatsBadge.vue
│       ├── ModelFilter.vue
│       ├── TraceActions.vue
│       ├── LatencyTrend.vue
│       ├── RequestList.vue
│       ├── RequestRow.vue
│       ├── RequestDetailPane.vue
│       ├── FoldingPre.vue
│       └── detail/
│           ├── OverviewPane.vue
│           ├── FlowPane.vue
│           ├── SystemPane.vue
│           ├── MessagesPane.vue
│           ├── ToolsPane.vue
│           ├── ResponsePane.vue
│           └── HeadersPane.vue
├── composables/
│   ├── useElectron.ts                 # 新增 IPC 方法
│   └── useEventStream.ts              # 扩展 envelope:new 事件
└── stores/
    └── trace.ts                       # 新增 Pinia store
```

---

## 12. 实施计划

### Phase 1：协议与解析骨架（3 天）

1. `protocol/envelope.ts`、`protocol/events.ts` 类型定义 + zod 校验。
2. `adapter/turnStateMachine.ts`、`adapter/toolLifecycle.ts`。
3. `adapter/sessionAdapter.ts` 实现 `handleRequest` + `handleSseEvent`。
4. 单元测试：模拟 SSE 事件序列 → 断言 happy envelope 输出。

### Phase 2：移植 ccglass 能力（2 天）

1. `formats/anthropic.ts`（含 Bedrock eventstream 恢复）。
2. `cost/priceTable.ts` 模型定价表。
3. `trace/timing.ts` latency/TTFT/gen/tps 计算。
4. `cost/usage.ts` 跨 session 汇总。
5. 单元测试：固定 SSE raw → 正确 usage/model/cost/trace。

### Phase 3：apiproxy 改造与三层存储（2 天）

1. `apiproxy.ts` 接入 `SessionAdapter`。
2. `archive/happyJsonl.ts` 追加写 happy jsonl。
3. `archive/rawArchive.ts` 写 ccglass 风格 raw exchange（含 trace/cost）。
4. `archive/usageSummary.ts` 增量更新 `usage.json`。
5. 删除旧 `ProxyStageEvent` 相关代码。

### Phase 4：ChannelDispatcher 重写（2 天）

1. `channels/registry.ts` 消费 `LynelEnvelope`。
2. `channels/sse-channel.ts` 转发 envelope。
3. `channels/localfile-channel.ts` 写 happy jsonl。
4. `channels/wecom-channel.ts` 混合推送策略。
5. `channels/cloud-channel.ts` 接口预留。

### Phase 5：IPC 与主进程 API（1 天）

1. `preload.ts` 暴露新方法。
2. `composables/useElectron.ts` 封装。
3. 新增 IPC handler：ListTraceSessions / ListTraceRequests / GetSessionTraceStats / GetTraceRequest / DiffTraceRequests / GetUsageSummary / ExportTraceRequest。

### Phase 6：前端 trace 面板（4 天）

1. `stores/trace.ts`。
2. `components/trace/*.vue` 核心组件。
3. `GlobalTabs` 新增 `'trace'` 类型。
4. `SessionList.vue` 增加"打开 Trace"入口。
5. `useEventStream.ts` 扩展 `envelope:new` 事件。

### Phase 7：端到端验证（2 天）

1. 真实对话跑一遍，验证 happy jsonl 格式正确。
2. 验证 raw archive 含完整 request/response + trace + cost。
3. 验证 usage.json 汇总正确。
4. 验证 WeCom 混合推送正确。
5. 验证 trace tab 的 7 个 detail tab 渲染正确。
6. 验证 hook 审批不被破坏。

**总计约 16 天。**

---

## 13. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| happy 协议演进 | happy 协议标注 UNDER REVIEW，未来可能不兼容 | 类型定义放在 lynel 自己仓内，不依赖 `@slopus/happy-wire`，加 `version` 字段 |
| 企业微信消息刷屏 | 混合策略设计不当导致 | 文本按 turn 合并为一条，tool-call 实时但同一工具的 delta 去重 |
| raw archive 体积大 | 每个 roundtrip 一个文件 + 完整 SSE raw | 未来可加 blob 去重或滚动清理 |
| 前端重写工作量大 | ccglass 完整面板需 7 个 tab + diff + summary | 先实现 overview/messages/tools/response 4 个核心 tab，flow/diff/summary 后续补 |
| hook 审批被误改 | 影响核心权限流程 | hookserver / permission-broker / notch-window 完全不动，代码 review 重点检查 |
| 响应结束时才写 raw，中途崩溃丢数据 | 最后一条 roundtrip 可能没归档 | happy jsonl 实时追加，至少保留了对话视图 |
| trace tab 过多 | 每个 session 都能开 trace tab，tab 数量膨胀 | trace tab 按需关闭，关闭时只销毁视图不丢数据（数据在磁盘） |
| 错误感知遗漏 | tool_result.is_error / HTTP 4xx5xx / 网络错误未显式表达 | 已在 4.3、5.5 节定义，raw archive 加 `error` boolean |
| 多 agent 扩展 | Codex / pi-agent 等接入时改动面不可控 | 4.4 节定义 `FormatAdapter` 接口 + `formats/` 目录结构，Phase 1 只实现 anthropic |

---

## 14. 验收标准

1. 一个 session 的 happy jsonl 中，每个 user 纯文本请求触发 `turn-end` + `user:text` + `turn-start`，tool_result 请求只触发 `tool-call-end`。
2. 一个 tool_use 在 happy jsonl 中呈现为 `tool-call-start`（args 完整）+ `tool-call-end` 两行；`tool_result.is_error === true` 时 `tool-call-end` 携带 `is_error: true` + `error` 摘要。
3. raw archive 中每个 `<sid>/raw/<seq>.json` 都包含完整 request body、完整 response raw、trace、cost、`error` boolean。
4. `usage.json` 中的 `totals.usd` 与所有 raw exchange 的 `cost.usd` 之和一致。
5. trace tab 能打开任意历史 session，展示 request 列表和 7 个 detail tab；errors 过滤按钮能只显示失败的 roundtrip。
6. 企业微信收到 tool-call-start 卡片；`tool-call-end` 成功时更新为"已完成"，失败时更新为"失败：{error}"；turn-end 时收到本轮汇总。
7. hook 审批流程 100% 保持原行为。
8. API HTTP 错误（4xx/5xx）和网络错误能在 happy jsonl 中产生 `service` + `turn-end {failed}`。
9. `formats/anthropic.ts` 实现 `FormatAdapter` 接口，`formats/format.ts` 接口能容纳未来 `openai.ts`、`pi.ts`。
