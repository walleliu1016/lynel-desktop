# Desktop 会话同步对接指南

> 日期：2026-08-06
> 目标读者：Desktop 端开发者

## 一、背景

当前 Desktop 和 Mobile App 的会话列表数据不一致：

1. **状态语义混乱**：`status` 字段混合了"是否打开"和"Claude 在干什么"两个维度（idle/working/waiting/error/ended 混在一起），导致 Cloud 无法准确判断一个会话是打开还是关闭。

2. **增量事件不可靠**：Desktop 推送 created/opened/closed 增量事件到 Cloud，但网络抖动或崩溃时事件丢失，Cloud DB 与 Desktop 本地数据产生偏差且无法自愈。

3. **缺少设备隔离**：同一账号多台机器时，无法区分哪台机器的会话属于谁，导致一台机器的操作影响另一台。

4. **历史会话不同步**：Desktop 本地删除了已关闭的历史会话，但 Cloud/Mobile 不知道。

## 二、目的

重新设计 Desktop → Cloud 的会话同步机制，实现三方一致：

- **Desktop 本地**（权威）：用户手动管理会话（创建/打开/关闭/改标题/删除）
- **Cloud DB**（副本）：存储 + 转发
- **Mobile App**（消费者）：从 Cloud 读取，与 Desktop 一致

核心原则：**Desktop 是权威数据源**，Cloud 只做存储副本 + 转发。

## 三、状态模型变更

### 3.1 旧模型（废弃）

```
status: idle / working / waiting / error / ended
```

一个字段承载两重含义，语义不清。

### 3.2 新模型（采用）

两个字段，正交分离：

| 字段 | 取值 | 含义 | 谁决定 |
|------|------|------|--------|
| `status` | `open` / `ended` | **会话是否打开** | **Desktop**（用户点按钮） |
| `activity` | `idle` / `working` / `waiting` / `error` | **Claude 当前在干什么**（仅 open 时有意义） | **Cloud**（hook 事件更新） |

**规则**：
- `status=ended` 时 `activity` 无意义（置空）。
- **Desktop 只负责 `status`**（用户点打开/关闭按钮）。
- **`activity` 由 Cloud 根据 hook 事件维护，Desktop 不需要推送 activity**。Desktop 发送的 sync 消息里不带 activity 字段。

### 3.3 对应关系（迁移参考）

| 旧 status | 新 status | 新 activity |
|-----------|-----------|-------------|
| idle | open | idle |
| working | open | working |
| waiting | open | waiting |
| error | open | error |
| ended | ended | （无） |

> Desktop 端只需把本地的 `status` 收敛为 `open` / `ended` 两个值。activity 不在 Desktop 关心范围内。

## 四、消息协议变更

### 4.1 事件名不变

继续使用 `desktop:session:sync` 事件。

### 4.2 新增 mode 字段区分两种模式

#### 模式一：全量快照（snapshot）—— 重连时 / 集合变化后去抖发送

```json
{
  "mode": "snapshot",
  "machine_name": "alice-mbp",
  "sessions": [
    {
      "session_id": "sess-1",
      "project_name": "my-project",
      "title": "Chat with Claude",
      "status": "open"
    },
    {
      "session_id": "sess-2",
      "project_name": "another-project",
      "title": "Debug session",
      "status": "open"
    },
    {
      "session_id": "sess-3",
      "project_name": "old-project",
      "title": "Old session",
      "status": "ended"
    }
  ]
}
```

**要点**：
- `mode = "snapshot"` 表示这是全量快照
- `machine_name` 必填：本机唯一标识（如主机名），用于多设备隔离
- `sessions` 包含该设备**所有**会话（open + ended），最多最近 30 个
- 每个 session 必须包含 `session_id`、`status`（open/ended）
- **不带 activity**（Cloud 侧维护）

#### 模式二：单次操作（event）—— 用户点击按钮后立即发送

```json
{
  "mode": "event",
  "machine_name": "alice-mbp",
  "sessions": [
    {
      "session_id": "sess-1",
      "event": "opened",
      "project_name": "my-project",
      "title": "Chat with Claude",
      "status": "open"
    }
  ]
}
```

**event 取值**：

| event | 含义 | 对应的用户操作 |
|-------|------|---------------|
| `created` | 创建新会话 | 用户新建会话记录 |
| `opened` | 打开会话 | 用户点"打开"按钮 |
| `closed` | 关闭会话 | 用户点"关闭"按钮 |
| `title_updated` | 更新标题 | 用户修改会话标题 |

### 4.3 字段完整定义

每个 session item 的字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | ✅ | 会话唯一标识 |
| `machine_name` | string | ✅ | 设备标识（同批内所有 item 相同） |
| `project_name` | string | ❌ | 项目名称 |
| `title` | string | ❌ | 会话标题 |
| `status` | string | ✅ | `"open"` 或 `"ended"` |
| `event` | string | ⚠️ | 仅 mode=event 时必填：`created` / `opened` / `closed` / `title_updated` |
| `cwd` | string | ❌ | 工作目录 |
| `jsonl_path` | string | ❌ | JSONL 文件路径 |

> **注意**：没有 `activity` 字段。activity 由 Cloud 根据 hook 事件维护，Desktop 不需要关心。

### 4.4 与旧协议的区别

| 维度 | 旧协议 | 新协议 |
|------|--------|--------|
| mode 字段 | 无 | 有（event / snapshot） |
| machine_name | 无 | 必填 |
| status 取值 | idle/working/waiting/error/ended | open/ended |
| activity 字段 | 无（混在 status 里） | Cloud 侧独立维护（Desktop 不传） |
| event 字段 | 可选 | mode=event 时必填 |
| 快照内容 | 无此概念 | 全量（open+ended，≤30条） |

## 五、Desktop 端改动清单

### 5.1 数据模型改造

**本地会话数据结构**：

```
Session {
  session_id: string
  project_name?: string
  title?: string
  status: "open" | "ended"          // 改：收敛为 open/ended 两个值
  cwd?: string
  jsonl_path?: string
}
```

> 不需要 activity 字段。本地如果原来用 idle/working/waiting/error 表示打开状态，统一映射为 `open`。

### 5.2 同步逻辑改造

#### 改动 1：新增快照发送

**触发时机**：
- 每次 socket 连接/重连成功后 → **立即**发送一次 snapshot
- 本地会话集合变化后（创建/打开/关闭/改标题/删除）→ **去抖合并**（如 500ms）后发送一次 snapshot

**发送内容**：本地所有会话（open + ended），取最近 30 条。

**伪代码**：

```
function sendSnapshot() {
  const sessions = getLocalSessions()  // 最近 30 条
  emit("desktop:session:sync", {
    mode: "snapshot",
    machine_name: getMachineName(),   // 主机名等唯一标识
    sessions: sessions.map(s => ({
      session_id: s.session_id,
      project_name: s.project_name,
      title: s.title,
      status: s.status,              // "open" 或 "ended"
      cwd: s.cwd,
      jsonl_path: s.jsonl_path
      // 不带 activity
    }))
  })
}

// 触发时机
onSocketConnected() { sendSnapshot() }
onSessionChanged() { debounce(500, sendSnapshot) }
```

#### 改动 2：保留单次操作发送（可选优化）

如果希望 Mobile App 低延迟收到变化（不等去抖），可以在用户点按钮时同时发 event：

```
function onUserOpen(session) {
  session.status = "open"
  saveLocal(session)
  
  // 即时推送（低延迟）
  emit("desktop:session:sync", {
    mode: "event",
    machine_name: getMachineName(),
    sessions: [{
      session_id: session.session_id,
      event: "opened",
      status: "open",
      project_name: session.project_name,
      title: session.title
      // 不带 activity
    }]
  })
  
  // 同时触发快照（兜底收敛）
  debounce(500, sendSnapshot)
}
```

> **注意**：event 是优化项，不是必须的。如果只做 snapshot 也完全能保证一致性，只是 Mobile 收到变化的延迟取决于去抖时间。

#### 改动 3：获取 machine_name

需要一个稳定的设备标识。建议使用操作系统主机名：

```
function getMachineName(): string {
  return os.hostname()  // 或其他稳定唯一标识
}
```

要求：同一台机器每次启动返回相同值；不同机器不重复。

### 5.3 UI 层面（无强制改动）

UI 继续用本地数据渲染，不需要从 Cloud 拉。但如果想显示 Cloud 同步状态（如"已同步"/"同步中"），可以监听发送结果。

## 六、向后兼容

- **mode 缺省**：如果不传 `mode` 字段，Cloud 端按旧逻辑处理（event-based fallback）。建议尽快切换到新模式。
- **machine_name 为空**：Cloud 端跳过快照收敛（保护性），按旧逻辑处理。
- **status 用旧值**：如果仍传 idle/working/waiting/error/ended，Cloud 端兼容映射（临时过渡期）。

## 七、测试验证

### 7.1 正常流程

1. Desktop 启动 → 连接 Cloud → 发送 snapshot（含已有会话）
2. 用户创建会话 → 发送 event(created) + snapshot
3. 用户打开会话 → 发送 event(opened) + snapshot
4. 用户关闭会话 → 发送 event(closed) + snapshot
5. Mobile App 应实时看到对应变化

### 7.2 边界场景

| 场景 | 预期行为 |
|------|---------|
| Desktop 断网重连 | 重连成功后立即发 snapshot，Cloud 自动修复丢失的事件 |
| Desktop 崩溃重启 | 重启后重连发 snapshot，不在快照内的残留自动清理 |
| 空快照（sessions: []） | 该设备所有会话被标记为 ended/deleted |
| 同账号两台机器 | 各自独立快照，互不影响 |
| 快照超过 30 条 | Desktop 截断至 30 条，Cloud 以收到的为准 |

### 7.3 验证步骤

1. 打开 Desktop，确认连接 Cloud 成功
2. 创建/打开/关闭几个会话
3. 观察 Mobile App 是否同步显示
4. 断网 → 操作几个会话 → 恢复网络 → 确认重连后数据一致
5. 强杀 Desktop 进程 → 重启 → 确认之前关闭的会话在 Mobile 上也变为 closed
