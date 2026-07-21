# Lynel Desktop 消息管道重设计 — Handoff

> 日期: 2026-07-20
> 基于: `docs/superpowers/specs/2026-07-20-lynel-message-pipeline-redesign.md` (v1.1)
> 提交: `be0532a` — `feat: 消息管道重设计 — LynelEnvelope 协议替代 ProxyStageEvent，新增 Trace/Cost/Archive 层`

---

## 1. 做了什么

**一句话**：全面替换 `apiproxy.ts` 和 `channels/*` 的消息模型，从旧 `ProxyStageEvent` 切换为 happy `LynelEnvelope` 协议，同时移植 ccglass 的解析/成本/trace 能力。

### 核心变化

| 维度 | 之前 | 之后 |
|---|---|---|
| 实时消息协议 | `ProxyStageEvent` (prompt/text/tool_use/tool_result/response_complete) | `LynelEnvelope` (happy 9 种事件 + seq + agent 标识) |
| Turn 状态 | `turn` 字段恒为 1（代码与文档不符） | 真实 turn 状态机（user 纯文本关闭旧 turn，tool_result 维持同一 turn） |
| 存储层 | 单层：`<sid>-calls.jsonl` 阶段事件 | 三层：envelopes.jsonl（对话视图）+ raw/<seq>.json（完整网络证据）+ usage.json（跨 session 成本汇总） |
| 错误感知 | 无 | 四类错误显式标记：SSE 内 error / HTTP 错误 / 网络错误 / tool 调用失败 |
| 成本/trace | 无 | USD 精确计价（Opus 3/4/4.1/4.5+/Haiku 分档）+ TTFT/gen/tps |
| 通道 | 模糊的路由 | OutputChannel + HookChannel 双通道（apiproxy 事件走 OutputChannel，hook 审批走 HookChannel，互不干扰） |
| 前端 | 无 trace | 右键 session → 打开 Trace tab，ccglass 式 7 个 detail tab（overview/flow/system/messages/tools/response/headers） |
| 多 agent | 只认 Claude | `FormatAdapter` 接口（`formats/` 目录），预留 `openai.ts` / `pi.ts` |

---

## 2. 文件清单

### 新增主进程文件（19 个）

```
src/main/
├── protocol/                         # 协议层
│   ├── envelope.ts                   # SessionEnvelope + LynelEnvelope + createEnvelope
│   ├── events.ts                     # 9 种事件类型 + canCarryUsage
│   └── usage.ts                      # SessionUsage + makeUsage
│
├── adapter/                          # 解析层
│   ├── sessionAdapter.ts             # 核心：SSE → LynelEnvelope 状态机
│   ├── turnStateMachine.ts           # ensureTurn / closeTurn / isTurnBoundary
│   ├── toolLifecycle.ts              # ToolTracker（累积 input_json_delta + 补全 args）
│   ├── usageAttacher.ts              # message_delta → 挂 usage 到尾部 envelope
│   └── requestParser.ts              # extractUserText / extractToolResults
│
├── formats/                          # 格式适配器层
│   ├── format.ts                     # FormatAdapter 接口
│   ├── anthropic.ts                  # Anthropic Messages API（移植 ccglass parse.js + formats/anthropic.js）
│   ├── openai.ts                     # 预留：OpenAI Responses + Chat Completions
│   └── pi.ts                         # 预留：pi-agent
│
├── cost/                             # 成本计算（移植 ccglass tokens.js）
│   ├── priceTable.ts                 # 模型定价表 + estimateTokens + costFromUsage
│   └── usage.ts                      # summarizeUsage（跨 session 汇总）
│
├── trace/                            # Trace 计算（移植 ccglass session-stats.js）
│   ├── timing.ts                     # requestTiming / latencyMs / recordModel
│   └── ipc.ts                        # trace IPC handlers + export markdown/har
│
└── archive/                          # 存储层
    ├── happyJsonl.ts                 # 追加写 envelopes.jsonl（同步 appendFileSync）
    ├── rawArchive.ts                 # 写 raw/<seq>.json（含 trace/cost/error）
    └── usageSummary.ts               # 增量更新 usage.json
```

### 改造现有文件（10 个）

```
src/main/apiproxy.ts                  # 全量重写：接入 SessionAdapter，实时 emit + 事后写 raw
src/main/app.ts                       # import 替换；dispatcher.dispatchHook 调用；registerTraceIpc()
src/main/preload.ts                   # 新增 8 个 trace IPC 方法
src/main/channels/channel.ts          # OutputChannel.send → LynelEnvelope；新增 HookChannel 接口
src/main/channels/registry.ts         # 新增 dispatchHook + registerHook 方法
src/main/channels/sse-channel.ts      # 消费 LynelEnvelope
src/main/channels/wecom-channel.ts    # 最小改动：仅改 send() 消费 LynelEnvelope + 新增 sendHook()
src/main/channels/state-channel.ts    # 同时实现 OutputChannel + HookChannel
src/main/channels/cloud-channel.ts    # 新增：云服务预留（enabled=false）
src/main/channels/localfile-channel.ts # 简化为空实现（apiproxy 已直接写 happy jsonl）
```

### 新增前端文件（13 个）

```
src/renderer/src/
├── stores/trace.ts                   # Pinia store
├── types/tab.ts                      # 新增 'trace' TabType + TraceTabPayload
├── components/trace/
│   ├── TraceTab.vue                  # 主面板
│   ├── TraceHeader.vue               # 顶栏：stats badge + model filter + errors
│   ├── RequestList.vue               # 左侧请求列表
│   ├── RequestDetailPane.vue         # 右侧 detail + 7 tab 路由
│   └── detail/
│       ├── Card.vue                  # 可复用数据卡片
│       ├── OverviewPane.vue          # latency/TTFT/gen/tps/status/model/tokens/cost
│       ├── FlowPane.vue              # 请求/响应流程对话视图
│       ├── SystemPane.vue            # system prompt 块
│       ├── MessagesPane.vue          # messages 历史
│       ├── ToolsPane.vue             # tools 定义
│       ├── ResponsePane.vue          # 重组后的响应 content
│       └── HeadersPane.vue           # request/response headers
```

### 改造前端文件（4 个）

```
src/renderer/src/
├── views/HomeView.vue                # 新增 trace tab 渲染 + onOpenTrace handler
├── components/SessionList.vue        # 右键菜单新增"打开 Trace"
├── stores/tabs.ts                    # 新增 openTrace() + trace tab id 生成规则
└── composables/useElectron.ts        # 新增 8 个 trace API 封装
```

### 测试文件（7 个 vitest + 1 个 smoke）

```
tests/main/
├── protocol/envelope.test.ts
├── adapter/sessionAdapter.test.ts
├── formats/anthropic.test.ts
├── cost/priceTable.test.ts
├── cost/usage.test.ts
├── trace/timing.test.ts
├── archive/rawArchive.test.ts
├── channels/registry.test.ts         # 改造：改用 LynelEnvelope + HookEventLike
├── channels/wecom-channel-cards.test.ts  # 改造：适配新 send() 接口
└── scripts/smoke-test.ts             # 40 个 node:test 用例，不依赖 vitest
```

---

## 3. 关键 Bug 修复记录（8 个）

| # | 代码位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | `toolLifecycle.ts:63-75` | `onToolResult` 返回 `{call}` 缺 `t: 'tool-call-end'` | 补 `t: 'tool-call-end'` 字段 |
| 2 | `sessionAdapter.ts` | `toolTracker.envelopes` 引用局部 `out` 数组，找不到 tool-call-start envelope | 新增 `currentMessageEnvelopes` 累积数组，`pushEnv` 同时追加 |
| 3 | `usageAttacher.ts:13` | `envelopes[i] = { ...envelopes[i], usage }` 替换引用，外部看不到 | 改为直接 mutate `(envelopes[i] as any).usage = usage` |
| 4 | `happyJsonl.ts` | `createWriteStream({ flags: 'a' })` 异步流，close 后读不到数据 | 改为 `fs.appendFileSync` |
| 5 | `sessionAdapter.test.ts` | 测试期望 3 个 envelope 但 handleRequest 不过 user 纯文本不等 transcript turn-start | 修正测试期望为 2 个（turn-end + user:text） |
| 6 | `smoke-test.ts` line 333 | partial_json SSE 测试数据 JSON 转义多引号 | 修正为 `"partial_json":"{\"command\":\"ls\"}"` |
| 7 | `wecom-channel.ts` | handoff 重写整个文件导致 `loadWecomPlugin()` 初始化丢失，WebSocket 不连接 | `git checkout HEAD --` 恢复原文件，仅改 `send()` + 新增 `sendHook()`，所有基础设施不变 |
| 8 | `sessionAdapter.ts` + `apiproxy.ts` | HTTP 4xx/5xx 错误（如 429 限流）不生成 error envelope；`handleHttpError` 要求已有 turn 才工作 | apiproxy 响应结束检测 `resStatus >= 400` 调用 `handleHttpError`；`handleHttpError` 改用 `ensureTurn()` |

---

## 4. 验证状态

### 4.1 已通过 ✓

- **vitest 全量测试**：21 个文件，129 个测试全部通过
- **TypeScript 编译**：`tsc --watch` 0 错误
- **smoke test**：40 个 node:test 用例全部通过
- **应用启动验证**：`npm run dev` 正常启动，WebSocket 认证成功，企业微信卡片推送正常
- **Git 推送**：`be0532a` 已推送到 `origin/main`

### 4.2 未执行

- **vue-tsc 前端类型检查**：`cd src/renderer && npx vue-tsc --noEmit`（需要 node_modules）
- **npm run build**：全量生产构建（需要 node_modules）
- **端到端集成测试**：PTY 启动 + 代理拦截 + 落盘 + trace 面板 + 企业微信卡片全链路

---

## 5. 依赖安装注意事项

### 5.1 当前环境问题

- 项目 `.npmrc` 指向私有 registry `http://wnpm.weoa.com:8001`
- 该 registry 缺失以下包，导致 `npm install` 失败：
  - `@wecom/wecom-openclaw-plugin@20206.7.201`
  - `electron-store@10.1.0`
  - `unzipper@0.12.5`（electron-builder 的间接依赖）
- 公共 registry (`registry.npmjs.org`) 网络不通（ECONNRESET）

### 5.2 推荐安装方式

在公司网络内使用私有 registry 安装。如果还是失败：
1. 临时移除 `package.json` 中 `@wecom/wecom-openclaw-plugin` 行
2. `npm install`（绕过缺失的 wecom 包）
3. 恢复 `package.json`
4. 企业微信推送功能降级为 warn log，不影响核心功能

### 5.3 完整验证命令

```bash
npm install                          # 先装依赖
npm run test:main                    # vitest 全量测试
cd src/renderer && npx vue-tsc --noEmit  # 前端类型检查
npm run build                        # 全量构建
npm run dev                          # 启动
```

---

## 6. 遗留问题

### 6.1 端到端集成（P1）

apiproxy 接入 session.ts 的 PTY 启动流程后，需要验证：
1. Claude 启动后代理正常拦截流量
2. `envelopes.jsonl` 和 `raw/<seq>.json` 正确落盘
3. trace 面板能展示发起过对话的历史 session
4. 企业微信收到正确卡片

### 6.2 企业微信权限卡片（P1）

权限卡片的 `wecom-cards/*` 内部仍引用旧的 `ProxyStageEvent` 类型。当前架构中 hook 审批走 hookserver → broker → 卡片，不与 LynelEnvelope 冲突。未来统一需要重构 `wecom-cards/*`。

### 6.3 子代理支持（P2）

9 种事件中的 `start` / `stop` 预留了接口，但 SessionAdapter 未实现子代理映射逻辑。happy-cli 的 `sessionProtocolMapper.ts` 有完整实现（706 行），需要后续移植。

### 6.4 OpenAI / pi-agent 适配器（P2）

`formats/openai.ts` 和 `formats/pi.ts` 只有空壳，ccglass 的 `formats/openai.js` (329 行) 可作为移植参考。

### 6.5 前端 trace 面板 UX 打磨（P2）

核心功能已工作，但仍缺：
- 实时 SSE 增量更新（当前只加载历史数据）
- latency 趋势图（ccglass 的 mini bar chart）
- diff 视图（选两个请求比较）
- 跨 session usage 汇总展示

---

## 7. 关键架构决策（接手时必读）

1. **OutputChannel.send 的签名是 `send(event: LynelEnvelope)`**，不是旧的 `ProxyStageEvent`
2. **HookChannel.sendHook 独立于 OutputChannel**，hook 事件走 `dispatchHook` 不混入 envelope 流
3. **`SessionAdapter.state.seq` 是 envelope 的自增计数器（session 内自增）**，和 raw archive 的 `seq`（roundtrip 计数器）是两个独立变量
4. **`toolTracker.envelopes` 指向 `currentMessageEnvelopes`（累积数组）**，不指向 handleSseEvent 的局部 out
5. **`attachUsageToLast` 是 mutate 操作**，不替换数组引用
6. **`HappyJsonlWriter.append` 是同步 appendFileSync**，不是异步流
7. **apiproxy.ts 的 `startProxy` 第三个参数是 `emit: (env: LynelEnvelope) => void`**，由 ChannelDispatcher.dispatch 实现
8. **trace IPC 在 `trace/ipc.ts` 的 `registerTraceIpc()` 中注册**，由 `app.ts` 构造时调用
9. **前端 trace tab id 规则**：`trace-<sessionId>`，去重逻辑在 `tabs.ts:generateTabId`
10. **cloud-channel 始终 `isEnabled() === false`**，Phase 1-7 预留
11. **wecom-channel.ts 的改动原则**：只改 `send()` 方法签名和新增 `sendHook()`，不动初始化/WebSocket/卡片/inbound 处理逻辑
12. **HTTP 错误检测在 `apiproxy.ts` 的 `proxyRes.on('end')` 中**：`resStatus >= 400` → `format.parseHttpError` → `adapter.handleHttpError` → `dispatchEnvelopes`

---

## 8. 相关文档

- 完整设计案: `docs/superpowers/specs/2026-07-20-lynel-message-pipeline-redesign.md`
- 参考项目:
  - ccglass: `E:\work\ccglass-1.1.2`（解析/成本/trace 的移植源）
  - happy-main: `E:\work\happy-main`（Session Protocol 的原型）
- CLAUDE.md: `E:\work\lynel-desktop\CLAUDE.md`（项目整体约定）
