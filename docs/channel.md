# 企业微信通道（Channel）

Lynel Desktop 通过 `@wecom/wecom-openclaw-plugin` 接入企业微信，实现 Claude 与企业微信之间的双向消息转发。

## 能力

- **outbound**：把 Claude 会话中的关键阶段自动推送到企业微信。
  - `prompt`：用户输入
  - `response_complete`：AI 完整回复
  - `tool_use` / `tool_result`：工具调用与结果
  - `PermissionRequest`：权限请求
  - `SessionEnd` / `error`：会话结束或错误
- **inbound**：在企业微信里发送文字/图文混排消息，自动转发到当前活动 Claude 会话。

## 配置

在 GUI 设置页切换到 **Channel** 标签页，填写：

| 字段 | 说明 |
|---|---|
| 启用 | 总开关 |
| Chat ID | 目标聊天 ID（用户 ID 或群聊 ID） |
| Bot ID | 企业微信智能体 Bot ID |
| Secret | 企业微信智能体 Secret |

可选 Agent 配置（Bot WebSocket 不可用时作为 outbound 回退）：

| 字段 | 说明 |
|---|---|
| Corp ID | 企业 ID |
| Corp Secret | 应用 Secret |
| Agent ID | 应用 Agent ID |
| Token | 回调验证 Token |
| Encoding AES Key | 消息加密密钥 |

## 数据流

### outbound

```
Claude PTY → apiproxy → ChannelDispatcher → WeComChannel
                                          ↓
                             @wecom/wecom-openclaw-plugin
                                          ↓
                                    企业微信 WS/HTTP
```

### inbound

```
企业微信 WS → WSClient.on('message') → WeComChannel
                                          ↓
                              session.send(sid, text)
                                          ↓
                                     Claude PTY
```

## 路由规则

inbound 消息按以下优先级选择目标 session：

1. 若消息 `chatId` 之前有过 outbound 发送记录，则路由到该 session。
2. 否则路由到最近活跃的 session（任意阶段事件经过时都会更新）。
3. 两者都没有时，消息被丢弃并打日志。

## 实现文件

- `src/main/channels/wecom-channel.ts`：通道核心（WS 连接、收发、路由）
- `src/main/channels/registry.ts`：ChannelDispatcher
- `src/main/apiproxy.ts`：产生阶段事件
- `src/main/session.ts`：把 inbound 文本写入 PTY
- `frontend/src/components/settings/ChannelTab.vue`：配置界面
