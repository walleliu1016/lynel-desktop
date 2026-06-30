# Desktop PermissionRequest 处理逻辑

## 一、整体流程

`PermissionRequest` 是**阻塞型 hook**（blocking hook）。Claude Code 发起工具调用前需要授权，会**阻塞等待** Desktop 返回决策。

```text
Claude Code (要执行工具)
   ↓ POST :17527/hook  (PermissionRequest)
Desktop httpserver.handleHook
   ↓ cloudPush.PushHook (同步阻塞)
Cloud /api/hook (from=desktop)
   ↓ handleBlockingHook
   ↓ waitForMobileResponse (popup queue 等待)
Mobile 弹 Popup 卡片
   ↓ 用户点 Allow / Deny
Cloud 拿到决策
   ↓ HTTP response 返回
Desktop httpserver
   ↓ HTTP response 返回
Claude Code (拿到决策，继续或停止)
```

## 二、Desktop 端处理（`httpserver.handleHook`）

```go
// 1. 收到 hook
hookData = {
  hook_event_name: "PermissionRequest",
  session_id, cwd, tool_name, tool_input, ...
}

// 2. 推给 Cloud（同步阻塞，直到 Cloud 返回决策）
output, err := s.cloudPush.PushHook(ctx, userID, sessionID, "", "", &hookData)
//                ↑ 带 from=desktop，Cloud 走 popup 队列等 Mobile

// 3. 把 Cloud 返回的决策原样返回给 Claude Code
c.JSON(200, output)
```

关键点：

- `PushHook` 是**同步阻塞**调用（HTTP client timeout = 360s）。
- 请求体带 `"from": "desktop"`，Cloud 据此走「等 Mobile 用户响应」路径。
- Desktop 不自己做决策，**决策来自 Mobile 用户**（经 Cloud 中转）。

## 三、Hook 注册配置（`setup/autosetup.go`）

PermissionRequest 用**更长超时**（`HookTimeoutLong`），因为要等用户点 Allow/Deny：

```json
"hooks": {
  "PermissionRequest": [{
    "hooks": [{
      "type": "http",
      "url": "http://localhost:17527/hook",
      "timeout": "<long>",
      "headers": {"X-UM-ACCOUNT": "<user_id>"}
    }]
  }]
}
```

各 hook 超时对比：

| Hook 类型 | 超时 |
|----------|------|
| PreToolUse / PostToolUse / Stop 等（非阻塞） | `HookTimeoutShort` |
| Notification (ask) | `HookTimeoutMedium` |
| **PermissionRequest** | **`HookTimeoutLong`** |

## 四、Cloud 端决策逻辑（`buildDesktopOutput`）

Cloud 收到 Mobile 的 popup 响应后，转换成 `HookOutput`：

| Mobile 响应 | 行为 | 说明 |
|------------|------|------|
| `decision: "allow"` | `behavior: "allow"` | 允许执行工具 |
| `decision: "deny"` | `behavior: "deny"` | 拒绝执行工具 |
| `auto_close: true`（超时） | `behavior: "deny", message: "timeout"` | Mobile 没响应，超时拒绝 |

### AskUserQuestion 特殊处理

如果 `tool_name == "AskUserQuestion"` 且用户 allow，会带上 `updatedInput`（用户填的答案）：

```text
isAskUserQuestionPermission(hookData)
  → buildAskUserQuestionUpdatedInput(hookData, resp)
  → decision.UpdatedInput = <用户选择的选项>
```

## 五、返回给 Claude Code 的数据格式

`HookOutput` 用 **camelCase**（Claude Code hook 输出规范）。

### 1. Allow（允许）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

### 2. Deny（拒绝）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny"
    }
  }
}
```

### 3. Timeout（Mobile 没响应，超时）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "timeout"
    }
  }
}
```

### 4. Allow + AskUserQuestion（带用户答案）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": {
        "questions": [
          {
            "question": "用哪个方案?",
            "options": [
              {"label": "方案A"},
              {"label": "方案B"}
            ]
          }
        ]
      }
    }
  }
}
```

### 5. Popup 队列不可用（兜底 deny）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "popup queue not available"
    }
  }
}
```

## 六、关键结构体（`hook/types.go`）

```go
type HookOutput struct {
    ContinueExec       *bool               `json:"continue,omitempty"`
    HookSpecificOutput *HookSpecificOutput `json:"hookSpecificOutput,omitempty"`
    // ... decision, reason, systemMessage 等
}

type HookSpecificOutput struct {
    HookEventName string          `json:"hookEventName"`           // "PermissionRequest"
    Decision      *DecisionOutput `json:"decision,omitempty"`
    // ...
}

type DecisionOutput struct {
    Behavior     string          `json:"behavior"`               // "allow" | "deny"
    UpdatedInput json.RawMessage `json:"updatedInput,omitempty"` // AskUserQuestion 答案
    Message      *string         `json:"message,omitempty"`      // deny 原因
    Interrupt    *bool           `json:"interrupt,omitempty"`
}
```

## 七、Desktop vs Ease 路径区别

两者都先等 Mobile 响应（`waitForMobileResponse`），区别只在拿到响应后：

| 来源 | 拿到 Mobile 响应后 |
|------|-------------------|
| `from=desktop` | **直接把决策作为 HTTP 响应返回给 Desktop** → Desktop 返回 Claude Code |
| `from=ease`（默认） | 把决策转发到下游 API（`DOWNSTREAM_API_URL`），由下游返回最终决策 |

Desktop 推 hook 时固定带 `from=desktop`（`cloudpush/client.go:44`）。
