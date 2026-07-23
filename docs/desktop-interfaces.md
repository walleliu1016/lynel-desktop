# Desktop → Cloud 上行 API 接口

本文档描述 Desktop（`ease-desktop`）调用 Cloud 的两个 HTTP 接口。Cloud 监听 `cloud_server_url`（默认端口 17527）。

---

## 1. `POST /api/envelope/push`

批量上传**已构建好的 `LynelEnvelope`**，在保存到本地的时候异步发送给cloud。

### 请求

```
POST {cloudURL}/api/envelope/push
Content-Type: application/json
```

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | 是 | 用户标识，envelope 推送与入库的目标用户。 |
| `session_id` | string | 否 | 会话级**路由回退值**。仅当 envelope 自身无 `sessionId` 时兜底。 |
| `from` | string | 否 | 来源标识（`"ease"` / `"desktop"`），仅用于日志，不影响行为。 |
| `envelopes` | `LynelEnvelope[]` | 是 | 批量 envelope 数组，**不能为空数组**。 |

#### `LynelEnvelope` 结构（顶层字段，详见 `docs/envelope-format.md`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | envelope 唯一 id（上游生成）。 |
| `time` | number | 毫秒时间戳。 |
| `seq` | number | 上游序号（入库时 Cloud 重写 DB 列 `seq`，此字段原样保留在 JSON 中，不用于 DB 排序）。 |
| `role` | `"user"` \| `"agent"` | 产出方。 |
| `sessionId` | string | **权威**会话 id。为空时回退请求体 `session_id`；仍为空则该 envelope 被跳过。 |
| `turn` | string | 轮次 id（可选）。 |
| `subagent` | string | 子代理 id（可选）。 |
| `agent` | string | 默认 `"claude"`。 |
| `usage` | object | token 用量（可选）。 |
| `ev` | object | 事件体，`t` 取值：`text` / `service` / `tool-call-start` / `tool-call-end` / `turn-start` / `turn-end` / `start` / `stop` / `file`（详见 `docs/envelope-format.md`）。 |

#### 请求示例

```json
{
  "user_id": "alice",
  "session_id": "s1",
  "from": "ease",
  "envelopes": [
    {
      "id": "e1",
      "time": 1753280000000,
      "seq": 1,
      "role": "agent",
      "sessionId": "s1",
      "agent": "claude",
      "ev": { "t": "turn-start" }
    },
    {
      "id": "e2",
      "time": 1753280000123,
      "seq": 2,
      "role": "agent",
      "sessionId": "s1",
      "agent": "claude",
      "ev": { "t": "text", "text": "hello" }
    }
  ]
}
```

### 响应

#### 成功（`200 OK`）

无论批次内是否有 envelope 被跳过/入库失败，只要请求格式合法即返回 `200`，失败计数体现在 body。

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | bool | 固定 `true`（请求被正常处理）。 |
| `pushed` | int | 成功推送给 Mobile 的 envelope 数。 |
| `stored` | int | 成功写入 `session_envelopes` 的 envelope 数。 |
| `error` | string | 成功时不出现。 |

```json
{
  "ok": true,
  "pushed": 2,
  "stored": 2
}
```

#### 失败（`400 Bad Request`）

触发条件：JSON 解析失败 / `user_id` 缺失 / `envelopes` 为空数组。

```json
{ "ok": false, "error": "envelopes is required" }
```

### curl

```bash
curl -X POST http://<cloud>:17527/api/envelope/push \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "alice",
    "session_id": "s1",
    "envelopes": [
      {"id":"e1","seq":1,"role":"agent","sessionId":"s1","agent":"claude","ev":{"t":"text","text":"hi"}}
    ]
  }'
```

---

## 2. `POST /api/sessions/sync`

批量上传**本地启动的会话**，还有就是打开新会话成功也要调用同步过去。

### 请求

```
POST {cloudURL}/api/sessions/sync
Content-Type: application/json
```

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | 是 | 用户标识。 |
| `sessions` | `Session[]` | 是 | 本地会话数组。可为空数组（仅记日志）。 |

#### `Session` 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 id。 |
| `jsonl_path` | string | 否 | JSONL 文件绝对路径，供历史查询定位。 |
| `cwd` | string | 否 | 会话工作目录。 |
| `project_name` | string | 否 | 项目名；为空时 Cloud 回退用 `title`。 |
| `title` | string | 否 | 会话标题。 |
| `last_activity_at` | int64 | 否 | 最后活动时间（unix 秒）。 |

#### 请求示例

```json
{
  "user_id": "alice",
  "sessions": [
    {
      "session_id": "s1",
      "jsonl_path": "/home/alice/.claude/projects/-home-alice-work-app/s1.jsonl",
      "cwd": "/home/alice/work/app",
      "project_name": "app",
      "title": "实现登录功能",
      "last_activity_at": 1753280000
    }
  ]
}
```

### 响应

#### 成功（`200 OK`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `synced` | int | 成功 upsert 的会话数。 |
| `errors` | string[] | 失败项（格式 `"<session_id>: <原因>"`），**无失败时不出现**。 |

无失败：

```json
{ "synced": 1 }
```

部分失败：

```json
{
  "synced": 0,
  "errors": ["s1: upsert failed: db connection refused"]
}
```

#### 失败

| HTTP 状态 | 场景 | 响应体 |
|-----------|------|--------|
| `400 Bad Request` | JSON 解析失败 / `user_id` 缺失 | `{"error": "<原因>"}` |
| `503 Service Unavailable` | Cloud 未配置数据库（`repo` 为空） | `{"error": "repo not configured"}` |

### curl

```bash
curl -X POST http://<cloud>:17527/api/sessions/sync \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "alice",
    "sessions": [
      {"session_id":"s1","cwd":"/home/alice/work/app","project_name":"app","title":"实现登录功能","last_activity_at":1753280000}
    ]
  }'
```
