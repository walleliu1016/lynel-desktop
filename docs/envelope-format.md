# LynelEnvelope 消息格式

## 概述

LynelEnvelope 是 Lynel Desktop 内部统一的事件消息格式。apiproxy 拦截 Claude API 的 SSE 流，通过 `SessionAdapter` 将其映射为 LynelEnvelope 序列，经由 `ChannelDispatcher` 分发给各输出通道（SSE、企业微信、本地文件），同时落盘到 `envelopes.jsonl` 供前端消费。

## 数据结构

### LynelEnvelope

```typescript
interface LynelEnvelope {
  id: string;            // UUID，消息唯一标识
  time: number;          // 毫秒时间戳
  seq: number;           // 全局自增序号，跨 session 共享
  role: 'user' | 'agent';
  sessionId?: string;    // 会话 ID
  turn?: string;         // 轮次 ID（文本/工具调用在同一轮中）
  subagent?: string;     // 子 agent 名（预留）
  agent?: string;        // agent 标识，默认 "claude"
  claudeUuid?: string;   // Claude 消息 UUID
  claudeMsgId?: string;  // Claude 消息 ID
  usage?: SessionUsage;  // token 用量（仅部分事件携带）
  ev: SessionEvent;      // 事件体
}
```

### SessionEvent — 9 种事件类型

| 事件类型 (`t`) | 字段 | 说明 |
|---|---|---|
| `text` | `text: string`, `thinking?: boolean` | 文本输出。`thinking=true` 表示思考过程 |
| `service` | `text: string` | 系统通知（超时、重试等） |
| `file` | `ref, name, size, mimeType?, image?` | 文件输出（预留） |
| `tool-call-start` | `call, name, title, description, args` | 工具调用开始，含完整参数 |
| `tool-call-end` | `call, is_error?, error?` | 工具调用结束 |
| `turn-start` | — | 新轮次开始 |
| `turn-end` | `status: 'completed' \| 'failed' \| 'cancelled'` | 轮次结束 |
| `start` | `title?` | 会话开始（预留） |
| `stop` | — | 会话停止（预留） |

当前已实现的事件：`text`, `service`, `tool-call-start`, `tool-call-end`, `turn-start`, `turn-end`。

### SessionUsage

```typescript
interface SessionUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  context_window?: number;
  service_tier?: string;
}
```

仅 `text`、`tool-call-end`、`service` 事件可能携带 usage，`turn-start/end`、`start/stop` 不会。

## 数据流

```
Claude API SSE
     │
     ▼
  apiproxy (HTTP 反向代理)
     │  parseSseChunk → SseEvent
     │  SessionAdapter.handleSseEvent → LynelEnvelope[]
     ▼
  dispatchEnvelopes(token, envelopes, emit)
     ├──→ HappyJsonlWriter.append  (envelopes.jsonl)
     └──→ emit → ChannelDispatcher → OutputChannel[]
                                        ├── SSEChannel (推送到前端)
                                        ├── WeComChannel (推送到企业微信)
                                        ├── LocalfileChannel (写入本地文件)
                                        └── StateChannel (驱动灵动岛)
```

## 磁盘文件布局

```
~/.lynel-desktop/projects/<encoded-project>/
  <sessionId>/
    envelopes.jsonl        ← LynelEnvelope 行序列（每行 JSON）
```

### envelopes.jsonl

每行一个 LynelEnvelope（经 `stripEnvelope` 序列化，仅含非 undefined 字段）。行追加写，前端通过 `ListHappyEnvelopes` IPC 读取。

## SessionAdapter 映射规则

### 请求阶段 (handleRequest)

| 请求体内容 | 生成的 LynelEnvelope |
|---|---|
| 用户消息（纯文本） | `role:user, t:text, text:<用户输入>` |
| tool_result | `role:user, t:tool-call-end, call:<tool_use_id>, is_error:<bool>` |
| turn 边界检测 | 自动关闭上一轮 `t:turn-end, status:completed` |

### 响应阶段 (handleSseEvent)

| SSE 事件 | 生成的 LynelEnvelope |
|---|---|
| `message_start` | 记录 messageId、input_tokens，新 turn 准备 |
| `content_block_start` (text) | 后续 delta 累积到 `t:text` |
| `content_block_start` (thinking) | 后续 delta 累积到 `thinking:true` 的 `t:text` |
| `content_block_start` (tool_use) | `t:tool-call-start, call:<id>, name:<name>, args:<input>` |
| `content_block_delta` (text_delta) | 增量拼接 → 发出 `t:text` |
| `content_block_delta` (thinking_delta) | 增量拼接 → 发出 `t:text, thinking:true` |
| `content_block_delta` (input_json_delta) | 增量拼接 → 补全 tool-call-start 的 args |
| `content_block_stop` | content block 结束 |
| `message_delta` | 更新 usage，附加到上一条 envelope |
| `message_stop` | 发出 `t:turn-end, status:completed` |
| `error` | 自定义格式 → 发出 `t:turn-end, status:failed` |

## 通道分发

`ChannelDispatcher` 注册多个 `OutputChannel`，逐个 dispatch 并隔离错误：

- **SSEChannel**: 通过 `text/event-stream` 推送到前端订阅
- **WeComChannel**: 通过企业微信 bot WebSocket 发送消息；支持 `push_thinking` / `push_tool_calls` 开关过滤
- **LocalfileChannel**: 写入本地 JSONL 文件供调试
- **StateChannel**: 驱动灵动岛（NotchView）渲染权限请求状态

