# Desktop 与 Cloud 全量 Socket.IO 通信方案

## 概述

Desktop 通过 Socket.IO 连接 Cloud（端口 17528，与 Mobile App 共用同一端口），取代除登录外的所有 HTTP 接口。登录仍用 `POST /api/auth/login` 拿 JWT。

**事件命名约定**：所有 Desktop 事件统一 `desktop:` 前缀，如 `desktop:hook:batch`、`desktop:session:sync`。Mobile 事件保持无前缀（`hook:message`、`session:chat`）。双方事件名完全隔离。

```
Desktop                                   Cloud (17528)
  │                                          │
  │ 1. POST /api/auth/login ──────────────→  │  拿 JWT（HTTP，保留）
  │ ←─ {success, token} ────────────────────  │
  │                                          │
  │ 2. socket.io 连接 ─────────────────────────  ws://cloud:17528/socket.io/
  │ 3. desktop:auth {user_id, token} ──────→  │  认证
  │ ←─ auth:success ──────────────────────────  │
  │                                          │
  │ 4. desktop:session:sync {sessions} ────→  │  启动时上报
  │ 5. desktop:envelope:push {envelopes} ──→  │  批量推
  │ 6. desktop:hook:batch {hooks} ────────→  │  非审批 hook 批量
  │ 7. desktop:hook:permission {req_id, data}→  │  阻塞 PermissionRequest
  │ ←─ desktop:hook:result {req_id, decision}  │  审批结果
  │ 8. desktop:hook:abort {req_id, data} ──→  │  取消审批
  │                                          │
  │ ←─ desktop:chat {session_id, question}      Mobile 发来消息
```

---

## 第一部分：Socket.IO 事件总表

### Desktop → Cloud（上行事件）

所有 Desktop 事件统一 `desktop:` 前缀，与 Mobile 事件完全隔离。

| 事件名 | 触发时机 | 替代的 HTTP 接口 | 响应方式 |
|---|---|---|---|
| `desktop:auth` | 连接建立后 | 新（取代旧 HTTP 鉴权） | `auth:success` / `auth:failed` |
| `desktop:session:sync` | 认证成功后 + 会话变更时 | `POST /api/sessions/sync` | fire-and-forget |
| `desktop:envelope:push` | 每 3s flush 或满 50 条 | `POST /api/envelope/push` | fire-and-forget |
| `desktop:hook:batch` | 非审批 hook 批量上报 | `POST /api/hook` action=forward（数组） | fire-and-forget |
| `desktop:hook:permission` | 单个 PermissionRequest | `POST /api/hook` action=forward（单对象） | `desktop:hook:result`（异步回调） |
| `desktop:hook:abort` | 本地胜出时取消云端等待 | `POST /api/hook` action=abort | fire-and-forget |

### Cloud → Desktop（下行事件）

| 事件名 | 说明 |
|---|---|
| `auth:success` | 认证成功 |
| `auth:failed` | 认证失败 |
| `desktop:hook:result` | PermissionRequest 决策结果（匹配 request_id） |
| `desktop:chat` | Mobile App 向 desktop 会话发消息 |

---

## 第二部分：Cloud 端改造（Go）

### 1. 新增消息类型 — `internal/shared/message/types.go`

```go
// ---- Desktop 通道消息 ----

// DesktopAuth - Desktop 认证
type DesktopAuth struct {
    UserID       string `json:"user_id"`
    Token        string `json:"token,omitempty"`
    UserPassword string `json:"user_password,omitempty"`
}
func (m DesktopAuth) Type() string { return "desktop:auth" }

// DesktopSessionSync - Desktop 同步会话（替代 HTTP /api/sessions/sync）
type DesktopSessionSync struct {
    Sessions []DesktopSyncSessionItem `json:"sessions"`
}
type DesktopSyncSessionItem struct {
    SessionID      string `json:"session_id"`
    JsonlPath      string `json:"jsonl_path,omitempty"`
    Cwd            string `json:"cwd,omitempty"`
    ProjectName    string `json:"project_name,omitempty"`
    Title          string `json:"title,omitempty"`
    LastActivityAt int64  `json:"last_activity_at,omitempty"`
}
func (m DesktopSessionSync) Type() string { return "desktop:session:sync" }

// DesktopEnvelopePush - Desktop 批量推 envelope（替代 HTTP /api/envelope/push）
type DesktopEnvelopePush struct {
    Envelopes []json.RawMessage `json:"envelopes"`
}
func (m DesktopEnvelopePush) Type() string { return "desktop:envelope:push" }

// DesktopHookBatch - Desktop 批量非审批 hook（替代 HTTP /api/hook action=forward 数组）
type DesktopHookBatch struct {
    Hooks []json.RawMessage `json:"hooks"`
}
func (m DesktopHookBatch) Type() string { return "desktop:hook:batch" }

// DesktopHookPermission - Desktop PermissionRequest（替代 HTTP /api/hook action=forward 单对象）
type DesktopHookPermission struct {
    RequestID string          `json:"request_id"`
    Data      json.RawMessage `json:"data"`
}
func (m DesktopHookPermission) Type() string { return "desktop:hook:permission" }

// DesktopHookAbort - Desktop 取消 PermissionRequest（替代 HTTP /api/hook action=abort）
type DesktopHookAbort struct {
    RequestID string          `json:"request_id"`
    Decision  string          `json:"decision,omitempty"`
    Data      json.RawMessage `json:"data"`
}
func (m DesktopHookAbort) Type() string { return "desktop:hook:abort" }

// DesktopHookResult - Cloud → Desktop PermissionRequest 结果
type DesktopHookResult struct {
    RequestID string      `json:"request_id"`
    Decision  string      `json:"decision"` // "allow" | "deny"
    Output    interface{} `json:"output,omitempty"` // Claude standard hook output
}
func (m DesktopHookResult) Type() string { return "desktop:hook:result" }

// DesktopChat - Cloud → Desktop 聊天消息（来自 Mobile）
type DesktopChat struct {
    SessionID string `json:"session_id"`
    Question  string `json:"question"`
    UserID    string `json:"user_id"`
}
func (m DesktopChat) Type() string { return "desktop:chat" }
```

同时在 `ParseCloudMessage` 中补充对应 case。

### 2. Router 新增 Desktop 连接管理 — `internal/cloud/router/router.go`

已部分完成，需补充的方法：

```go
// （已完成）RegisterDesktopSocket / UnregisterDesktop / HasDesktopSubscribers / GetDesktopSocket

// GetDesktopSockets 返回某用户所有 Desktop socket（用于广播）
func (r *ConnectionRouter) GetDesktopSockets(userID string) []*socket.Socket
```

### 3. Socket.IO 事件处理 — `internal/cloud/sio/handlers.go`

`handleConnection` 中注册的事件：

```go
client.On("desktop:auth", func(args ...any) { s.handleDesktopAuth(client, args...) })
client.On("desktop:session:sync", func(args ...any) { s.handleDesktopSessionSync(client, args...) })
client.On("desktop:envelope:push", func(args ...any) { s.handleDesktopEnvelopePush(client, args...) })
client.On("desktop:hook:batch", func(args ...any) { s.handleDesktopHookBatch(client, args...) })
client.On("desktop:hook:permission", func(args ...any) { s.handleDesktopHookPermission(client, args...) })
client.On("desktop:hook:abort", func(args ...any) { s.handleDesktopHookAbort(client, args...) })
```

各 handler 逻辑：

**`handleDesktopAuth`（新增）** — 同 `handleMobileAuth` 逻辑，token 或密码验证、白名单检查，通过后 `router.RegisterDesktopSocket`，`client.Join(Room("user:"+userID))`，返回 `auth:success`。

**`handleDesktopSessionSync`（新增）** — 接收 `SessionSync`，解析后调 `repo.UpsertSession`，累加计数后通过 socket 确认。

**`handleDesktopEnvelopePush`（新增）** — 接收 `EnvelopePush`，逐条调 `storeAndPushEnvelope`（复用 `httpapi.Server` 的已有方法），计数后确认。注意：`httpapi` 的 `storeAndPushEnvelope` 是方法，需要把 `sendToMobile` 回调传递给 sio 层，或者 sio 直接调 repo 存 + `EmitToUser` 推给 Mobile。

**`handleDesktopHookBatch`（新增）** — 接收 `HookBatch`，逐条解析 hook_event_name + session_id，forward 给 Mobile（`emitToUser("hook:message", ...)`），同时走 `applyDesktopLifecycle` 更新 session 状态。

**`handleDesktopHookPermission`（新增）** — 接收 `DesktopHookPermission`，解析 `Data` 为 `hook.HookData`，入 popup 队列等 Mobile 响应，响应后通过 socket emit `desktop:hook:result` 回 Desktop。需要超时控制。

**`handleDesktopHookAbort`（新增）** — 接收 `DesktopHookAbort`，调 `popupQueue.CancelSessionPopups(sessionID)`。

**`handleSessionChat` 的 desktop 路由** — 查 session source，如果是 desktop 则 `s.io.To(socket.Room("user:"+userID)).Emit("desktop:chat", msg)` 广播给所有实例上该用户的 Desktop 客户端。

### 4. 数据流通路

```
Desktop Socket.IO handler
  │
  ├─ handleDesktopSessionSync     → repo.UpsertSession
  ├─ handleDesktopEnvelopePush    → storeAndPushEnvelope → repo + EmitToUser(Mobile)
  ├─ handleDesktopHookBatch       → emitToUser("hook:message", ...) + 状态更新
  ├─ handleDesktopHookPermission  → popupQueue.WaitForResponse → emit "desktop:hook:result" 回 Desktop
  └─ handleDesktopHookAbort       → popupQueue.CancelSessionPopups
```

### 5. Cloud 端文件改动清单

| 文件 | 改动 |
|---|---|
| `internal/shared/message/types.go` | 新增 DesktopAuth/DesktopSessionSync/DesktopEnvelopePush/DesktopHookBatch/DesktopHookPermission/DesktopHookAbort/DesktopHookResult/DesktopChat 消息类型 + ParseCloudMessage 补充 |
| `internal/cloud/router/router.go` | 已改完（Register/Unregister/Has/GetDesktopSocket）+ 补 GetDesktopSockets |
| `internal/cloud/sio/server.go` | handleConnection 中注册 desktop 事件组 |
| `internal/cloud/sio/handlers.go` | 新增 handleDesktopAuth/handleDesktopSessionSync/handleDesktopEnvelopePush/handleDesktopHookBatch/handleDesktopHookPermission/handleDesktopHookAbort + handleSessionChat 增加 desktop 路由分支 |

---

## 第三部分：Desktop 端改造（TypeScript）

### 1. 安装依赖

```bash
npm install socket.io-client
# 或
pnpm add socket.io-client
```

### 2. 新增 `DesktopSocket` 类

建议新建 `src/main/channels/desktop-socket.ts`，类比现有 `CloudChannel`。

```typescript
import { io, Socket } from 'socket.io-client'

interface DesktopSocketConfig {
  url: string        // Cloud 服务器地址，如 https://cloud.example.com
  token: string      // JWT，从 POST /api/auth/login 获取
  userID: string     // 当前用户标识
}

export class DesktopSocket {
  private socket: Socket | null = null
  private config: DesktopSocketConfig
  private pendingRequests: Map<string, { 
    resolve: (v: any) => void, 
    reject: (e: Error) => void,
    timer: NodeJS.Timeout 
  }> = new Map()
  
  // 回调注册
  onChatMessage: ((sessionId: string, question: string) => void) | null = null

  constructor(config: DesktopSocketConfig) {
    this.config = config
  }

  connect() {
    this.socket = io(this.config.url, {
      transports: ['websocket'],      // 直接 WebSocket，不走 polling
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    this.socket.on('connect', () => {
      console.log('[desktop-socket] connected, authenticating...')
      this.emit('desktop:auth', {
        user_id: this.config.userID,
        token: this.config.token,
      })
    })

    this.socket.on('auth:success', () => {
      console.log('[desktop-socket] authenticated')
      // 认证成功后同步会话
      this.syncSessions()
    })

    this.socket.on('auth:failed', (data: { reason?: string }) => {
      console.error('[desktop-socket] auth failed:', data.reason)
    })

    this.socket.on('desktop:chat', (data: { 
      session_id: string, 
      question: string, 
      user_id: string 
    }) => {
      console.log('[desktop-socket] chat from mobile:', data.session_id, data.question)
      this.onChatMessage?.(data.session_id, data.question)
    })

    this.socket.on('desktop:hook:result', (data: { 
      request_id: string, 
      decision: string,
      output?: any 
    }) => {
      const pending = this.pendingRequests.get(data.request_id)
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(data)
        this.pendingRequests.delete(data.request_id)
      }
    })

    this.socket.on('disconnect', (reason) => {
      console.log('[desktop-socket] disconnected:', reason)
    })
  }

  disconnect() {
    this.socket?.disconnect()
    this.socket = null
  }
```

### 3. 各功能方法

```typescript
// 认证后同步会话 / 取代 POST /api/sessions/sync
private syncSessions() {
  const sessions = this.collectLocalSessions()  // 从本地 InstanceManager 获取
  this.emit('desktop:session:sync', { sessions })
}

// 批量推 envelope / 取代 POST /api/envelope/push
pushEnvelopes(envelopes: any[]) {
  this.emit('desktop:envelope:push', { envelopes })
}

// 批量非审批 hook / 取代 POST /api/hook action=forward 数组
sendHookBatch(hooks: Record<string, unknown>[]) {
  this.emit('desktop:hook:batch', { hooks })
}

// PermissionRequest（阻塞，等响应）/ 取代 POST /api/hook action=forward 单对象
sendPermissionRequest(requestId: string, data: any, timeoutMs = 2 * 60 * 60 * 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(requestId)
      reject(new Error('cloud permission timeout'))
    }, timeoutMs)

    this.pendingRequests.set(requestId, { resolve, reject, timer })
    this.emit('desktop:hook:permission', { request_id: requestId, data })
  })
}

// 取消 PermissionRequest / 取代 POST /api/hook action=abort
abortPermissionRequest(requestId: string, decision: string, data: any) {
  this.emit('desktop:hook:abort', { request_id: requestId, decision, data })
}

// 通用 emit
private emit(event: string, data: any) {
  if (!this.socket?.connected) {
    console.warn('[desktop-socket] not connected, dropping', event)
    return
  }
  this.socket.emit(event, data)
}

// 连接状态
isConnected(): boolean {
  return this.socket?.connected ?? false
}
```

### 4. 集成到 `app.ts`

```typescript
import { DesktopSocket } from './channels/desktop-socket'
```

- 启动时：`POST /api/auth/login` → 获得 token → 创建 `DesktopSocket` → `connect()`
- 替代原来的 `CloudChannel` 各种 HTTP 调用

### 5. 原有 HTTP 接口的保留与替换对照

| HTTP 接口 | 替换状态 | 备注 |
|---|---|---|
| `POST /api/auth/login` | ✅ 保留 | 仍用于拿 JWT |
| `POST /api/health` | ❌ 废弃 | socket 连接成功 = 健康 |
| `POST /api/sessions/sync` | ❌ 废弃 | 改为 socket `desktop:session:sync` 事件 |
| `POST /api/envelope/push` | ❌ 废弃 | 改为 socket `desktop:envelope:push` 事件 |
| `POST /api/hook` batch | ❌ 废弃 | 改为 socket `desktop:hook:batch` 事件 |
| `POST /api/hook` PermissionRequest | ❌ 废弃 | 改为 socket `desktop:hook:permission` + `desktop:hook:result` |
| `POST /api/hook` abort | ❌ 废弃 | 改为 socket `desktop:hook:abort` 事件 |

### 6. Desktop 端文件改动清单

| 文件 | 改动 |
|---|---|
| `package.json` | 添加 `socket.io-client` 依赖 |
| `src/main/channels/desktop-socket.ts` | 新建 — DesktopSocket 类 |
| `src/main/app.ts` | 集成 DesktopSocket：启动时 login → connect，替代 CloudChannel 的调用 |
| `src/main/channels/cloud-channel.ts` | 保留或简化（回退方案） |

---

## 第四部分：架构要点

### 跨实例

Mobile 与 Desktop 可能不在同一 Cloud 实例。Desktop 认证时 `Join(Room("user:"+userID))`，`desktop:chat` 通过 `s.io.To(room).Emit()` 广播（PostgreSQL Adapter 自动跨实例分发）。

### 事件命名空间隔离

所有 Desktop 事件统一 `desktop:` 前缀（`desktop:auth`、`desktop:hook:batch`、`desktop:session:sync` 等），Mobile 事件保持无前缀（`hook:message`、`session:chat` 等）。双方事件名完全不重叠，连同一端口、同一条连接线也不会弄混。

### PetPermissionRequest 阻塞模式

Desktop 发 `hook:permission` → Cloud 入 popup 等 Mobile → Mobile 响应 → Cloud emit `hook:response` 回 Desktop。Desktop 端用 `request_id` 做 Promise 匹配，带超时。

### 安全和重连

- JWT 从 HTTP 登录获取，Socket.IO 连接时通过 `desktop:auth` 带上
- Socket.IO 自带断线重连，重连后自动重新认证
- `desktop:auth` 认证逻辑与 `mobile:auth` 完全一致（token/密码/白名单）
