# 企业微信权限/提问模板卡片改造设计

## 背景

当前 Lynel Desktop 通过企业微信通道推送权限请求（`PermissionRequest`）和 Claude 提问（`AskUserQuestion`）时，使用 Markdown 文本消息，用户需要手动输入 `/allow`、`/deny`、`/answer` 等 slash 命令进行操作。这种交互在手机端不够自然，容易输错命令。

企业微信智能机器人 SDK（`@wecom/aibot-node-sdk`）支持发送 `template_card` 模板卡片消息，并能在用户点击卡片按钮后触发 `template_card_event` 事件。本设计将权限请求和 AskUserQuestion 改造为模板卡片交互，用户点击卡片按钮即可完成允许/拒绝/选择答案。

## 目标

1. `PermissionRequest`（非 `AskUserQuestion`）通过企业微信卡片展示工具信息，并提供「允许 / 拒绝」两个按钮。
2. `AskUserQuestion` 通过企业微信卡片展示问题（含 `header`、`question`、`options`），支持单选、多选、多问题、自定义输入。
3. 用户点击卡片按钮后，主进程解析事件并调用 `permissionBroker.resolve` 完成决策。
4. 处理成功后尝试 `updateTemplateCard` 更新原卡片为「已处理」状态；失败时回复文字提示。
5. 模板卡片发送失败时自动降级为现有 Markdown + slash 命令，确保兼容性。
6. 保留现有 slash 命令作为兜底和习惯兼容。

## 非目标

- 不支持企业微信原生「引用回复」作为命令触发器（SDK 未暴露足够字段）。
- 不删除现有 slash 命令处理逻辑。
- 不改造除 `PermissionRequest` / `AskUserQuestion` 以外的其他事件（如 `tool_use`、`prompt` 等）。

## 设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 整体实现方案 | 提取卡片构建器 | 新增 `src/main/channels/wecom-cards/` 目录，职责清晰，便于测试和扩展。 |
| 权限请求卡片 | `button_interaction` | 两个按钮：允许、拒绝。 |
| AskUserQuestion 单选 | `vote_interaction` 或 `button_interaction` | 点选项即提交。 |
| AskUserQuestion 多选 | `multiple_interaction` | 用户可选多个选项后统一提交。 |
| 多问题 | `multiple_interaction` 多个 `select_list` | 一张卡片内分组展示，统一提交。 |
| 群聊点击策略 | 开放，先点先赢 | 群里任何人点击都生效，与当前 `/allow` 行为一致。 |
| 已处理重复点击 | 回复文字提示 | 提示「该权限请求已在桌面端/企业微信处理，请勿重复操作」。 |
| 保存 msgid | 是 | 发送成功后保存 `msgid`，用于 `updateTemplateCard` 更新原卡片。 |
| 降级策略 | Markdown + slash 命令 | 卡片发送失败时自动降级为现有文本消息。 |

## 架构

```text
Claude Code
    ↓ PermissionRequest hook
HookServer → App.onPermissionRequest
    ↓ permissionBroker.wait(request)
ChannelDispatcher → WeComChannel.send(PermissionRequest)
    ↓ wecom-cards/card-builder.ts
生成 TemplateCard
    ↓ plugin.outbound.sendText({ msgtype: 'template_card', ... })
WeCom Server
    ↓ user clicks button
event.template_card_event
    ↓ wecom-cards/event-handler.ts
解析 event_key → permissionBroker.resolve(id, decision, 'wecom', answers)
    ↓ try updateTemplateCard(msgid, '已处理')
    ↓ Promise resolves → HookServer 返回 decision → Claude Code
```

新增模块：

- `src/main/channels/wecom-cards/card-builder.ts`：根据 `PermissionRequest` / `AskUserQuestion` 构建 `TemplateCard`。
- `src/main/channels/wecom-cards/event-handler.ts`：解析 `template_card_event`，调用 `permissionBroker.resolve`。
- `src/main/channels/wecom-cards/card-store.ts`：保存 `request.id → { msgid, chatId, seq, status }` 映射。

## 数据结构与编码

### event_key 格式

```text
wecom:<action>:<requestId>:[extra]
```

示例：

```text
wecom:allow:550e8400-e29b-41d4-a716-446655440000
wecom:deny:550e8400-e29b-41d4-a716-446655440000
wecom:opt:550e8400-e29b-41d4-a716-446655440000:0:1
wecom:submit:550e8400-e29b-41d4-a716-446655440000
```

- `action`：`allow`、`deny`、`opt`、`submit`。
- `requestId`：`PermissionRequest.id`（UUID），作为全局唯一标识。
- `extra`：可选，如 `opt` 中的问题索引和选项索引。

### AskUserQuestion 输入结构

与现有 `wecom-channel.ts` 中 `parseAskQuestions` 保持一致：

```json
{
  "questions": [
    {
      "header": "可选标题",
      "question": "主要问题内容",
      "multiSelect": false,
      "options": [
        { "label": "选项A", "description": "选项描述（可选）" },
        { "label": "选项B" }
      ]
    }
  ]
}
```

### CardState 结构

```ts
interface CardState {
  requestId: string;
  seq: number;
  chatId: string;
  msgid: string;
  status: 'pending' | 'resolved' | 'cancelled';
  decision?: 'allow' | 'deny';
  answers?: Record<string, string | string[]>;
  sentAt: number;
}
```

## 模块职责

### card-builder.ts

输入：`PermissionRequest` 或 `AskUserQuestion` 的 `toolInput`。

输出：`TemplateCard` 对象，可直接塞入 `sendMessage` / `replyTemplateCard`。

分支：

- `toolName !== 'AskUserQuestion'`：生成 `button_interaction` 卡片，按钮 key 为 `wecom:allow:<id>` 和 `wecom:deny:<id>`。
- `toolName === 'AskUserQuestion'`：
  - 单问题 + 单选：可用 `vote_interaction`。
  - 单问题 + 多选：用 `multiple_interaction`。
  - 多问题：用 `multiple_interaction` 多个 `select_list`。
  - 自定义输入：卡片内加一段说明，提示用户用 `/answer` 命令（或在卡片按钮无法满足时兜底）。

### event-handler.ts

输入：`WsFrame<TemplateCardEventData>`。

输出：调用 `permissionBroker.resolve` 或回复提示。

流程：

1. 从 `frame.body.event.event_key` 解析 action 和 requestId。
2. 从 `card-store` 查询 `CardState`。
3. 若 `status !== 'pending'`：回复「该请求已被处理」。
4. 若 action 为 `allow` / `deny`：直接 resolve。
5. 若 action 为 `submit` / `answer`：从 `frame.body.event.selected_items` 读取选择，组装 `answers`，再 resolve。
6. resolve 成功后：
   - 更新 `card-store` 状态。
   - 尝试 `updateTemplateCard` 更新原卡片。
   - 若 update 失败或超 5 秒，回复文字提示。

### card-store.ts

职责：

- `save(requestId, seq, chatId, msgid)`：发送成功后保存。
- `resolve(requestId, decision, answers)`：更新状态。
- `cancel(requestId)` / `cancelBySession(sessionId)`：清理。
- `get(requestId)`：查询状态。
- `cleanup()`：定时清理 resolved/cancelled 超过 5 分钟的条目；SessionEnd 时清理对应 session。

## 与现有 WeComChannel 的集成

修改 `src/main/channels/wecom-channel.ts`：

1. `send(PermissionRequest)` 分支调用 `card-builder` + `sendContentWithCard`，失败时降级为 `formatPermissionRequest` Markdown。
2. 监听 `event.template_card_event`：在 `connect()` 中给 `wsClient.on('event.template_card_event', ...)` 注册 `event-handler`。
3. 保留现有 `handleCommand` 中的 `/allow`、`/deny`、`/answer`、`/pending` 逻辑。
4. `SessionEnd` 时调用 `cardStore.cancelBySession(sessionId)` 清理。

## 降级策略

触发条件：

- `sendMessage` 返回 errcode ≠ 0。
- WSClient 未连接且 Agent HTTP API 不支持卡片。
- 企业微信账号无模板卡片权限。
- SDK 抛出异常。

行为：

1. 记录日志。
2. 调用现有 `formatPermissionRequest` / `formatAskUserQuestion` 生成 Markdown。
3. 通过 `plugin.outbound.sendText` 发送 Markdown，包含 `/allow <reqId>`、`/deny <reqId>`、`/answer <reqId> ...`。

## 测试策略

### 单元测试

- `card-builder.test.ts`：验证各种 `toolInput` 生成正确 `TemplateCard`。
- `event-handler.test.ts`：mock `permissionBroker`，验证 allow/deny/submit 事件解析与 resolve 调用。
- `card-store.test.ts`：验证 save/update/cleanup 行为。

### 集成测试

- `wecom-channel.test.ts`：mock `plugin.outbound.sendText`，验证：
  - `PermissionRequest` 默认走卡片路径。
  - 卡片发送失败时降级 Markdown。
  - `event.template_card_event` 被正确路由。

### 手动测试

- 真实企业微信环境点击卡片按钮，验证 end-to-end。
- 验证旧 slash 命令仍然可用。

## 风险与限制

1. `updateTemplateCard` 受 5 秒窗口限制：用户点击过晚时无法更新原卡片，只能文字提示。
2. 企业微信模板卡片渲染依赖客户端版本：极旧版本可能显示异常。
3. `multiple_interaction` 的 `selected_items` 字段名和结构需要与真实事件对齐，目前依赖 SDK 文档和实测。
4. 群聊开放策略下，多个用户可能同时点击，先到达服务端者生效。
5. 自定义输入场景（非选项答案）无法通过卡片按钮完成，仍需 `/answer` 命令。

## 后续可扩展

- 当 SDK 支持更丰富的卡片组件（如输入框）时，可把自定义输入也纳入卡片。
- 当入站 `quote` 字段携带原消息 msgid 时，可考虑支持引用回复作为命令触发器。
