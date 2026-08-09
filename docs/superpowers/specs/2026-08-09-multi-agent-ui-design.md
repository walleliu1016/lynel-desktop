# Lynel Desktop 多 Agent 前端 UI 设计

## 背景

`src/main/agents/` 已落地 AgentKind 抽象（claude/codex/opencode/omp），后端 `createSession` 支持 agent 参数。前端目前是 claude 专属：新建会话无 agent 选择、会话列表 avatar 硬编码 "CC"、终端 loading 文案固定 "正在启动 Claude 会话…"、历史会话无 agent 区分。本文档定义多 agent 的前端 UI 方案。

配套后端设计见 `docs/superpowers/specs/2026-08-09-multi-agent-support-design.md`。

## 目标

1. 新建会话时可选 agent 类型（下拉选择）
2. agent 类型标识显示在 4 个区域：会话列表 avatar、终端 tab（tab 标签 + loading 文案）、历史会话列表、会话 tooltip
3. 历史会话按 agent 区分（recent-sessions.json 主数据源）
4. 表单"Claude 选项"跟随 agent 动态（非 claude 禁用）
5. ProviderTab 按 agent 分组（框架先行）、GeneralTab 每 agent 一个路径
6. 默认 agent 固定 claude

## 前端 agent 元数据

`src/renderer/src/types/agents.ts`：

```ts
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp'

export interface AgentMeta {
  kind: AgentKind
  label: string     // 'Claude Code' / 'Codex' / 'OpenCode' / 'OMP'
  short: string     // 下拉显示名：'Claude' / 'Codex' / 'OpenCode' / 'OMP'
  abbr: string      // badge 缩写：'CC' / 'CX' / 'OC' / 'PI'
  bgVar: string     // CSS 变量名，如 '--agent-claude-bg'
  fgVar: string     // CSS 变量名，如 '--agent-claude-fg'
  tagline: string   // 'Anthropic 官方 CLI' 等
}
export const AGENT_META: Record<AgentKind, AgentMeta> = { ... }
export const AGENT_KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'omp']
```

配色（`styles/theme.css` 新增 CSS 变量，不硬编码 hex）：

```css
--agent-claude-bg / --agent-claude-fg     /* 琥珀橙系，沿用现有 accent */
--agent-codex-bg  / --agent-codex-fg      /* 绿色系 */
--agent-opencode-bg / --agent-opencode-fg /* 蓝色系 */
--agent-omp-bg    / --agent-omp-fg        /* 紫色系 */
```

## 组件

### AgentSelect.vue（新建表单下拉）
- 复用现有"绑定机器人" select 样式
- 选项显示 `abbr + short`（如 `CC Claude`），`v-model` 绑定 `AgentKind`，默认 `'claude'`
- 切换时联动：claude → 显示现有"Claude 选项"；非 claude → 显示"该 agent 暂不支持额外参数"并禁用

### AgentBadge.vue（4 处标识复用）
- `props: { agent?: AgentKind, size?: 'sm' | 'md' }`
- 渲染圆形缩写块，背景/前景用 `var(--agent-xxx-bg/fg)`
- 未知/缺省 agent → 回退 claude（老会话向后兼容）
- 复用位置：SessionItem avatar（md）、RecentSessionList（sm）、SessionTooltip（sm）、SessionTabContent loading（sm）、GlobalTabs session tab 标签（sm）

## 数据模型与透传

### 主进程（app.ts）
| 位置 | 改动 |
|---|---|
| `RecentSessionRecord` | 加 `agent?: string`（持久化 recent-sessions.json） |
| `createSessionInternal` | `addRecentSession({ ..., agent })` 写入 agent |
| `mergeRecentTitles` | 返回时带 `agent: r.agent`（listSessions 的 SessionMeta 含 agent） |
| `getRecentSessions` | recents 记录含 agent |

### 前端
| 位置 | 改动 |
|---|---|
| `types/session.ts` | `SessionMeta` 加 `agent?: string` |
| `types/recent.ts` | `RecentSession` 加 `agent?: string` |
| `stores/sessions.ts` | `recentToMeta` 透传 agent；`create()` 加 agent → `CreateSession`；新列表项带 agent；`applyRebind`（/clear）保留 agent |

### 历史会话数据源（方案 C）
- 历史会话列表主数据源 = recent-sessions.json（含 agent，所有 agent 统一）
- claude 的 jsonl 扫描（`jsonl.scanAll`）仅作 recent 为空时的 fallback（`generateRecentFromProjects`）
- 非 claude 目录/DB 自动发现（codex rollout、omp sessions、opencode SQLite）**不做**，列为后续增强

### 缺省规则
所有读取路径 agent 缺省 `'claude'`——jsonl 扫描历史会话与旧数据一律显示 CC，向后兼容。

## 各位置接入

| 位置 | 改动 |
|---|---|
| **NewSessionDialog** | 新增"Agent 类型"下拉（AgentSelect）；emit create 带 agent；prompt placeholder 按 agent 动态（claude→"你想让 Claude 做什么？"，其他→"你想让 {short} 做什么？"） |
| **Agent 选项联动** | claude → 现有"Claude 选项"（--verbose/--debug）；非 claude → 禁用 + "该 agent 暂不支持额外参数" |
| **SessionItem**（左侧列表） | avatar 用 AgentBadge（缺省 claude→CC） |
| **SessionTabContent**（终端） | loading 文案 `正在启动 {label} 会话…` + AgentBadge sm |
| **GlobalTabs** | session tab 标签前置 AgentBadge sm |
| **RecentSessionList**（历史 tab） | 每项前置 AgentBadge sm |
| **SessionTooltip** | AgentBadge sm + agent label |

## ProviderTab 按 agent 分组（框架先行）

- ProviderTab 左栏由"供应商列表"改为 **agent 选择**（Claude/Codex/OpenCode/OMP），右栏为所选 agent 的供应商列表 + 表单
- **claude**：现有 ANTHROPIC_* 表单完整迁移（Base URL/Auth Token/默认模型/推理模型，写 `~/.claude/settings.json`）
- **codex/opencode/omp**：预留分组框架与存储结构（providers 配置加 `agent` 维度），各自表单（config.toml / opencode.json / models.yml 格式）**留待对应接入 step 实现**
- 主进程 providers store 配置扩展为按 agent 分组，`active_provider_id` 改为 `(agent, providerId)` 维度；本次仅迁移 claude，非 claude 的注入逻辑后续实现

## GeneralTab 每 agent 路径

- GeneralTab 的 `claude_path` 扩展为 4 个字段：`claude_path` / `codex_path` / `opencode_path` / `omp_path`
- 每个 agent 一个可执行路径输入，留空走 PATH（对应 `AgentSpec.command`）
- 主进程 settings store 与 `createSessionInternal` 按 agent 读取对应路径字段

## 网关支持（与后端配套）

多 agent 是一整套端到端实现：UI 的 agent 选择会落到后端 `AgentSpec` 分派，其中网关（apiproxy）对三个新 agent 均支持，差异在注入方式与格式：

| Agent | 网关注入方式 | API 格式 | 特殊条件 |
|---|---|---|---|
| codex | 临时 `~/.codex/config.toml`（`openai_base_url` / `model_providers`） | OpenAI Responses（SSE） | 必须 API-key 模式（ChatGPT 登录走 WebSocket 完全绕过）；新版默认 WS 传输需代理对 Upgrade 返回 426 强制回退 HTTP |
| opencode | 临时 `opencode.json` 的 `provider.options.baseURL`（`${env:OPENAI_BASE_URL}/v1`） | OpenAI Chat / Anthropic（按 npm 适配器） | 无 |
| omp | env `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`（与 claude 同方式） | Anthropic `/v1/messages` / OpenAI | 无 |

`startProxy` 管道已通用（`format?: FormatAdapter` 参数），但 `formats/openai.ts` / `formats/pi.ts` 当前为空壳（`reassembleResponse: () => null`）。**trace 完整度取决于这两个 FormatAdapter 的补全**（后端设计文档实施顺序第 2 步），属于整套实现的一部分——UI 创建流程不阻塞，但非 claude 的 trace 在 adapter 补全前不完整。

## 边界状态

| 场景 | 行为 |
|---|---|
| 老会话 / 未知 agent | 缺省 claude，显示 CC |
| 非 claude 会话在左侧列表 | msg_count 等不刷新（listSessions 无 jsonl 条目，refreshList 跳过），只显示项目名 + agent badge |
| 非 claude 会话恢复 | 走 recent-sessions.json（open() 已有记录），不依赖 jsonl 扫描 |
| 非 claude agent 创建 | 网关支持；trace 完整度取决于 FormatAdapter 补全（openai/pi 空壳），UI 创建流程不阻塞 |
| 非 claude 选项区 | 禁用 + 提示 |
| ProviderTab 非 claude 分组 | 显示空状态"该 agent 的供应商配置待支持" |

## 测试

- `stores/sessions.test.ts`：recentToMeta 透传 agent、applyRebind 保留 agent、create 传 agent
- 组件渲染：AgentBadge（各 agent 缩写 + 缺省回退 claude）、AgentSelect（默认 claude + 切换联动）
- renderer vitest：需配置 `test` 脚本（当前为占位符）以运行组件测试

## 实施顺序

1. `types/agents.ts` + `styles/theme.css` agent 配色变量
2. `AgentBadge.vue` / `AgentSelect.vue` 组件
3. 主进程数据模型：RecentSessionRecord.agent、mergeRecentTitles 带 agent、createSessionInternal 写 agent
4. 前端数据模型：SessionMeta/RecentSession.agent、stores/sessions.ts 透传
5. NewSessionDialog：AgentSelect + 选项联动 + placeholder
6. 4 处标识接入（SessionItem / SessionTabContent / GlobalTabs / RecentSessionList / SessionTooltip）
7. GeneralTab 每 agent 路径
8. ProviderTab 按 agent 分组框架（claude 迁移）
9. 回归：`npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit`
