# Lynel Desktop 多 Agent 支持设计

## 背景

当前终端只支持 `claude`（Claude Code）。需求是同时支持 `omp`（oh-my-pi）、`codex`（OpenAI Codex CLI）、`opencode`（SST OpenCode）三个终端 AI 编码代理，复用现有的 PTY 托管、反向代理 trace、权限审批、企业微信通道、云端上行通道体系。

## 目标

1. 引入 `AgentKind` 抽象，让一个 session 绑定一个 agent，创建/托管/追踪按 agent 分派
2. 复用现有 `apiproxy`（已是通用 HTTP→HTTPS 反向代理）做三个新 agent 的 trace/用量
3. 补全 `Formats/` 空壳（`openai.ts`、`pi.ts`），支撑 OpenAI Responses/Chat 格式
4. 每个 agent 提供可用的权限拦截方案（明确降级范围，不承诺与 Claude 覆盖度一致）
5. 企业微信、云端通道、Trace UI 复用，不新增

## AgentKind 抽象

```ts
// src/main/agents/types.ts
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp';

export interface AgentSpec {
  kind: AgentKind;
  label: string;
  command: string;                       // 启动的可执行文件
  format: string;                        // FormatAdapter.name
  // 代理注入方式：env 变量名 或 配置模板（见 ProxyInjection）
  envVar?: string;                       // 如 'ANTHROPIC_BASE_URL' / 'OPENAI_BASE_URL'
  configTemplate?: 'codex-toml' | 'opencode-json';
  // session 发现策略
  sessionStrategy: 'pregen' | 'codex-exec' | 'opencode-serve' | 'omp-jsonl';
  // 权限拦截策略
  permission: 'hook' | 'codex-hook' | 'opencode-plugin' | 'omp-hook';
  exitCommands: Record<string, 'exit' | 'clear' | 'resume'>;  // exit-detect 用
}
```

`app.ts` 的 `createSessionInternal` 增加 `agent?: AgentKind` 参数（默认 `'claude'`），按 spec 分派：

- **启动命令**：`startPty(cwd, sid, spec.command, mode, ...)`
- **代理注入**：claude/omp 走 env；codex 写临时 config.toml；opencode 写临时 opencode.json（均仿现有 `createSettingsOverrideFile()` 的 `os.tmpdir()/lynel-desktop/` 临时文件 + 退出清理模式）
- **proxy format**：`startProxy(workDir, sid, emit, formatAdapterFor(kind), upstreamFor(kind))`

## 格式层（Formats）

现有 `FormatAdapter`（`src/main/formats/format.ts`）接口已预留，三个新 agent 分别需要：

| FormatAdapter | 服务对象 | API 格式 | 状态 |
|---|---|---|---|
| `anthropicAdapter` | claude、omp | Anthropic Messages `/v1/messages` | ✅ 已实现 |
| `openaiAdapter` | codex、opencode、omp | OpenAI Responses + Chat Completions | ⚠️ 空壳 |
| `piAdapter` | omp | 视 provider（Anthropic 或 OpenAI 兼容） | ⚠️ 空壳 |

### 补全 `openai.ts`

需要完整实现（参考 ccglass `src/formats/openai.js` 与 `src/formats/anthropic.js` 的分工）：

- `parseRequest(body)`：提取 `model`、`lastUserText`、`toolResults`（`tool_call_id` 关联）
- `reassembleResponse(raw)`：SSE 流重组 OpenAI Responses（`response.output` 数组）/ Chat Completions（`choices[].delta`）→ `ReassembledResponse`（model / stop_reason / usage / content 含 text、reasoning、tool_use）
- `parseHttpError` / `view` / `blocks` / `estimateTokens`
- `costFromUsage(model, usage)`：接入现有 `cost/priceTable.ts`，为 OpenAI 模型名补价格表条目

**注意**：codex 用 Responses API（`wire_api="responses"`），opencode 用 Chat Completions（`@ai-sdk/openai-compatible`）或 Responses（`@ai-sdk/openai`），omp 视 provider。三者字段差异集中在 `reassembleResponse`，用 `request.url` 或 body 的 `stream`/结构区分。

## 代理拦截（ProxyInjection）

`apiproxy.ts` 的 `startProxy()` 已通用，只需把正确的 `upstream` + `format` 传进去。差异在"如何让客户端指向代理"：

| Agent | 指向代理的方式 | 风险点 |
|---|---|---|
| claude | env `ANTHROPIC_BASE_URL`（现状） | — |
| omp | env `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`（provider 直读） | 需确认 omp 默认 `approvalMode=yolo` 下的 provider 选择 |
| codex | 临时 `config.toml`：`openai_base_url` 或 `[model_providers.<name>].base_url` + `wire_api` | **必须 API-key 模式**（`codex login --api-key`）；ChatGPT 登录走 WebSocket 完全绕过代理；v0.120+ 默认 WS 单长连接，需代理对 WS Upgrade 返回 `426` 强制回退 HTTP，或支持 WS 转发 |
| opencode | 临时 `opencode.json`：`provider.<name>.options.baseURL = "${env:OPENAI_BASE_URL}/v1"`（或 `${env:ANTHROPIC_BASE_URL}/v1`，按 npm 适配器拼 `/messages` 或 `/chat/completions`） | `npm` 字段决定线上格式，baseURL 尾路径必须带 `/v1` |

实现位置：`src/main/agents/` 新增 `proxyInjection.ts`，仿 `createSettingsOverrideFile()` 返回 `{ args, tmpFile, cleanup }`。

## Session 追踪策略

三个新 agent **都无法像 Claude 那样预生成 UUID 注入**，必须按 agent 做 session 发现：

| Agent | 发现方式 | 落点 |
|---|---|---|
| claude | `--session-id <uuid>` 预生成（现状，不变） | — |
| codex | `codex exec --json` 的 `thread.started`（含 `thread_id`）；或轮询 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 首行 `SessionMeta`；或 TUI `/status` | `app.ts` 的 `createSessionInternal` 后异步拿 id 并 `session.rebind(old, newId)` |
| opencode | **推荐 `opencode serve` 无头模式**：`POST /session` 响应直接返回 id（`ses_*`）；或监听 `/global/event` 的 `session.created` | 无需 PTY 解析 |
| omp | 读 `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuidv7>.jsonl` 文件名（uuidv7 即 id）；SDK `createAgentSession().session.sessionId` | 启动后扫描目录 |

### opencode：`serve` 模式（推荐路径）

opencode 是 client/server 架构，`opencode serve --port <p> --hostname 127.0.0.1` 提供无头 REST + SSE（Hono+Bun，OpenAPI 在 `/doc`）：

- `POST /session` 建会话 → 拿 id
- `POST /session/{id}/message` 发消息，SSE 流式返回 `message`/`tool`/`tool-result`/`complete`（自带 token/cost）
- `/global/event` 流有 `session.created`

这比"PTY + ANSI 解析"更干净，session 管理与消息收发都走结构化接口。**但这是对现有 PTY 托管模型的偏离**，需要评估：是保留 xterm.js 终端直连（用 opencode TUI + PTY），还是改用 serve + 自定义消息界面。本设计倾向**保留 PTY + xterm.js 直连**（复用终端体验），把 serve 的 REST 能力作为"备用托管模式"后续评估。

## 权限审批降级策略

Claude 的"PermissionRequest hook 同步阻塞 + 全工具覆盖"是现有体系的基石（`PermissionBroker`）。三个新 agent 均无法复刻同等覆盖度，按 agent 降级：

| Agent | 拦截机制 | 覆盖范围 | 明确缺口 |
|---|---|---|---|
| claude | PermissionRequest http hook（现状） | 全工具 | — |
| codex | `~/.codex/hooks.json` + `[features] codex_hooks = true`；PermissionRequest hook 同步执行（~30s 超时）→ 回连本地 hookserver | **仅 shell(Bash) 工具** | `apply_patch`、文件工具、MCP 调用不触发；deny-only（可拒绝/放行，不能改写输入） |
| opencode | `.opencode/plugins/*.js` TS 插件：`tool.execute.before` 内 `await fetch(本地hookserver)` + `throw` 阻断 / `output` 放行；或 `permission.ask` 置 `output.status` | 除 MCP 工具与子代理内部调用外 | MCP 工具不触发 `tool.execute.before`（官方限制）；task 子代理内部工具逃逸（bug #5894）；`permission.ask` 部分版本不触发（bug #7006）——**需实测目标版本** |
| omp | `--hook <js>` 的 `pi.on("tool_call")`：`await` 外部 HTTP 审批后返回 `{block, reason, input}` | 工具执行前（需实测） | 默认 `approvalMode=yolo` 全自动放行；hook 内 `await` 网络是否阻塞 LLM 回合**需实测** |

统一原则：

1. **`PermissionBroker` 不变**——只是"哪些工具触发审批"和"审批请求来源"不同。
2. 三个新 agent 的默认权限策略都配成 **放行 + 事后审计**（codex `approval_policy`、opencode `permission.*: allow`、omp `approvalMode: yolo`），把 trace 里的工具调用作为审计依据；审批仅对能拦截的通道开启。
3. 每个 agent 的审批触发点回连同一个本地 hookserver 端点，复用 `PermissionBroker` 的 raise/resolve/`cancelBySessionTool`。
4. UI 上明确标注当前 agent 的审批覆盖度，避免用户误以为全量拦截。

## 退出检测与会话迁移（exit-detect）

`exit-detect.ts` 的 `/exit`/`/quit`/`/clear`/`/resume` 是 Claude 专属语义，按 agent 调整：

| Agent | 退出命令 | clear/新建 | 迁移语义 |
|---|---|---|---|
| claude | `/exit` `/quit` | `/clear` → rebind 新 id | `/resume` → rebind（现状） |
| codex | `/exit` `/quit` `/new` | `/clear` 清屏+新线程，**无 rebind 语义** | `/resume` 切线程 |
| opencode | `/exit` `/quit` `/q` | `/new`（别名 `/clear`）开新会话 | `/sessions` 切换 |
| omp | `/quit` `/q` | `/clear` 原地清上下文（保留 session） | `/resume [id]` `/new` |

- `exitCommands` 映射放进 `AgentSpec`，`consumeInputForExitDetect()` 改为按 agent 匹配命令集合。
- codex/opencode/omp 的 clear 不会换 PTY 的 session id，**不需要 `rebind`**；session 发现策略（轮询/事件/文件名）负责把 id 与界面同步。

## 通道层复用

- `LynelEnvelope` 已有 `agent?: string` 字段（`src/main/protocol/envelope.ts`），trace 落盘与前端 Trace UI 无需改动。
- `state-channel` / `wecom-channel` / `desktop-socket` / `cloud-channel` 与 agent 类型无关，直接复用。
- 新增内容：`AgentKind` 需随 `desktop:session:sync` 上行（在 `SyncSession` 增加可选 `agent` 字段），cloud 端可区分。

## 实施顺序

1. **AgentKind 抽象 + AgentSpec 注册表**（`src/main/agents/`）——先落地 claude 走 spec，验证不回归
2. **补全 `openai.ts` FormatAdapter** + 单测（`tests/main/formats/`），用 ccglass 录制的 OpenAI SSE 样例做 fixture
3. **omp 接入**（风险最小：env 注入复用 + `tool_call` hook + jsonl 文件名 session 发现）
4. **opencode 接入**（baseURL 配置 + TS 权限插件 + `session.created` 发现；先 PTY 模式，serve 模式作为二期）
5. **codex 接入**（临时 config.toml + API-key 模式校验 + WS 回退 426 + `codex exec --json` 拿 thread_id）
6. **权限降级 UI 标注** + 每个 agent 的实测审批覆盖度验证
7. **回归**：`npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit` 全绿

## 边界状态

| 场景 | 行为 |
|------|------|
| codex 处于 ChatGPT 登录模式 | 检测到后 toast 提示"需切到 API-key 模式"，代理无数据但终端照常运行 |
| codex WS 长连接未回退 | 代理对 WS Upgrade 返回 426，客户端回退 HTTP；若未回退则无 trace（不阻塞终端） |
| opencode MCP/子代理工具调用 | 不经过审批插件（已知缺口），trace 中可见、界面标注 |
| omp `tool_call` hook await 阻塞语义未达预期 | 降级为放行 + 事后审计，关闭审批通道 |
| session 发现超时（三个新 agent 均无法预生成 id） | 保持"临时 id"，后台异步 rebind 到真实 id；期间不展示 trace |
| 代理启动失败 | 与现状一致：打日志继续启动 agent，无网关数据 |

## 不变约束

- 新建 session 仍用 `randomUUID()` 预生成内部 id；claude 走 `--session-id`，其余 agent 用 spec 的发现策略替换 id
- 向 PTY 发送用户消息必须以回车结尾（`session.send()` 自动补 `\r`）
- 所有 Claude 配置通过临时 `--settings` 文件注入，不修改全局 `~/.claude/settings.json`；codex/opencode 同理用临时 `config.toml` / `opencode.json`
- `ProxyStore` 全局单例，一个 session 一个 proxy
- 网关数据是终端渲染的补充，前端消费失败不影响 agent 正常运行
- 通道层（WeCom / 云 / state）与 agent 类型解耦，不因多 agent 改动
- 参考实现：ccglass（`~/project/ccglass`）的 `providers.js`（envVar/upstream 映射）、`child-args.js`（args 替换）、`formats/openai.js`（OpenAI 格式）、WS 回退处理

## 待实测项

1. omp `--hook` 的 `tool_call` 是否在 `yolo` 下仍触发、`await` 网络是否阻塞 LLM 回合
2. opencode `tool.execute.before` / `permission.ask` 在目标版本的触发覆盖度（MCP 工具、子代理）
3. codex 新版本 WS→HTTP 回退是否可靠（426 是否触发回退）
4. omp / opencode / codex 的 session 发现延迟与稳定性
