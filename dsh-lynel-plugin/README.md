# lynel-plugin

DeepSeek Harness 插件：把 DSH Web 前端和 Lynel Desktop 后端桥接起来。

| 功能 | 说明 | 依赖 |
|---|---|---|
| **绑定 Bot** | 会话头部（聊天页标题旁）新增「绑定 Bot」按钮，读写 `~/.lynel-desktop/bot.json` | 宿主端 + 客户端（纯插件，无需补丁） |
| **Bot 设置页** | 设置面板新增「Bot 设置」分区：列出 / 添加 / 删除 bot（删除时自动解绑关联会话） | 宿主端 + 客户端（`settings.section` 槽位） |
| **Ask 钩子** | DSH 需要询问用户时，把问题通过 HTTP 发给 `http://localhost:17527/deepseek-harness/ask`，用返回内容回答 | 客户端（composer chain 接管） |
| **轨迹转发** | 所有会话事件按 LynelEnvelope 格式实时 POST 到 `http://localhost:17527/deepseek-harness/envelope` | 客户端（mux 流订阅） |
| **外部消息注入** | `POST /lynel/send` 从外部向指定会话推送用户消息（等价于 GUI 里敲回车），冷会话自动恢复 | 宿主端（内部转发 `/api/session.prompt`） |

## 可行性结论（对照 DSH 0.1.0-rc.6 源码）

1. **Ask 钩子 ✅ 纯插件可实现**。DSH 的提问流程是 `conversation.composer` 链式槽位（selector 路由）。插件注册一个 `priority: -100` 的链条目，先于官方提问 UI 拿到 `question` 等待载体，把问题 POST 给 lynel，用响应调用 `wait.respond()` 回答。后端不可用时降级为内置手动回答面板。宿主端同时提供同源代理 `/lynel/proxy/ask`，浏览器无需处理 CORS。
2. **轨迹转发 ✅ 纯插件可实现**。宿主端 `events.mux` 流**支持多消费者**（`muxQueues` 是 Set，每个订阅者独立收 `session/event`），插件另开一条 mux 流把 `SessionEvent` 映射为 LynelEnvelope 后推送。映射表见 `src/client/envelope.ts`。
3. **绑定 Bot 入口 ✅ 采用纯插件方案（路线 A）**。侧边栏会话行的 `⋯` 菜单（重命名/分叉会话/归档会话）在 `@deepseek-ai/dsh-client-ui-workspace` 内部**硬编码**，DSH 的槽位系统没有暴露会话行菜单项扩展点（已核对全部 28 个槽位）；插件因此注册 `conversation.session.header.actions` 槽位，在**会话头部（聊天页标题旁）**显示「绑定 Bot」按钮，点击打开绑定弹窗 —— 零补丁、升级安全。仓库里另附 `patches/dsh-client-ui-workspace-menu.patch`（在「归档会话」下方加菜单项的可选补丁），当前**不使用**，仅留作未来想要侧边栏入口时的参考。

## 架构

```
DSH Web 前端（127.0.0.1:随机端口 iframe）
  │
  ├─ composer chain（priority -100）─── 提问接管
  │     POST /lynel/proxy/ask ──► [宿主端] ──► http://localhost:17527/deepseek-harness/ask
  │     wait.respond(answer) ◄──┘                  （问/答协议见下）
  │
  ├─ mux 流（第二条）── session/event ──► LynelEnvelope 映射
  │     POST /lynel/proxy/envelope ──► [宿主端] ──► http://localhost:17527/deepseek-harness/envelope
  │
  └─ 绑定 Bot（会话头部按钮 → 绑定弹窗）
        GET/POST /lynel/bot.json ──► [宿主端] ──► ~/.lynel-desktop/bot.json
```

- **宿主端**（`src/index.ts`）：cordis 插件，注册 `webServer` 路由（bot.json 读写 + ask/envelope 转发代理），默认零运行时依赖（Node 22 内置 fetch）。
- **客户端**（`src/client/`）：浏览器 bundle，运行时只依赖模块表里的 `react` / `react/jsx-runtime`。

## 安装

### 1. 构建

```bash
cd lynel-plugin
pnpm install
pnpm build          # 产出 lib/index.js（宿主）+ lib/client.js（浏览器）
```

### 2. 安装到 DSH web profile

`dsh web`（以及 lynel-desktop 内嵌的 dsh）都使用 `~/.dsh/profiles/web`。插件声明了 `dsh.bundle.patch`，`dsh plugin` 会自动把它追加进 `dsh.profile.bundles`：

```bash
dsh plugin --profile web add file:/absolute/path/to/lynel-plugin
```

或手动（等价）：

```bash
cd ~/.dsh/profiles/web
pnpm add file:/absolute/path/to/lynel-plugin
# 然后把 "lynel-plugin" 追加到 package.json 的 dsh.profile.bundles 数组
```

### 3. 重启

插件加载后需要重启 dsh 进程（lynel-desktop 重启，或重启 `dsh web`）。浏览器端自动注入 `window.__DSH_BOOT__`。

### 4. 验证

```bash
# 宿主路由
curl http://127.0.0.1:<dsh端口>/lynel/config          # 返回插件配置
curl http://127.0.0.1:<dsh端口>/lynel/bot.json        # 404 或 bot 数据
```

在任意会话中点「绑定 Bot」，或让 agent 调用 `ask_user_question` 观察接管，并检查 mock 服务的 envelopes.jsonl。

## bot.json（`~/.lynel-desktop/bot.json`）

```jsonc
{
  "bots": [
    { "id": "wecom-main", "name": "企微主号", "type": "wecom",
      "webhook": "...", "secret": "..." }   // 其余字段插件不关心，原样透传
  ],
  "sessions": { "<sessionId>": "wecom-main" }
}
```

读写走宿主端路由：
- `GET /lynel/bot.json` → 文档（不存在返回 404）
- `POST /lynel/bot.json` → 整体替换；或局部变更：
  - `{action:'bind', sessionId, botId}` / `{action:'unbind', sessionId}`（一个 bot 只能绑一个会话）
  - `{action:'add-bot', bot:{name, type?, ...}}`（id 缺省自动生成，重复 id 报错）
  - `{action:'unbind-bot', botId}`（解绑该 bot 的所有会话）
  - `{action:'remove-bot', botId}`（同时解绑所有绑定该 bot 的会话）

设置面板里的「Bot 设置」分区（`settings.section` 槽位）即这些操作的图形化界面；会话头部的「绑定 Bot」弹窗负责 bind/unbind。

## Ask 钩子协议（`/deepseek-harness/ask`）

DSH 侧每收到一次 `ask_user_question` 调用发一个请求；lynel 必须用一个响应回答整批问题（不支持分问题拆答）：

```jsonc
// 请求  POST /deepseek-harness/ask
{
  "requestId": "question:<rpcId>",          // 幂等/关联标识
  "sessionId": "session-xxxx",
  "questions": [
    {
      "id": "q1",                            // 回答时原样回传
      "question": "您希望使用哪种部署方式？",
      "detail": "可选补充说明",
      "header": "部署",
      "options": [ { "label": "A", "description": "..." }, { "label": "B" } ],
      "multiSelect": false,                  // 默认单选
      "intent": { "kind": "plan-review", "approve": "Approve" }  // 可选
    }
  ],
  "ts": 1723700000000
}

// 响应 200
{ "answers": [ { "id": "q1", "selected": ["A"], "custom": "可选自由文本" } ] }
// 或取消该次提问
{ "cancelled": true }
```

- 请求体结构完全等于 DSH 的 `AskUserQuestionItem` 数组（`@deepseek-ai/dsh-user-questions/types`）。
- 非 200 / 超时（默认 120s）/ 异常结构 → 面板降级为「重试 / 手动回答 / 取消」。

## 轨迹协议（`/deepseek-harness/envelope`）

每个 LynelEnvelope 一个 JSON body（`POST`，`Content-Type: application/json`），服务端应回 2xx（收到即确认）。客户端失败重试一次后丢弃并计数告警。

```jsonc
{
  "id": "uuid", "time": 1723700000000, "seq": 42,     // seq 全局自增（跨会话）
  "role": "agent", "sessionId": "session-xxxx", "turn": "1",
  "agent": "dsh",                                     // 默认 "dsh"（非 claude）
  "usage": { "input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 3 },  // 仅 assistant/message
  "ev": { "t": "tool-call-start", "call": "call_1", "name": "bash", "title": "bash", "args": { "command": "ls" } }
}
```

DSH `SessionEvent` → LynelEnvelope 映射：

| DSH 事件 | Lynel `ev.t` | 备注 |
|---|---|---|
| `turn/start` | `turn-start` | |
| `turn/end` | `turn-end` | `completed` / `failed`(error,interrupted) / `cancelled`(aborted,blocked) |
| `user/message` | `text`（role=user） | |
| `assistant/message` | `text`（role=agent）+ `usage` | 完整文本 |
| `assistant/chunk` | `text`（逐 delta） | 默认跳过（消息事件已含全文） |
| `tool/call` | `tool-call-start` | `args` 已 JSON.parse |
| `tool/result` | `tool-call-end` | `is_error` / `error` |
| 其余日志类事件 | （跳过） | `todo/write`、`request/*`、`step/*`、`session/end-seed` |
| mux 订阅控制帧 | `start` | 每个会话首次订阅时发一次 |

## 外部消息注入（`/lynel/send`）

从外部（lynel 后端 / 脚本 / 任意 HTTP 客户端）向指定会话推送用户消息，等价于在 GUI 输入框回车；冷会话（从未在 GUI 打开过）会自动恢复 agent 再投递。宿主端把请求转发给 DSH 自己的网关 `POST /api/session.prompt`（复用全套 agent 解析 / 恢复 / 模型校验，零重实现）。

```jsonc
// POST http://127.0.0.1:<dsh端口>/lynel/send
{
  "sessionId": "session-xxxx",          // 必填；会话 id（可从 envelope 的 sessionId 字段拿到）
  "text": "消息内容",                    // 与 content 二选一
  // 或 content: [{ "type": "text", "text": "..." }]（仅文本段，保留给扩展）
  "mode": "queue"                        // 可选；queue=普通排队（默认）/ steer=打断当前轮次
}

// 响应 200
{ "ok": true, "accepted": true }
// 失败示例（状态码对应）：
//   404 { "ok": false, "error": "session-not-found", "message": "…" }   会话不存在
//   409 { "ok": false, "error": "agent-busy", "message": "…" }           agent 忙 / 模型不可用
//   400 { "ok": false, "error": "bad-request", "message": "…" }          参数缺失
```

消息进入会话后照常产生 `user/message` 事件并随轨迹转发到 envelope 端点。

## 侧边栏菜单补丁（当前未使用，仅参考）

> 当前方案是路线 A（会话头部按钮），**不需要**打任何补丁。下面保留补丁说明，仅当你未来想把入口也加到侧边栏会话行菜单时参考。

`patches/dsh-client-ui-workspace-menu.patch` 针对 `@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.6` 的 `lib/client.js`（构建产物），在「归档会话」下方新增「绑定 Bot」，点击派发 `lynel:bind-bot` 事件（插件已在 `shell.overlay` 监听并弹窗）。

**方式 A — pnpm patch（推荐）**：

```bash
cd /path/to/lynel-desktop
pnpm patch @deepseek-ai/dsh-client-ui-workspace
# 在生成的临时目录里编辑 node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js，
# 按补丁文件内容改动（2 处：菜单项数组 + onSelect 分支）
pnpm patch-commit <临时目录路径>
```

**方式 B — patch-package**：把补丁文件放进 lynel-desktop 的 `patches/`，加 devDependency `patch-package` 并在 package.json 加 `"postinstall": "patch-package"`。

> ⚠️ 该补丁打在编译产物上，升级 `@deepseek-ai/dsh-client-ui-workspace` 后需要重新生成。若 DSH 上游未来暴露会话行菜单槽位，此补丁即可删除。

## 本地联调

```bash
# 1. 起 mock lynel 后端（写入 ~/.lynel-desktop/mock-envelopes.jsonl）
node lynel-plugin/mock/lynel-server.mjs

# 2. 起 dsh web（或 lynel-desktop）
dsh web

# 3. 会话里让 agent 提问 / 操作，观察：
tail -f ~/.lynel-desktop/mock-envelopes.jsonl   # 轨迹
```

## 目录结构

```
src/index.ts             宿主端：bot.json 路由 + /lynel/proxy 转发
src/client/index.tsx     客户端入口：注册槽位 + 启动轨迹转发
src/client/envelope.ts   LynelEnvelope 类型 / SessionEvent 映射 / 推送
src/client/ask-hook.tsx  AskUserQuestion HTTP 钩子（composer chain）
src/client/bind-ui.tsx   绑定 Bot 弹窗 + 会话头部按钮 + 事件监听
src/client/bots-settings.tsx  Bot 设置页分区（settings.section）
src/client/types.ts      DSH 契约的结构化类型（零运行时依赖）
cordis.patch.yml         插件激活补丁（dsh.profile.bundles 用）
patches/                 可选：ui-workspace 侧边栏菜单补丁
mock/                    本地 mock lynel 后端
```

## 已知限制

- 轨迹 `agent` 字段默认 `"dsh"`；`claudeUuid` / `claudeMsgId` 无对应物（DSH 不是 Claude API），留空。
- 提问钩子与官方提问 UI 互斥：钩子接管后官方 UI 不出现；钩子挂了才降级手动面板。
- envelope 只做「尽力而为」推送（重试 1 次），不落盘、不补传历史；需要断线补偿请在 lynel 侧按 `seq` 做缺口检测。
